import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { uploadDocument, buildFileUrl } from "../middleware/upload";
import {
  FORMATION_CRITERIA,
  FORMATION_THRESHOLDS,
  DISSOLUTION_CRITERIA,
  DOCUMENT_CRITERIA,
  assessFormation,
} from "../services/eligibility";
import {
  PERMIT_TERMS,
  DISSOLUTION_AUDIT_CRITERIA,
  DISSOLUTION_TARGET_DAYS,
  assessDissolution,
} from "../services/permits";
import { issuePermit } from "./permits";

const router = Router();
router.use(authenticate);

/** How long each level has to act before its step is overdue. */
export const STAGE_RESPONSE_DAYS = 21;

/**
 * A dissolution is filed by the cooperative's president, not by any member who
 * fancies closing it. These are the leadership titles the register uses for that
 * office; the filer's name is matched against them before the request is taken.
 */
const PRESIDENT_TITLES = ["president", "chairperson", "chairman", "chairwoman"];

/** The escalation chain. A request approved at one stage moves to the next. */
const STAGE_ORDER = ["sector", "district", "rca"] as const;
type Stage = (typeof STAGE_ORDER)[number];

const STATUS_FOR_STAGE: Record<Stage, string> = {
  sector: "pending_sector",
  district: "pending_district",
  rca: "pending_rca",
};

const STAGE_LABEL: Record<Stage, string> = {
  sector: "Sector Cooperative Officer",
  district: "District Cooperative Officer",
  rca: "RCA Officer",
};

/**
 * Which stage a user may act on. Sector officers are additionally restricted to
 * their own sector further down; admins may act at any stage, which is what makes
 * the chain testable on a single machine.
 */
function reviewerStage(user: { role: string; oversightLevel?: string | null }): Stage | "any" | null {
  if (["admin", "generalManager"].includes(user.role)) return "any";
  const level = user.oversightLevel;
  if (level && (STAGE_ORDER as readonly string[]).includes(level)) return level as Stage;
  return null;
}

/** The JWT predates oversight_level, so read it from the row rather than the token. */
async function loadActor(userId: string) {
  const res = await query(
    `SELECT id, name, email, role, sector, cooperative_id, oversight_level FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return row
    ? {
        id: row.id as string,
        name: row.name as string,
        role: row.role as string,
        sector: row.sector as string | null,
        cooperativeId: row.cooperative_id as string | null,
        oversightLevel: row.oversight_level as string | null,
      }
    : null;
}

const SELECT_REQUEST = `
  SELECT r.*,
         u.name  AS submitted_by_name,
         u.email AS submitted_by_email,
         c.name  AS cooperative_name,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', d.id, 'criterionId', d.criterion_id, 'name', d.name,
              'type', d.type, 'url', d.url, 'uploadedAt', d.uploaded_at) ORDER BY d.uploaded_at)
              FROM cooperative_request_documents d WHERE d.request_id = r.id), '[]') AS documents,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', v.id, 'stage', v.stage, 'decision', v.decision, 'note', v.note,
              'reviewedAt', v.reviewed_at, 'reviewerName', ru.name) ORDER BY v.reviewed_at)
              FROM cooperative_request_reviews v
              JOIN users ru ON ru.id = v.reviewed_by
             WHERE v.request_id = r.id), '[]') AS reviews,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', a.id, 'reference', a.reference, 'status', a.status,
              'recommendation', a.recommendation, 'findings', a.findings,
              'outcomeNote', a.outcome_note, 'score', a.score,
              'aiAssessment', a.ai_assessment, 'dueOn', a.due_on,
              'openedAt', a.opened_at, 'concludedAt', a.concluded_at,
              'concludedByName', au.name) ORDER BY a.opened_at)
              FROM rca_audits a
              LEFT JOIN users au ON au.id = a.concluded_by
             WHERE a.request_id = r.id), '[]') AS audits
    FROM cooperative_requests r
    JOIN users u ON u.id = r.submitted_by
    LEFT JOIN cooperatives c ON c.id = r.cooperative_id
`;

async function nextReference(type: "formation" | "dissolution") {
  const prefix = type === "formation" ? "FRM" : "DIS";
  const year = new Date().getFullYear();
  const res = await query(
    `SELECT COUNT(*) AS n FROM cooperative_requests
      WHERE request_type = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [type, year]
  );
  const n = parseInt(res.rows[0].n, 10) + 1;
  return `${prefix}/${year}/${String(n).padStart(4, "0")}`;
}

