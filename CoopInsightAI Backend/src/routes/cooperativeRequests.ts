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
import {
  LIQUIDATOR_QUALIFICATIONS,
  RCA_NOTIFICATION_DAYS,
  SERVICE_ATTENDANCE_FRACTION,
  SERVICE_MAJORITY_FRACTION,
  assessServiceRequest,
} from "../services/serviceRequests";
import { DELEGATE_THRESHOLD_MEMBERS } from "../services/governance";
import { conveneAssembly, noticeProblem } from "../services/assemblies";
import { writableCooperative } from "../services/cooperativeAccess";
import {
  DISSOLUTION_STAGES,
  FORMATION_STAGES,
  ISSUE_STAGES,
  buildRequestProcess,
} from "../services/requestProcess";
import {
  ISSUE_CATEGORIES,
  ISSUE_RESPONSE_DAYS,
  ISSUE_SEVERITIES,
  MIN_ISSUE_DETAIL_LENGTH,
  issueCategory,
  resolveSeverity,
} from "../services/issueReports";
import { broadcastToCooperative, notifyOversight } from "../services/broadcast";

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

/**
 * Attaches the named stages to a request row.
 *
 * Every response that carries a request carries its process, so nobody — the
 * president who filed it or the officer holding it — has to work out from
 * `pending_rca` that what the case is actually waiting on is the liquidator's
 * report.
 */
function withProcess<T extends Record<string, any>>(row: T) {
  if (!row) return row;
  return {
    ...row,
    process: buildRequestProcess({
      requestType: row.request_type,
      status: row.status,
      currentStage: row.current_stage,
      createdAt: row.created_at ?? null,
      dissolutionStage: row.dissolution_stage ?? null,
      assemblyHeldOn: row.assembly_held_on ?? null,
      secondAssemblyHeldOn: row.second_assembly_held_on ?? null,
      assetsDistributed: row.assets_distributed === true,
      certificateReturned: row.certificate_returned === true,
      liquidatorName: row.liquidator_name ?? null,
      reviews: Array.isArray(row.reviews) ? row.reviews : [],
      audits: Array.isArray(row.audits) ? row.audits : [],
    }),
  };
}

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
      // The published procedures, stage by stage. The portal renders these so
      // an applicant reads the same steps the server enforces.
      procedures: {
        formation: FORMATION_STAGES,
        dissolution: DISSOLUTION_STAGES,
        issue_report: ISSUE_STAGES,
      },
      // What an ordinary member may raise on their own account, and how fast
      // each kind of problem has to be answered.
      issues: {
        categories: ISSUE_CATEGORIES,
        severities: ISSUE_SEVERITIES,
        responseDays: ISSUE_RESPONSE_DAYS,
        minDetailLength: MIN_ISSUE_DETAIL_LENGTH,
      },
      // Who may file what. The backend enforces this; the form reads it so the
      // two cannot disagree about which buttons a person is shown.
      whoMayFile: {
        formation: {
          roles: ["member", "manager", "admin", "generalManager", "government"],
          note:
            "Anyone may apply to form a cooperative — the applicants are not yet members of " +
            "anything, so no office could file it for them.",
        },
        issue_report: {
          roles: ["member", "manager", "admin", "generalManager", "government"],
          note:
            "Any member may report a problem with their own cooperative. An officer may file on " +
            "a cooperative's behalf but must name which cooperative.",
        },
        dissolution: {
          roles: ["manager", "admin", "generalManager"],
          note:
            "Only the cooperative's president, as recorded in its leadership register, or an " +
            "administrator acting on the register's behalf. An ordinary member cannot commit the " +
            "whole cooperative to closing.",
        },
        certificate_services: {
          roles: ["manager", "admin", "generalManager"],
          note:
            "Change of objective, added activities, change of name and duplicate certificate are " +
            "filed by the president. They alter the cooperative's legal personality certificate.",
        },
      },
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
      data: withProcess(created.rows[0]),
      notifiedOfficers: notified,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/formation error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /issue ──────────────────────────────────────────────────────────────
