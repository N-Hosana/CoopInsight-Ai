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

const router = Router();
router.use(authenticate);

/** How long each level has to act before its step is overdue. */
export const STAGE_RESPONSE_DAYS = 21;

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
             WHERE v.request_id = r.id), '[]') AS reviews
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
      thresholds: FORMATION_THRESHOLDS,
      stageResponseDays: STAGE_RESPONSE_DAYS,
      stageOrder: STAGE_ORDER,
      stageLabels: STAGE_LABEL,
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

    const reference = await nextReference("dissolution");
    const inserted = await query(
      `INSERT INTO cooperative_requests
         (request_type, reference, submitted_by, contact_name, contact_phone, contact_email,
          sector, cell, village, cooperative_id, dissolution_reason,
          votes_for, votes_against, votes_abstain, outstanding_liabilities, asset_disposal_plan,
          current_stage, status, response_due_at)
       VALUES ('dissolution',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               'sector','pending_sector', NOW() + ($16 || ' days')::interval)
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
        String(assetDisposalPlan).trim(), String(STAGE_RESPONSE_DAYS),
      ]
    );

    const notified = await notifyStage(
      "sector", c.sector,
      "Cooperative dissolution request",
      `A request to dissolve ${c.name} (${c.sector} sector) has been filed — ${reference}.`
    );

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message: `Dissolution request ${reference} submitted to the ${c.sector} sector cooperative officer.`,
      data: created.rows[0],
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

// ─── PATCH /:id/decision ──────────────────────────────────────────────────────
// One level's yes/no. Approving at sector sends it to district, at district to
// RCA, and at RCA it takes effect: a formation creates the cooperative, a
// dissolution closes it.
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

    await query(
      `INSERT INTO cooperative_request_reviews (request_id, stage, decision, note, reviewed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [r.id, currentStage, decision, note ? String(note).trim() : null, actor.id]
    );

    let newStatus = r.status as string;
    let newStage = currentStage as Stage | "closed";
    let outcomeMessage = "";
    let createdCooperativeId: string | null = null;

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
          outcomeMessage = `${r.reference} has been approved by the RCA. ${r.proposed_name} is now on the register.`;
        } else {
          await query(
            `UPDATE cooperatives
                SET status = 'inactive', deleted_at = NOW(), updated_at = NOW()
              WHERE id = $1`,
            [r.cooperative_id]
          );
          await query(`UPDATE users SET cooperative_id = NULL WHERE cooperative_id = $1`, [r.cooperative_id]);
          outcomeMessage = `${r.reference} has been approved by the RCA. The cooperative has been dissolved and removed from the active register.`;
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