async function notifyStage(stage: Stage, sector: string | null, title: string, message: string) {
  const conditions = ["status = 'active'", "oversight_level = $1"];
  const params: unknown[] = [stage];
  if (stage === "sector" && sector) {
    params.push(sector);
    conditions.push(`sector = $${params.length}`);
  }
  const officers = await query(`SELECT id FROM users WHERE ${conditions.join(" AND ")}`, params);
  for (const o of officers.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'alert','/cooperative-requests')`,
      [o.id, title, message]
    );
  }
  return officers.rowCount ?? 0;
}

async function notifyApplicant(userId: string, title: string, message: string) {
  await query(
    `INSERT INTO notifications (user_id, title, message, type, link)
     VALUES ($1,$2,$3,'alert','/cooperative-requests')`,
    [userId, title, message]
  );
}

// ─── GET /criteria ────────────────────────────────────────────────────────────
// The published rulebook — the applicant form, the officer checklist and the
// assessor all read this.
router.get("/criteria", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      formation: FORMATION_CRITERIA,
      dissolution: DISSOLUTION_CRITERIA,
      dissolutionAudit: DISSOLUTION_AUDIT_CRITERIA,
      thresholds: FORMATION_THRESHOLDS,
      stageResponseDays: STAGE_RESPONSE_DAYS,
      dissolutionTargetDays: DISSOLUTION_TARGET_DAYS,
      stageOrder: STAGE_ORDER,
      stageLabels: STAGE_LABEL,
      permitTerms: PERMIT_TERMS,
      notes: {
        dissolutionFiler:
          "A dissolution may only be filed by the cooperative's president, as recorded in its " +
          "leadership register, or by an administrator acting on the register's behalf.",
        dissolutionAudit:
          `Approval at RCA level is blocked until the RCA has audited the grounds. The whole ` +
          `chain targets ${DISSOLUTION_TARGET_DAYS} days, though a contested case or unsettled ` +
          "accounts will take longer.",
        formationPermit:
          `Final approval registers the cooperative and issues a temporary operating permit ` +
          `valid for ${PERMIT_TERMS.temporaryYears} year.`,
      },
    },
  });
});

// ─── POST /formation ──────────────────────────────────────────────────────────
router.post("/formation", async (req: Request, res: Response) => {
  try {
    const {
      proposedName, proposedType, sector, cell, village,
      memberCount, shareCapital, purpose,
      contactName, contactPhone, contactEmail,
    } = req.body;

    const missing = [
      !proposedName && "proposedName",
      !proposedType && "proposedType",
      !sector && "sector",
      !contactName && "contactName",
      !contactPhone && "contactPhone",
    ].filter(Boolean);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const duplicate = await query(
      `SELECT id FROM cooperatives WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [proposedName]
    );
    const nameTaken = (duplicate.rowCount ?? 0) > 0;

    const reference = await nextReference("formation");
    const inserted = await query(
      `INSERT INTO cooperative_requests
         (request_type, reference, submitted_by, contact_name, contact_phone, contact_email,
          sector, cell, village, proposed_name, proposed_type, member_count, share_capital, purpose,
          current_stage, status, response_due_at)
       VALUES ('formation',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               'sector','pending_sector', NOW() + ($14 || ' days')::interval)
       RETURNING id`,
      [
        reference, req.user!.userId, contactName, contactPhone, contactEmail || null,
        sector, cell || null, village || null, proposedName, proposedType,
        memberCount != null ? Number(memberCount) : null,
        shareCapital != null ? Number(shareCapital) : null,
        purpose || null, String(STAGE_RESPONSE_DAYS),
      ]
    );
    const id = inserted.rows[0].id as string;

    // First pass with no documents yet — re-run once files are attached.
    const assessment = assessFormation(
      { proposedName, proposedType, sector, cell, memberCount, shareCapital, purpose, contactName, contactPhone },
      [],
      nameTaken
    );
    await query(`UPDATE cooperative_requests SET ai_assessment = $1 WHERE id = $2`, [
      JSON.stringify(assessment), id,
    ]);

    const notified = await notifyStage(
      "sector", sector,
      "New cooperative formation request",
      `${contactName} has applied to form "${proposedName}" in ${sector} sector (${reference}).`
    );

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [id]);
    res.status(201).json({
      success: true,
      message: `Application ${reference} submitted to the ${sector} sector cooperative officer.`,
      data: created.rows[0],
      notifiedOfficers: notified,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/formation error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /dissolution ────────────────────────────────────────────────────────
router.post("/dissolution", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    const {
      cooperativeId, dissolutionReason, votesFor, votesAgainst, votesAbstain,
      outstandingLiabilities, assetDisposalPlan, contactName, contactPhone, contactEmail,
    } = req.body;

    const targetId = cooperativeId || actor?.cooperativeId;
    if (!targetId) {
      return res.status(400).json({ success: false, message: "cooperativeId is required." });
    }
    if (!dissolutionReason || String(dissolutionReason).trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: "Explain the grounds for dissolution in at least 30 characters.",
      });
    }
    if (!assetDisposalPlan || String(assetDisposalPlan).trim().length < 30) {
      return res.status(400).json({
        success: false,
        message: "An asset disposal and settlement plan of at least 30 characters is required.",
      });
    }

    // Managers may only file for their own cooperative.
    if (["manager", "cooperative", "member"].includes(actor?.role ?? "") && actor?.cooperativeId !== targetId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const coop = await query(
      `SELECT id, name, sector, cell, village FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (coop.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const c = coop.rows[0];

    // ── Only the president may ask for the cooperative to be struck off ──────
    // Dissolution ends the livelihood of everyone on the register, so the filing
    // is restricted to the office that answers for the cooperative. The check is
    // by name against the leadership record, because the president is a person on
    // the register, not a system role. Administrators may file on the register's
    // behalf — that is how a request from a cooperative with no login gets in.
    const isAdministrator = ["admin", "generalManager"].includes(actor?.role ?? "");
    let filedAsRole = "President";

    if (!isAdministrator) {
      const office = await query(
        `SELECT role FROM cooperative_leadership
          WHERE cooperative_id = $1
            AND (end_date IS NULL OR end_date > CURRENT_DATE)
            AND LOWER(name) = LOWER($2)`,
        [targetId, actor?.name ?? ""]
      );
      const heldOffice = office.rows
        .map((r) => String(r.role).toLowerCase())
        .find((role) => PRESIDENT_TITLES.some((t) => role.includes(t)));

      if (!heldOffice) {
        return res.status(403).json({
          success: false,
          message:
            `Only the president of ${c.name} may request its dissolution. Your account is not ` +
            "recorded as holding that office in the cooperative's leadership record. If the " +
            "leadership record is out of date, ask your sector cooperative officer to correct it.",
        });
      }
      filedAsRole = office.rows.find((r) =>
        PRESIDENT_TITLES.some((t) => String(r.role).toLowerCase().includes(t))
      )!.role;
    } else {
      filedAsRole = `${actor?.role} filing on behalf of the president`;
    }

    const open = await query(
      `SELECT id FROM cooperative_requests
        WHERE cooperative_id = $1 AND request_type = 'dissolution'
          AND status IN ('pending_sector','pending_district','pending_rca')`,
      [targetId]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: "A dissolution request for this cooperative is already in the review chain.",
      });
    }

    // The whole chain targets two weeks end-to-end, so each stage gets a third of
    // it rather than the three-week window a formation request enjoys. Formation
    // is not urgent; a cooperative waiting to be wound up is.
    const dissolutionStageDays = Math.max(3, Math.floor(DISSOLUTION_TARGET_DAYS / STAGE_ORDER.length));

    const reference = await nextReference("dissolution");
    const inserted = await query(
      `INSERT INTO cooperative_requests
         (request_type, reference, submitted_by, contact_name, contact_phone, contact_email,
          sector, cell, village, cooperative_id, dissolution_reason,
          votes_for, votes_against, votes_abstain, outstanding_liabilities, asset_disposal_plan,
          filed_as_role, current_stage, status, response_due_at, target_completion_at)
       VALUES ('dissolution',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'sector','pending_sector',
               NOW() + ($17 || ' days')::interval,
               NOW() + ($18 || ' days')::interval)
       RETURNING id`,
      [
        reference, req.user!.userId,
        contactName || actor?.name || "Cooperative leadership",
        contactPhone || "", contactEmail || null,
        c.sector, c.cell, c.village, targetId, String(dissolutionReason).trim(),
        votesFor != null ? Number(votesFor) : null,
        votesAgainst != null ? Number(votesAgainst) : null,
        votesAbstain != null ? Number(votesAbstain) : null,
        outstandingLiabilities != null ? Number(outstandingLiabilities) : null,
        String(assetDisposalPlan).trim(), filedAsRole,
        String(dissolutionStageDays), String(DISSOLUTION_TARGET_DAYS),
      ]
    );

    const notified = await notifyStage(
      "sector", c.sector,
      "Cooperative dissolution request",
      `The president of ${c.name} (${c.sector} sector) has requested its dissolution — ${reference}. ` +
        `The RCA targets ${DISSOLUTION_TARGET_DAYS} days end-to-end.`
    );

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message:
        `Dissolution request ${reference} submitted to the ${c.sector} sector cooperative officer. ` +
        `It escalates to the RCA, which will audit the grounds before the cooperative can be ` +
        `struck off. Target turnaround is ${DISSOLUTION_TARGET_DAYS} days, though a contested ` +
        "case or unsettled accounts will take longer.",
      data: created.rows[0],
      targetDays: DISSOLUTION_TARGET_DAYS,
      notifiedOfficers: notified,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/dissolution error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET / ────────────────────────────────────────────────────────────────────
// Applicants see their own; officers see what is sitting at their stage, plus
// anything they have already acted on.
router.get("/", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const stage = reviewerStage(actor);
    const { type, status } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (stage === null) {
      params.push(actor.id);
      conditions.push(`r.submitted_by = $${params.length}`);
    } else if (stage !== "any") {
      params.push(actor.id);
      const own = `r.submitted_by = $${params.length}`;
      params.push(STATUS_FOR_STAGE[stage]);
      let queue = `r.status = $${params.length}`;
      if (stage === "sector" && actor.sector) {
        params.push(actor.sector);
        queue += ` AND r.sector = $${params.length}`;
      }
      params.push(actor.id);
      const acted = `EXISTS (SELECT 1 FROM cooperative_request_reviews v
                              WHERE v.request_id = r.id AND v.reviewed_by = $${params.length})`;
      conditions.push(`(${own} OR (${queue}) OR ${acted})`);
    }

    if (type) {
      params.push(type);
      conditions.push(`r.request_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_REQUEST} ${where}
       ORDER BY
         CASE WHEN r.status LIKE 'pending%' THEN 0 ELSE 1 END,
         r.response_due_at ASC`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      viewerStage: stage,
      stageResponseDays: STAGE_RESPONSE_DAYS,
    });
  } catch (err) {
    console.error("GET /cooperative-requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    const result = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const request = result.rows[0];
    if (reviewerStage(actor!) === null && request.submitted_by !== actor!.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    res.json({ success: true, data: request });
  } catch (err) {
    console.error("GET /cooperative-requests/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/documents ──────────────────────────────────────────────────────
router.post("/:id/documents", uploadDocument.single("file"), async (req: Request, res: Response) => {
  try {
    const { criterionId, name } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required." });
    }
    if (criterionId && !DOCUMENT_CRITERIA.some((c) => c.id === criterionId)) {
      return res.status(400).json({
        success: false,
        message: `criterionId must be one of: ${DOCUMENT_CRITERIA.map((c) => c.id).join(", ")}`,
      });
    }

    const existing = await query(`SELECT submitted_by, status FROM cooperative_requests WHERE id = $1`, [req.params.id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (existing.rows[0].submitted_by !== req.user!.userId) {
      return res.status(403).json({ success: false, message: "Only the applicant can attach documents." });
    }
    if (!String(existing.rows[0].status).startsWith("pending")) {
      return res.status(409).json({ success: false, message: "This request is closed." });
    }

    const inserted = await query(
      `INSERT INTO cooperative_request_documents
         (request_id, criterion_id, name, type, url, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.params.id, criterionId || null,
        name || req.file.originalname, criterionId || "other",
        buildFileUrl(req, "documents", req.file.filename), req.file.size, req.user!.userId,
      ]
    );

    res.status(201).json({ success: true, message: "Document attached.", data: inserted.rows[0] });
  } catch (err) {
    console.error("POST /cooperative-requests/:id/documents error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/assess ─────────────────────────────────────────────────────────
// Re-runs eligibility. Tries the AI microservice first and falls back to the
// deterministic rules engine when it is unreachable (it is not built yet).
router.post("/:id/assess", async (req: Request, res: Response) => {
  try {
    const result = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const r = result.rows[0];
    if (r.request_type !== "formation") {
      return res.status(400).json({
        success: false,
        message: "Automated eligibility assessment applies to formation requests only.",
      });
    }

    const duplicate = await query(
      `SELECT id FROM cooperatives WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [r.proposed_name]
    );
    const attachedCriterionIds: string[] = (r.documents ?? [])
      .map((d: any) => d.criterionId)
      .filter(Boolean);

    const assessment = assessFormation(
      {
        proposedName: r.proposed_name,
        proposedType: r.proposed_type,
        sector: r.sector,
        cell: r.cell,
        memberCount: r.member_count,
        shareCapital: r.share_capital != null ? Number(r.share_capital) : null,
        purpose: r.purpose,
        contactName: r.contact_name,
        contactPhone: r.contact_phone,
      },
      attachedCriterionIds,
      (duplicate.rowCount ?? 0) > 0
    );

    await query(`UPDATE cooperative_requests SET ai_assessment = $1, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify(assessment), r.id,
    ]);

    // Keep a copy alongside the other model output so it shows up in AI Insights.
    await query(
      `INSERT INTO ai_insights
         (cooperative_id, type, severity, title, summary, detail,
          affected_metric, current_value, expected_value, recommendations,
          model_name, confidence, resolved, generated_at)
       VALUES (NULL,'recommendation',$1,$2,$3,$4,'Eligibility Score',$5,$6,$7,$8,$9,false,NOW())`,
      [
        assessment.eligible ? "info" : "warning",
        `Formation eligibility — ${r.proposed_name}`,
        assessment.eligible
          ? `${r.proposed_name} (${r.reference}) meets ${Math.round(assessment.score * 100)}% of the configured formation criteria and is predicted eligible.`
          : `${r.proposed_name} (${r.reference}) meets ${Math.round(assessment.score * 100)}% of the configured formation criteria and is predicted NOT eligible.`,
        assessment.failedMandatory.length
          ? `Unmet mandatory criteria: ${assessment.failedMandatory.join("; ")}.`
          : "All mandatory criteria are met.",
        Math.round(assessment.score * 100),
        Math.round(assessment.passMark * 100),
        JSON.stringify(assessment.recommendations),
        assessment.model,
        assessment.confidence,
      ]
    );

    res.json({ success: true, data: assessment });
  } catch (err) {
    console.error("POST /cooperative-requests/:id/assess error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/audit ──────────────────────────────────────────────────────────
// The RCA opens its audit of a dissolution request.
//
// This is the step that stops a cooperative being closed on a president's word.
// The audit checks that the members actually resolved on it, that the money is
// accounted for, and that a cooperative which is still trading is not being
// abandoned. Only once it concludes may the RCA approve the strike-off.
router.post("/:id/audit", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const stage = reviewerStage(actor);
    if (stage !== "rca" && stage !== "any") {
      return res.status(403).json({
        success: false,
        message: "Only the RCA audits a dissolution request.",
      });
    }

    const found = await query(
      `SELECT r.*, c.name AS cooperative_name FROM cooperative_requests r
         LEFT JOIN cooperatives c ON c.id = r.cooperative_id WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const r = found.rows[0];
    if (r.request_type !== "dissolution") {
      return res.status(400).json({
        success: false,
        message: "Only dissolution requests carry an RCA audit.",
      });
    }
    if (!String(r.status).startsWith("pending")) {
      return res.status(409).json({ success: false, message: `This request is already ${r.status}.` });
    }

    const open = await query(
      `SELECT reference FROM rca_audits WHERE request_id = $1 AND status IN ('scheduled','in_progress')`,
      [r.id]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `Audit ${open.rows[0].reference} is already open on this request.`,
      });
    }

    const facts = await gatherDissolutionFacts(r);
    const assessment = assessDissolution(facts);

    const year = new Date().getFullYear();
    const seq = await query(
      `SELECT COUNT(*) AS n FROM rca_audits WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const reference = `AUD/${year}/${String(parseInt(seq.rows[0].n, 10) + 1).padStart(4, "0")}`;

    const inserted = await query(
      `INSERT INTO rca_audits
         (reference, audit_type, cooperative_id, request_id, status, due_on,
          opened_by, ai_assessment, score)
       VALUES ($1,'dissolution',$2,$3,'in_progress',
               COALESCE($4::date, CURRENT_DATE + 7), $5, $6, $7)
       RETURNING id`,
      [
        reference,
        r.cooperative_id,
        r.id,
        r.target_completion_at ? new Date(r.target_completion_at).toISOString().slice(0, 10) : null,
        actor.id,
        JSON.stringify({ facts, assessment }),
        assessment.score,
      ]
    );

    await notifyApplicant(
      r.submitted_by,
      "RCA audit opened on your dissolution request",
      `The RCA has opened audit ${reference} on ${r.reference}. An officer will verify the ` +
        "assembly resolution, the outstanding liabilities and the asset disposal plan before a " +
        "decision is made."
    );

    res.status(201).json({
      success: true,
      message: `RCA audit ${reference} opened on ${r.reference}.`,
      data: { id: inserted.rows[0].id, reference, facts, assessment },
      criteria: DISSOLUTION_AUDIT_CRITERIA,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/:id/audit error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/audit ─────────────────────────────────────────────────────────
// Conclude the RCA audit. The recommendation does not itself dissolve anything —
// the officer still records the decision below — but approval is refused until
// this has been done.
router.patch("/:id/audit", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    const stage = reviewerStage(actor);
    if (stage !== "rca" && stage !== "any") {
      return res.status(403).json({ success: false, message: "Only the RCA concludes this audit." });
    }

    const { recommendation, findings, outcomeNote } = req.body;
    if (!["allow_dissolution", "refuse_dissolution"].includes(recommendation)) {
      return res.status(400).json({
        success: false,
        message: "recommendation must be allow_dissolution or refuse_dissolution",
      });
    }
    if (!findings || String(findings).trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: "Record what the audit found, in at least 20 characters.",
      });
    }

    const audit = await query(
      `SELECT * FROM rca_audits
        WHERE request_id = $1 AND audit_type = 'dissolution' AND status IN ('scheduled','in_progress')
        ORDER BY opened_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (audit.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No open RCA audit was found on this request.",
      });
    }

    await query(
      `UPDATE rca_audits
          SET status = $1, recommendation = $2, findings = $3, outcome_note = $4,
              concluded_by = $5, concluded_at = NOW(), updated_at = NOW()
        WHERE id = $6`,
      [
        recommendation === "allow_dissolution" ? "passed" : "failed",
        recommendation,
        String(findings).trim(),
        outcomeNote ? String(outcomeNote).trim() : null,
        actor.id,
        audit.rows[0].id,
      ]
    );

    res.json({
      success: true,
      message:
        recommendation === "allow_dissolution"
          ? "Audit concluded: the grounds hold. Record the decision to strike the cooperative off."
          : "Audit concluded: the grounds do not hold. Reject the request, giving the findings as the reason.",
      data: { recommendation, findings: String(findings).trim() },
    });
  } catch (err) {
    console.error("PATCH /cooperative-requests/:id/audit error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * Assembles what the dissolution audit scores against. Kept next to the audit
 * endpoints rather than in the rules service so the SQL stays with the other
 * request queries, and the rules stay pure and testable.
 */
async function gatherDissolutionFacts(r: any) {
  const [members, finances, income, support] = await Promise.all([
    query(
      `SELECT COUNT(*) AS n FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL`,
      [r.cooperative_id]
    ),
    // Bounded to the last twelve *complete* calendar months. A rolling window
    // from today's date straddles thirteen of them, which is how a count meant
    // to be "out of 12" comes back as 13.
    query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)  AS income,
         COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
         FROM transactions
        WHERE cooperative_id = $1 AND status = 'completed'
          AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
          AND date <  DATE_TRUNC('month', CURRENT_DATE)`,
      [r.cooperative_id]
    ),
    query(
      `SELECT COUNT(DISTINCT DATE_TRUNC('month', date)) AS n FROM transactions
        WHERE cooperative_id = $1 AND status = 'completed' AND type = 'income'
          AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '12 months'
          AND date <  DATE_TRUNC('month', CURRENT_DATE)`,
      [r.cooperative_id]
    ),
    // Was anything tried before accepting that the cooperative should close?
    query(
      `SELECT
         (SELECT COUNT(*) FROM cooperative_field_visits
           WHERE cooperative_id = $1 AND status = 'completed') AS visits,
         (SELECT COUNT(*) FROM funding_requests
           WHERE cooperative_id = $1) AS funding_requests`,
      [r.cooperative_id]
    ),
  ]);

  return {
    votesFor: r.votes_for != null ? Number(r.votes_for) : null,
    votesAgainst: r.votes_against != null ? Number(r.votes_against) : null,
    votesAbstain: r.votes_abstain != null ? Number(r.votes_abstain) : null,
    memberCount: parseInt(members.rows[0].n, 10),
    reasonLength: String(r.dissolution_reason ?? "").trim().length,
    liabilitiesDeclared: r.outstanding_liabilities != null,
    assetPlanLength: String(r.asset_disposal_plan ?? "").trim().length,
    recentSurplus: Number(finances.rows[0].income) - Number(finances.rows[0].expense),
    monthsWithIncome: parseInt(income.rows[0].n, 10),
    supportAttempts:
      parseInt(support.rows[0].visits, 10) + parseInt(support.rows[0].funding_requests, 10),
  };
}

// ─── PATCH /:id/decision ──────────────────────────────────────────────────────
// One level's yes/no. Approving at sector sends it to district, at district to
// RCA, and at RCA it takes effect: a formation registers the cooperative and
// issues its first permit, a dissolution strikes it off.
router.patch("/:id/decision", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const stage = reviewerStage(actor);
    if (stage === null) {
      return res.status(403).json({ success: false, message: "You are not a cooperative oversight officer." });
    }

    const { decision, note } = req.body;
    if (!["approved", "rejected", "returned"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "decision must be one of: approved, rejected, returned",
      });
    }
    if (decision !== "approved" && !String(note ?? "").trim()) {
      return res.status(400).json({
        success: false,
        message: "A note is required when rejecting or returning a request.",
      });
    }

    const found = await query(`SELECT * FROM cooperative_requests WHERE id = $1`, [req.params.id]);
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const r = found.rows[0];

    if (!String(r.status).startsWith("pending")) {
      return res.status(409).json({
        success: false,
        message: `This request is already ${r.status} and can no longer be decided.`,
      });
    }

    const currentStage = r.current_stage as Stage;
    if (stage !== "any" && stage !== currentStage) {
      return res.status(403).json({
        success: false,
        message: `This request is with the ${STAGE_LABEL[currentStage]}; you act at ${STAGE_LABEL[stage as Stage]} level.`,
      });
    }
    if (stage === "sector" && actor.sector && actor.sector !== r.sector) {
      return res.status(403).json({
        success: false,
        message: `This request belongs to ${r.sector} sector.`,
      });
    }

    // ── A dissolution is not decided at RCA level until the audit has run ────
    const finalStage = STAGE_ORDER.indexOf(currentStage) === STAGE_ORDER.length - 1;
    if (r.request_type === "dissolution" && finalStage && decision !== "returned") {
      const audit = await query(
        `SELECT reference, status, recommendation, findings FROM rca_audits
          WHERE request_id = $1 AND audit_type = 'dissolution'
            AND status IN ('passed','failed')
          ORDER BY concluded_at DESC LIMIT 1`,
        [r.id]
      );
      if (audit.rowCount === 0) {
        return res.status(409).json({
          success: false,
          message:
            "A cooperative cannot be struck off before the RCA has audited the grounds. " +
            "Open the audit on this request, conclude it, then record the decision.",
          requiresAudit: true,
        });
      }
      const concluded = audit.rows[0];
      const allows = concluded.recommendation === "allow_dissolution";
      if (decision === "approved" && !allows) {
        return res.status(409).json({
          success: false,
          message:
            `Audit ${concluded.reference} found the grounds do not hold, so the dissolution ` +
            "cannot be approved. Reject the request, or reopen the audit.",
          auditRecommendation: concluded.recommendation,
        });
      }
    }

    await query(
      `INSERT INTO cooperative_request_reviews (request_id, stage, decision, note, reviewed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [r.id, currentStage, decision, note ? String(note).trim() : null, actor.id]
    );

    let newStatus = r.status as string;
    let newStage = currentStage as Stage | "closed";
    let outcomeMessage = "";
    let createdCooperativeId: string | null = null;
    let issuedPermit: { id: string; permitNumber: string; expiresOn: string } | null = null;

    if (decision === "rejected") {
      newStatus = "rejected";
      newStage = "closed";
      outcomeMessage = `${r.reference} was rejected by the ${STAGE_LABEL[currentStage]}.`;
    } else if (decision === "returned") {
      // Sent back to the applicant for more information; stays at this stage.
      outcomeMessage = `${r.reference} was returned by the ${STAGE_LABEL[currentStage]} for more information.`;
    } else {
      const nextIndex = STAGE_ORDER.indexOf(currentStage) + 1;
      if (nextIndex < STAGE_ORDER.length) {
        const next = STAGE_ORDER[nextIndex];
        newStage = next;
        newStatus = STATUS_FOR_STAGE[next];
        outcomeMessage = `${r.reference} was approved by the ${STAGE_LABEL[currentStage]} and forwarded to the ${STAGE_LABEL[next]}.`;
        await notifyStage(
          next, r.sector,
          `Cooperative ${r.request_type} request forwarded`,
          outcomeMessage
        );
      } else {
        // Final approval at RCA — the request takes effect.
        newStatus = "approved";
        newStage = "closed";

        if (r.request_type === "formation") {
          const created = await query(
            `INSERT INTO cooperatives
               (name, type, sector, cell, village, registration_number, registration_date,
                description, phone, email, address, status, total_savings, health_score)
             VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,$8,$9,$10,'active',0,50)
             ON CONFLICT (registration_number) DO NOTHING
             RETURNING id`,
            [
              r.proposed_name, r.proposed_type, r.sector, r.cell, r.village,
              r.reference.replace(/^FRM/, "RCA"),
              r.purpose, r.contact_phone, r.contact_email,
              [r.cell, r.sector, "Gasabo District, Kigali"].filter(Boolean).join(", "),
            ]
          );
          createdCooperativeId = created.rows[0]?.id ?? null;

          // Registration and the first permit are the same act. A cooperative
          // must never sit on the register with no licence to operate, so the
          // one-year temporary permit is issued here rather than left to a
          // separate step somebody can forget.
          if (createdCooperativeId) {
            issuedPermit = await issuePermit({
              cooperativeId: createdCooperativeId,
              permitType: "temporary",
              termYears: PERMIT_TERMS.temporaryYears,
              termRule: "temporary_first_year",
              basis:
                `Issued on registration under ${r.reference}. Valid for ` +
                `${PERMIT_TERMS.temporaryYears} year, after which an RCA maturity audit decides ` +
                "whether it converts to a permanent permit.",
              issuedBy: actor.id,
              sourceRequestId: r.id,
            });
          }

          outcomeMessage =
            `${r.reference} has been approved by the RCA. ${r.proposed_name} is now on the register` +
            (issuedPermit
              ? `, holding temporary permit ${issuedPermit.permitNumber} until ` +
                `${new Date(issuedPermit.expiresOn).toLocaleDateString()}.`
              : ".");
        } else {
          await query(
            `UPDATE cooperatives
                SET status = 'inactive', deleted_at = NOW(), updated_at = NOW()
              WHERE id = $1`,
            [r.cooperative_id]
          );
          // The permit dies with the cooperative. Leaving it active would let a
          // dissolved cooperative show a valid licence.
          await query(
            `UPDATE cooperative_permits
                SET status = 'revoked', revoked_at = NOW(),
                    revocation_reason = $2, updated_at = NOW()
              WHERE cooperative_id = $1 AND status = 'active'`,
            [r.cooperative_id, `Cooperative dissolved under ${r.reference}.`]
          );
          await query(`UPDATE users SET cooperative_id = NULL WHERE cooperative_id = $1`, [r.cooperative_id]);
          // Any field visit still queued for it is moot.
          await query(
            `UPDATE cooperative_field_visits
                SET status = 'cancelled', updated_at = NOW()
              WHERE cooperative_id = $1 AND status IN ('pending','scheduled')`,
            [r.cooperative_id]
          );
          outcomeMessage = `${r.reference} has been approved by the RCA. The cooperative has been dissolved, its operating permit revoked, and it has been removed from the active register.`;
        }
      }
    }

    // The stage clock restarts whenever the request moves on to a new level.
    const stillPending = newStatus.startsWith("pending");
    await query(
      `UPDATE cooperative_requests
          SET status = $1, current_stage = $2,
              response_due_at = CASE WHEN $3::boolean
                                     THEN NOW() + ($4 || ' days')::interval
                                     ELSE response_due_at END,
              updated_at = NOW()
        WHERE id = $5`,
      [newStatus, newStage, stillPending, String(STAGE_RESPONSE_DAYS), r.id]
    );

    await notifyApplicant(
      r.submitted_by,
      `Cooperative ${r.request_type} request update`,
      `${outcomeMessage}${note ? ` Note: ${String(note).trim()}` : ""}`
    );

    const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [r.id]);
    res.json({
      success: true,
      message: outcomeMessage,
      data: updated.rows[0],
      createdCooperativeId,
      issuedPermit,
    });
  } catch (err) {
    console.error("PATCH /cooperative-requests/:id/decision error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /:id/withdraw ──────────────────────────────────────────────────────
router.patch("/:id/withdraw", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE cooperative_requests
          SET status = 'withdrawn', current_stage = 'closed', updated_at = NOW()
        WHERE id = $1 AND submitted_by = $2 AND status LIKE 'pending%'
        RETURNING reference`,
      [req.params.id, req.user!.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "No open request of yours was found to withdraw." });
    }
    res.json({ success: true, message: `${result.rows[0].reference} withdrawn.` });
  } catch (err) {
    console.error("PATCH /cooperative-requests/:id/withdraw error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