// A member reports a problem with their cooperative.
//
// This is deliberately the ONE escalation an ordinary member can start on their
// own account. They cannot file a dissolution or a change of certificate —
// those commit the whole cooperative and belong to the president — but they are
// usually the first person to notice that something is wrong, and before this
// they could only raise it with the office they might be complaining about.
//
// It climbs the same sector → district → RCA chain as everything else, reusing
// the reviews, the stage clock and the decision machinery rather than growing a
// parallel workflow that would drift out of step.
router.post("/issue", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const { category, detail, severity, confidential, cooperativeId } = req.body;

    const spec = issueCategory(String(category ?? ""));
    if (!spec) {
      return res.status(400).json({
        success: false,
        message: `category must be one of: ${ISSUE_CATEGORIES.map((c) => c.id).join(", ")}`,
      });
    }
    if (!detail || String(detail).trim().length < MIN_ISSUE_DETAIL_LENGTH) {
      return res.status(400).json({
        success: false,
        message:
          `Describe what happened in at least ${MIN_ISSUE_DETAIL_LENGTH} characters. An officer ` +
          "has to be able to act on this without having to come back and ask what you meant.",
      });
    }

    // An officer may report on behalf of a cooperative, but must say which one —
    // they are not attached to any, so there is nothing to infer.
    const isOversight = ["admin", "generalManager", "government"].includes(actor.role);
    const targetId = isOversight ? cooperativeId || null : actor.cooperativeId;
    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: isOversight
          ? "Name the cooperative this report concerns — your account is not attached to one."
          : "Your account is not linked to a cooperative, so there is nothing to report about.",
        needsCooperative: isOversight,
      });
    }

    const coop = await query(
      `SELECT id, name, sector, cell, village FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (coop.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const c = coop.rows[0];

    // A member may only report on their own cooperative.
    if (!isOversight && actor.cooperativeId !== c.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const resolved = resolveSeverity(spec.id, severity);
    const responseDays = ISSUE_RESPONSE_DAYS[resolved];

    const year = new Date().getFullYear();
    const seq = await query(
      `SELECT COUNT(*) AS n FROM cooperative_requests
        WHERE request_type = 'issue_report' AND EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const reference = `ISS/${year}/${String(parseInt(seq.rows[0].n, 10) + 1).padStart(4, "0")}`;

    const inserted = await query(
      `INSERT INTO cooperative_requests
         (request_type, reference, submitted_by, contact_name, contact_phone, contact_email,
          sector, cell, village, cooperative_id,
          issue_category, issue_detail, issue_severity, issue_confidential,
          current_stage, status, response_due_at)
       VALUES ('issue_report',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               'sector','pending_sector', NOW() + ($14 || ' days')::interval)
       RETURNING id`,
      [
        reference,
        actor.id,
        actor.name,
        req.body.contactPhone || "",
        req.body.contactEmail || null,
        c.sector,
        c.cell,
        c.village,
        c.id,
        spec.id,
        String(detail).trim(),
        resolved,
        confidential === true,
        String(responseDays),
      ]
    );

    // Urgent reports go to every tier at once. Waiting for an urgent complaint
    // to climb two levels is how a cooperative loses its members' money while
    // the paperwork travels.
    const levels: Array<"sector" | "district" | "rca"> =
      resolved === "urgent" ? ["sector", "district", "rca"] : ["sector"];

    const notified = await notifyOversight({
      levels,
      sector: c.sector,
      title: `${resolved === "urgent" ? "URGENT: " : ""}Issue reported — ${c.name}`,
      message:
        `${spec.label} reported against ${c.name} (${c.sector} sector) — ${reference}. ` +
        `Severity ${resolved}; a response is due within ${responseDays} days.` +
        (confidential === true
          ? " The reporter asked that their name not be given to the cooperative."
          : ""),
    });

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [inserted.rows[0].id]);

    res.status(201).json({
      success: true,
      message:
        `Report ${reference} filed with the ${c.sector} sector cooperative officer. ` +
        `They have ${responseDays} days to respond` +
        (resolved === "urgent" ? ", and the district and RCA have been told as well." : ".") +
        (confidential === true
          ? " Your name has not been given to the cooperative, though the officers reviewing it can see it."
          : ""),
      data: withProcess(created.rows[0]),
      severity: resolved,
      responseDays,
      notifiedOfficers: notified,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/issue error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /dissolution ────────────────────────────────────────────────────────
// ─── POST /dissolution/assembly ───────────────────────────────────────────────
// Call one of the two general assemblies a dissolution needs:
//
//   decision      the assembly that resolves to dissolve, appoints the
//                 liquidator and the monitoring committee — called BEFORE the
//                 request is filed, because the request records its outcome
//   distribution  the assembly that receives the liquidator's report, called
//                 against a filed request that is at the distribution stage
//
// Either way the meeting goes onto the activities calendar with every active
// member registered for it, and every member gets the notice.
router.post("/dissolution/assembly", async (req: Request, res: Response) => {
  try {
    const access = writableCooperative(req, req.body.cooperativeId);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });
    const cooperativeId = access.cooperativeId;

    const { stage, requestId, scheduledFor, location, agenda } = req.body;
    if (!["decision", "distribution"].includes(stage)) {
      return res.status(400).json({ success: false, message: "stage must be decision or distribution." });
    }
    const late = noticeProblem(String(scheduledFor ?? ""), "extraordinary");
    if (late) return res.status(400).json({ success: false, message: late });
    if (!location || !String(location).trim()) {
      return res.status(400).json({ success: false, message: "Say where the assembly will sit." });
    }

    const coop = await query(`SELECT name FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`, [cooperativeId]);
    if (coop.rowCount === 0) return res.status(404).json({ success: false, message: "Cooperative not found" });
    const cooperativeName = coop.rows[0].name as string;

    let request: any = null;
    if (stage === "distribution") {
      const found = await query(
        `SELECT id, reference, liquidator_name, dissolution_stage FROM cooperative_requests
          WHERE id = $1 AND cooperative_id = $2 AND request_type = 'dissolution'`,
        [requestId, cooperativeId]
      );
      request = found.rows[0];
      if (!request) return res.status(404).json({ success: false, message: "Dissolution request not found." });
      if (request.dissolution_stage !== "distribution") {
        return res.status(409).json({
          success: false,
          message: "The second assembly is called once the request is at the distribution stage.",
        });
      }
    }

    const decision = stage === "decision";
    const defaultAgenda = decision
      ? "1. Confirm quorum (three-quarters of the members).\n" +
        "2. Hear the grounds for dissolving the cooperative.\n" +
        "3. Vote on dissolution (three-quarters of the votes cast).\n" +
        "4. Appoint the liquidator and the committee that will monitor them.\n" +
        "5. Minute the resolution."
      : `1. Confirm quorum.\n2. Receive the report of the liquidator${request?.liquidator_name ? `, ${request.liquidator_name}` : ""}.\n` +
        "3. Review loans recovered, creditors paid and the distribution of what remains.\n" +
        "4. Approve the closing accounts and minute the resolution.";
    const finalAgenda = agenda && String(agenda).trim() ? String(agenda).trim() : defaultAgenda;

    const convened = await conveneAssembly({
      cooperativeId,
      cooperativeName,
      kind: "extraordinary",
      title: decision
        ? `General Assembly — proposal to dissolve ${cooperativeName}`
        : `General Assembly — liquidator's report${request?.reference ? ` (${request.reference})` : ""}`,
      purpose: decision
        ? `To decide whether to dissolve ${cooperativeName}, and if so to appoint the liquidator and the monitoring committee.`
        : `To receive the liquidator's report on the dissolution of ${cooperativeName} and approve the closing accounts.`,
      objectives: decision
        ? ["Hear the grounds for dissolution", "Vote on dissolution", "Appoint the liquidator and monitoring committee"]
        : ["Receive the liquidator's report", "Approve the closing accounts"],
      agenda: finalAgenda,
      scheduledFor: String(scheduledFor),
      location: String(location).trim(),
      convenedBy: { id: req.user!.userId, name: (req.user as any)?.name },
    });

    const saved = await query(
      `INSERT INTO cooperative_assemblies
         (cooperative_id, purpose, request_id, activity_id, scheduled_for, location, agenda,
          members_registered, convened_by)
       VALUES ($1,$2,$3,$4,$5::timestamp,$6,$7,$8,$9)
       RETURNING *`,
      [
        cooperativeId,
        decision ? "dissolution_decision" : "dissolution_distribution",
        request?.id ?? null,
        convened.activityId,
        `${convened.date} ${convened.time}`,
        String(location).trim(),
        finalAgenda,
        convened.membersRegistered,
        req.user!.userId,
      ]
    );

    res.status(201).json({
      success: true,
      message:
        `General assembly called for ${convened.date} at ${convened.time.slice(0, 5)}. It is on the ` +
        `activities calendar with all ${convened.membersRegistered} active member(s) registered, and ` +
        `the notice has been sent to ${convened.notice.accountsReached} account(s).` +
        (convened.notice.note ? ` ${convened.notice.note}` : ""),
      data: saved.rows[0],
      activityId: convened.activityId,
    });
  } catch (err) {
    console.error("POST /cooperative-requests/dissolution/assembly error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /dissolution/assemblies ──────────────────────────────────────────────
// The dissolution assemblies a cooperative has called, newest first.
router.get("/dissolution/assemblies", async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const cooperativeId = ["manager", "cooperative", "member"].includes(role)
      ? req.user!.cooperativeId
      : (req.query.cooperativeId as string | undefined);
    if (!cooperativeId) return res.json({ success: true, data: [] });
    const result = await query(
      `SELECT a.*, act.status AS activity_status, act.title AS activity_title
         FROM cooperative_assemblies a
         LEFT JOIN activities act ON act.id = a.activity_id
        WHERE a.cooperative_id = $1
        ORDER BY a.created_at DESC`,
      [cooperativeId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /cooperative-requests/dissolution/assemblies error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.post("/dissolution", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    const {
      cooperativeId, dissolutionReason, votesFor, votesAgainst, votesAbstain,
      outstandingLiabilities, assetDisposalPlan, contactName, contactPhone, contactEmail,
      // Stage 1 of the statutory procedure (Law 057/2024, arts. 132-142): the
      // assembly that resolves to dissolve must also appoint the liquidator and
      // the committee that monitors them, and the RCA must be told within 7 days.
      membersPresent, assemblyHeldOn, liquidatorName, liquidatorQualification,
      liquidatorIsMember, liquidatorPhone, liquidatorEmail, monitoringCommittee,
      rcaNotifiedAt, assetInventoryDone, cmisReference,
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

    // ── The statutory first-stage requirements ──────────────────────────────
    if (!liquidatorName || !String(liquidatorName).trim()) {
      return res.status(400).json({
        success: false,
        message:
          "The General Assembly that resolves to dissolve must also appoint the person who " +
          "will collect and distribute the assets. Name the liquidator.",
      });
    }
    if (!(LIQUIDATOR_QUALIFICATIONS as readonly string[]).includes(liquidatorQualification ?? "")) {
      return res.status(400).json({
        success: false,
        message:
          "The liquidator must be a financial auditor, an accountant, or someone authorised " +
          `for this work. liquidatorQualification must be one of: ${LIQUIDATOR_QUALIFICATIONS.join(", ")}.`,
      });
    }
    // The committee, the members and the RCA all need a way to reach the person
    // holding the cooperative's assets.
    if (!liquidatorPhone || !String(liquidatorPhone).trim()) {
      return res.status(400).json({
        success: false,
        message: "Give a telephone number for the liquidator so the committee and the RCA can reach them.",
      });
    }
    if (!Array.isArray(monitoringCommittee) || monitoringCommittee.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "The assembly must appoint a group of members to monitor the dissolution. Name at " +
          "least one.",
      });
    }

    // Attendance is measured against the body entitled to sit — delegates above
    // 100 members — and three-quarters of it must have been there.
    const sizing = await query(
      `SELECT
         (SELECT COUNT(*) FROM members
           WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active') AS members,
         (SELECT delegate_count FROM cooperatives WHERE id = $1) AS delegates`,
      [targetId]
    );
    const activeMembers = parseInt(sizing.rows[0].members, 10);
    const delegates = sizing.rows[0].delegates as number | null;
    const usesDelegates = activeMembers > DELEGATE_THRESHOLD_MEMBERS;
    if (usesDelegates && !delegates) {
      return res.status(409).json({
        success: false,
        message:
          `${c.name} has ${activeMembers} members, so its assembly is made up of delegates. ` +
          "Record the delegate count before filing.",
        needsDelegateCount: true,
      });
    }
    const assemblyEligible = usesDelegates ? (delegates as number) : activeMembers;
    const attendanceNeeded = Math.ceil(assemblyEligible * SERVICE_ATTENDANCE_FRACTION);
    const present = membersPresent != null ? Number(membersPresent) : 0;
    if (present < attendanceNeeded) {
      return res.status(409).json({
        success: false,
        message:
          `Dissolution requires three-quarters of the members to attend: ${attendanceNeeded} of ` +
          `${assemblyEligible}. ${present} were recorded as present.`,
      });
    }

    // And three-quarters of those present must have voted for it.
    const cast = Number(votesFor ?? 0) + Number(votesAgainst ?? 0) + Number(votesAbstain ?? 0);
    const inFavour = cast > 0 ? Number(votesFor ?? 0) / cast : 0;
    if (inFavour < SERVICE_MAJORITY_FRACTION) {
      return res.status(409).json({
        success: false,
        message:
          `Dissolution is a reserved matter and needs at least ` +
          `${Math.round(SERVICE_MAJORITY_FRACTION * 100)}% of the votes cast. ` +
          `${Math.round(inFavour * 100)}% were in favour.`,
      });
    }

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
          filed_as_role, assembly_members_eligible, assembly_members_present, assembly_held_on,
          dissolution_stage, liquidator_name, liquidator_qualification, liquidator_is_member,
          monitoring_committee, decision_taken_at, rca_notified_at, asset_inventory_done,
          cmis_reference, current_stage, status, response_due_at, target_completion_at,
          liquidator_phone, liquidator_email)
       VALUES ('dissolution',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,'distribution',$20,$21,$22,$23,$24,$25,$26,$27,
               'sector','pending_sector',
               NOW() + ($28 || ' days')::interval,
               NOW() + ($29 || ' days')::interval,
               $30,$31)
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
        assemblyEligible, present, assemblyHeldOn || null,
        String(liquidatorName).trim(), liquidatorQualification,
        liquidatorIsMember === true,
        JSON.stringify(monitoringCommittee),
        assemblyHeldOn || null, rcaNotifiedAt || null, assetInventoryDone === true,
        cmisReference || null,
        String(dissolutionStageDays), String(DISSOLUTION_TARGET_DAYS),
        String(liquidatorPhone).trim(),
        liquidatorEmail ? String(liquidatorEmail).trim() : null,
      ]
    );

    // ── Tell all three tiers at once, not one at a time ─────────────────────
    // The sector officer has to act; the district and the RCA have to KNOW. A
    // dissolution that reaches the RCA as a surprise two stages later is a
    // dissolution nobody senior had the chance to question.
    const notified = await notifyOversight({
      levels: ["sector", "district", "rca"],
      sector: c.sector,
      title: "Cooperative dissolution request filed",
      message:
        `The president of ${c.name} (${c.sector} sector) has requested its dissolution — ` +
        `${reference}. ${String(liquidatorName).trim()} is the appointed liquidator. It sits with ` +
        `the ${c.sector} sector officer first; the RCA targets ${DISSOLUTION_TARGET_DAYS} days ` +
        "end-to-end.",
    });
    await query(
      `UPDATE cooperative_requests
          SET district_informed_at = NOW(), rca_informed_at = NOW()
        WHERE id = $1`,
      [inserted.rows[0].id]
    );

    // And the cooperative's own members are told, because dissolution decides
    // what happens to their savings and they are entitled to follow it.
    const memberBroadcast = await broadcastToCooperative({
      cooperativeId: targetId,
      senderId: req.user!.userId,
      senderName: contactName || actor?.name,
      subject: `Dissolution of ${c.name} — filed with the RCA (${reference})`,
      body:
        `The general assembly held on ${assemblyHeldOn ?? "the recorded date"} resolved to ` +
        `dissolve ${c.name}. The request has been filed as ${reference} and now goes to the ` +
        `${c.sector} sector cooperative officer, then the district office, then the RCA.\n\n` +
        `${String(liquidatorName).trim()} has been appointed liquidator and will recover ` +
        "outstanding loans, pay the cooperative's creditors, and distribute what remains to the " +
        `members. ${monitoringCommittee.length} member(s) were appointed to monitor that work.\n\n` +
        "A second general assembly will receive the liquidator's report before the RCA can strike " +
        "the cooperative off. You can follow every stage on the Cooperative Requests page.",
      link: "/cooperative-requests",
    });

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [inserted.rows[0].id]);

    // Score the paperwork against the RCA checklist straight away, so the
    // cooperative sees what stage 2 still needs rather than discovering it at
    // the RCA. This is distinct from the RCA's audit of the *grounds*.
    const procedural = assessServiceRequest("dissolution", {
      membersEligible: assemblyEligible,
      membersPresent: present,
      votesFor: votesFor != null ? Number(votesFor) : null,
      votesAgainst: votesAgainst != null ? Number(votesAgainst) : null,
      votesAbstain: votesAbstain != null ? Number(votesAbstain) : null,
      reason: String(dissolutionReason).trim(),
      liquidatorName: String(liquidatorName).trim(),
      liquidatorQualification,
      monitoringCommittee,
      decisionAt: assemblyHeldOn || null,
      rcaNotifiedAt: rcaNotifiedAt || null,
      assetInventoryDone: assetInventoryDone === true,
      cmisReference: cmisReference || null,
      attachedDocumentIds: [],
    });

    res.status(201).json({
      success: true,
      message:
        `Dissolution request ${reference} submitted to the ${c.sector} sector cooperative officer. ` +
        `Stage 1 is on file: the assembly resolved to dissolve, ${String(liquidatorName).trim()} ` +
        `is appointed liquidator and ${monitoringCommittee.length} member(s) will monitor the ` +
        `process. Stage 2 — the liquidator's report, payment of creditors and distribution of ` +
        `what remains — must follow before the RCA can strike the cooperative off. Target ` +
        `turnaround is ${DISSOLUTION_TARGET_DAYS} days, though a contested case or unsettled ` +
        "accounts will take longer.",
      data: withProcess(created.rows[0]),
      targetDays: DISSOLUTION_TARGET_DAYS,
      rcaNotificationDays: RCA_NOTIFICATION_DAYS,
      proceduralAssessment: procedural,
      notifiedOfficers: notified,
      memberBroadcast,
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

      const visible = [own, `(${queue})`, acted];

      // ── A dissolution is the RCA's business from the moment it is filed ────
      // Closing a cooperative ends the livelihood of everyone on its register.
      // Waiting for the case to climb two levels before the district and the
      // RCA even know it exists is how a contested dissolution gets three
      // weeks down the road before anyone senior looks at it. Both upper tiers
      // therefore see every dissolution in their scope at every stage — they
      // still cannot DECIDE it out of turn, which `PATCH /:id/decision`
      // enforces separately.
      if (stage === "district" || stage === "rca") {
        visible.push(`r.request_type = 'dissolution'`);
        // An urgent issue is the other thing the upper tiers should not learn
        // about two stages late — the same reasoning as a dissolution.
        visible.push(`(r.request_type = 'issue_report' AND r.issue_severity = 'urgent')`);
      }

      conditions.push(`(${visible.join(" OR ")})`);
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
      data: result.rows.map(withProcess),
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
    res.json({ success: true, data: withProcess(request) });
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

    const found = await query(
      `SELECT r.*, c.name AS cooperative_name
         FROM cooperative_requests r
         LEFT JOIN cooperatives c ON c.id = r.cooperative_id
        WHERE r.id = $1`,
      [req.params.id]
    );
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

      // Stage 2 of the statutory procedure has to be finished as well: the
      // assets distributed and the original certificate handed back. Approving
      // before that would strike off a cooperative whose creditors and members
      // have not been paid.
      if (decision === "approved" && r.dissolution_stage !== "complete") {
        return res.status(409).json({
          success: false,
          message:
            "The dissolution is still at the distribution stage. The liquidator's report, " +
            "payment of creditors, distribution of what remains and the return of the original " +
            "certificate must all be recorded before the cooperative can be struck off.",
          dissolutionStage: r.dissolution_stage,
          requiresDistribution: true,
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
        // A dissolution moving up the chain is reported to every level above
        // it, not only to the desk it lands on, so the RCA can see a case
        // approaching rather than being handed it.
        await notifyOversight({
          levels:
            r.request_type === "dissolution"
              ? (STAGE_ORDER.slice(nextIndex) as Array<"sector" | "district" | "rca">)
              : [next],
          sector: r.sector,
          title: `Cooperative ${r.request_type} request forwarded`,
          message: outcomeMessage,
        });
      } else {
        // Final approval at RCA — the request takes effect.
        newStatus = "approved";
        newStage = "closed";

        // ── An issue report is RULED ON, not executed ────────────────────
        // It must never fall through to the branch below, which strikes a
        // cooperative off the register: approving "yes, this complaint is
        // founded" would have dissolved the very cooperative the member was
        // trying to get help for.
        if (r.request_type === "issue_report") {
          await query(
            `UPDATE cooperative_requests SET issue_resolution = $2, updated_at = NOW()
              WHERE id = $1`,
            [r.id, note ? String(note).trim() : null]
          );
          outcomeMessage =
            `${r.reference} has been ruled on by the RCA. The report was upheld` +
            (note ? `: ${String(note).trim()}` : ".");

          // The cooperative's office is told the outcome — but the reporter's
          // name is withheld when they asked for that, which is the whole
          // reason the confidential flag exists.
          if (r.cooperative_id) {
            await broadcastToCooperative({
              cooperativeId: r.cooperative_id,
              senderId: actor.id,
              senderName: "RCA",
              subject: `RCA ruling on a reported issue (${r.reference})`,
              body:
                `An issue raised about ${r.cooperative_name ?? "the cooperative"} has been ` +
                `reviewed by the sector officer, the district office and the RCA.\n\n` +
                `Finding: ${note ? String(note).trim() : "the report was upheld."}\n\n` +
                (r.issue_confidential
                  ? "The member who raised it asked not to be named."
                  : ""),
              link: "/rca-services",
            });
          }
        } else if (r.request_type === "formation") {
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
          // The members are told BEFORE their accounts are detached from the
          // cooperative — a moment later there would be nobody left to tell.
          await broadcastToCooperative({
            cooperativeId: r.cooperative_id,
            senderId: actor.id,
            senderName: actor.name,
            subject: `${r.cooperative_name ?? "The cooperative"} has been dissolved (${r.reference})`,
            body:
              `The RCA has approved the dissolution of ${r.cooperative_name ?? "the cooperative"} ` +
              `under ${r.reference}. The cooperative has been removed from the active register ` +
              "and its operating permit is revoked.\n\n" +
              (r.liquidator_name
                ? `${r.liquidator_name}, the liquidator appointed by the general assembly, has ` +
                  "reported to the second assembly on the recovery of loans, the payment of " +
                  "creditors and the distribution of what remained.\n\n"
                : "") +
              "Your login remains active so you can still reach your own records and any " +
              "certificate issued to you. If you believe anything is outstanding, contact your " +
              `${r.sector} sector cooperative officer.`,
            link: "/cooperative-requests",
          });

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
      data: withProcess(updated.rows[0]),
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
