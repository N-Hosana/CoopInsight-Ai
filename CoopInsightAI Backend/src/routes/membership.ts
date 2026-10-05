import { Router, Request, Response } from "express";
import { query, getClient } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import {
  AssemblyCall,
  CONVENER_TITLE_KEYWORDS,
  DELEGATE_THRESHOLD_MEMBERS,
  NOTICE_DAYS,
  QUORUM_FRACTION,
  SECOND_CALL_WINDOW,
  addDays,
  addWorkingDays,
  assemblyPolicy,
  quorumBasis,
  quorumRequired,
  reportDeadlines,
  voteCarries,
} from "../services/governance";
import {
  INSTRUCTION_TO_METHOD,
  SETTLEMENT_METHODS,
  SETTLEMENT_METHOD_LABELS,
  calculateSettlement,
} from "../services/settlement";
import {
  EXIT_STEP_DEFINITIONS,
  buildExitProcess,
  certificateStatement,
} from "../services/exitProcess";
import { broadcastToCooperative } from "../services/broadcast";
import { assemblyDateTime, registerAllMembers } from "../services/assemblies";

const router = Router();

router.use(authenticate);

/**
 * Published service level: how long the cooperative has to respond to a member's
 * request to be removed. Surfaced to the member at submission and stamped onto
 * the row as response_due_at so the deadline never moves afterwards.
 */
export const RESPONSE_WINDOW_DAYS = 14;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GENERAL ASSEMBLY DECIDES, NOT THE MANAGER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member is a co-owner, not an employee, so nobody in the office can sign them
 * out of the cooperative. Their request convenes a general assembly: the members
 * hear the reasons the member gave, debate them, and vote. The manager then
 * records the decision the assembly actually reached — which is why the decision
 * endpoint below refuses to approve a removal that no meeting resolved on.
 *
 * The rules that govern that assembly are NOT local configuration. They come
 * from the RCA brochure and live in `services/governance.ts`; this route only
 * applies them. Specifically:
 *
 *   • A removal request cannot wait for the March or October ordinary assembly,
 *     so it is convened as an EXTRAORDINARY assembly — 3 days' notice, and a
 *     three-quarters quorum on the first call.
 *   • If the first call fails, a second is called within 3 working days and
 *     needs only one half.
 *   • If two calls fail, the matter goes to the National Agency for direction.
 *   • Releasing a member is ordinary business, not one of the matters the
 *     brochure reserves to a three-quarters majority, so it carries on an
 *     absolute majority of the votes cast.
 */
const ASSEMBLY_KIND = "extraordinary" as const;
/** Releasing a member is not among the brochure's reserved matters. */
const ASSEMBLY_MATTER = "ordinary_business" as const;

const MEETING_RESOLUTIONS = ["approve_exit", "reject_exit", "deferred"];

/** What each assembly resolution allows the cooperative to record afterwards. */
const RESOLUTION_TO_DECISION: Record<string, "approved" | "rejected" | null> = {
  approve_exit: "approved",
  reject_exit: "rejected",
  deferred: null,
};

/** Statuses in which a request is still live and cannot be filed over. */
const OPEN_STATUSES = ["pending", "under_review", "meeting_scheduled", "meeting_held"];

const REASON_CATEGORIES = [
  "relocation",
  "financial_hardship",
  "joining_another_cooperative",
  "dissatisfied_with_management",
  "health",
  "retirement",
  "business_closed",
  "other",
];

const SAVINGS_INSTRUCTIONS = [
  "refund_mobile_money",
  "refund_bank_transfer",
  "refund_cash",
  "donate_to_cooperative",
  "no_savings_held",
];

const REVIEWER_ROLES = ["manager", "admin", "generalManager", "cooperative"];

const MIN_REASON_LENGTH = 20;

const SELECT_REQUEST = `
  SELECT r.*,
         c.name  AS cooperative_name,
         u.name  AS requester_name,
         u.email AS requester_email,
         m.membership_number,
         m.total_savings AS member_savings,
         d.name  AS decided_by_name,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', g.id,
              'scheduledFor', g.scheduled_for,
              'location', g.location,
              'agenda', g.agenda,
              'status', g.status,
              'membersEligible', g.members_eligible,
              'membersPresent', g.members_present,
              'quorumRequired', g.quorum_required,
              'quorumMet', g.quorum_met,
              'votesFor', g.votes_for,
              'votesAgainst', g.votes_against,
              'votesAbstain', g.votes_abstain,
              'resolution', g.resolution,
              'resolutionNote', g.resolution_note,
              'minutesUrl', g.minutes_url,
              'heldAt', g.held_at,
              'cancellationReason', g.cancellation_reason,
              'convenedByName', cb.name,
              'activityId', g.activity_id,
              'assemblyKind', g.assembly_kind,
              'callNumber', g.call_number,
              'secondCallDueBy', g.second_call_due_by,
              'referredToAgencyAt', g.referred_to_agency_at,
              'reportDueLocalAt', g.report_due_local_at,
              'reportDueAgencyAt', g.report_due_agency_at,
              'reportedLocalAt', g.reported_local_at,
              'reportedAgencyAt', g.reported_agency_at,
              'eligibleBasis', g.eligible_basis,
              'chairedByName', g.chaired_by_name,
              'minutedByName', g.minuted_by_name,
              'createdAt', g.created_at) ORDER BY g.created_at)
              FROM membership_exit_meetings g
              LEFT JOIN users cb ON cb.id = g.convened_by
             WHERE g.exit_request_id = r.id), '[]') AS meetings,
         m.archived_at AS member_archived_at,
         (SELECT row_to_json(s) FROM (
            SELECT st.*, ru.name AS recorded_by_name
              FROM membership_exit_settlements st
              LEFT JOIN users ru ON ru.id = st.recorded_by
             WHERE st.exit_request_id = r.id) s) AS settlement,
         (SELECT row_to_json(cert) FROM (
            SELECT mc.id, mc.certificate_number, mc.verification_code, mc.issued_at,
                   mc.issued_by_name, mc.statement, mc.months_of_membership,
                   mc.joined_on, mc.left_on, mc.roles_held, mc.total_contributions,
                   mc.settlement_amount, mc.cooperative_name, mc.registration_number,
                   mc.member_name, mc.membership_number, mc.revoked_at
              FROM membership_certificates mc
             WHERE mc.exit_request_id = r.id AND mc.revoked_at IS NULL
             ORDER BY mc.issued_at DESC LIMIT 1) cert) AS certificate
    FROM membership_exit_requests r
    JOIN cooperatives c ON c.id = r.cooperative_id
    JOIN users u        ON u.id = r.requested_by
    LEFT JOIN members m ON m.id = r.member_id
    LEFT JOIN users d   ON d.id = r.decided_by
`;

/**
 * Attaches the seven-step process to a request row.
 *
 * Every response that carries a request carries its process, because the whole
 * point of the rework is that nobody — member or manager — has to infer what
 * happens next from a bare status string.
 */
function withProcess<T extends Record<string, any>>(row: T) {
  if (!row) return row;
  return {
    ...row,
    process: buildExitProcess({
      status: row.status,
      createdAt: row.created_at ?? null,
      decidedAt: row.decided_at ?? null,
      meetings: Array.isArray(row.meetings) ? row.meetings : [],
      settlement: row.settlement ?? null,
      certificate: row.certificate ?? null,
      memberArchivedAt: row.member_archived_at ?? null,
    }),
  };
}

/**
 * A `member` user and their row in the members register are separate records
 * with no foreign key between them, so they are matched within the cooperative
 * on national ID, then phone, then name. Returns null when the signed-in user
 * has no matching entry in the register — the request is still allowed, it just
 * carries no member_id.
 */
async function resolveMemberForUser(userId: string, cooperativeId: string) {
  const res = await query(
    `SELECT m.id, m.membership_number, m.total_savings, m.full_name
       FROM members m
       JOIN users u ON u.id = $1
      WHERE m.cooperative_id = $2
        AND m.deleted_at IS NULL
        AND (
          (u.national_id IS NOT NULL AND m.national_id = u.national_id)
          OR (u.phone IS NOT NULL AND m.phone = u.phone)
          OR LOWER(m.full_name) = LOWER(u.name)
        )
      ORDER BY
        CASE
          WHEN u.national_id IS NOT NULL AND m.national_id = u.national_id THEN 1
          WHEN u.phone IS NOT NULL AND m.phone = u.phone THEN 2
          ELSE 3
        END
      LIMIT 1`,
    [userId, cooperativeId]
  );
  return res.rows[0] ?? null;
}

async function notifyReviewers(cooperativeId: string, title: string, message: string) {
  const reviewers = await query(
    `SELECT id FROM users
      WHERE status = 'active'
        AND (
          (role IN ('manager','cooperative') AND cooperative_id = $1)
          OR role IN ('admin','generalManager')
        )`,
    [cooperativeId]
  );
  for (const r of reviewers.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'alert','/membership')`,
      [r.id, title, message]
    );
  }
  return reviewers.rowCount ?? 0;
}

// ─── GET /policy ──────────────────────────────────────────────────────────────
// The response-time commitment, and the option lists the form is built from.
router.get("/policy", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      responseWindowDays: RESPONSE_WINDOW_DAYS,
      reasonCategories: REASON_CATEGORIES,
      savingsInstructions: SAVINGS_INSTRUCTIONS,
      minReasonLength: MIN_REASON_LENGTH,
      // The published procedure. The portal renders this, so a member reads the
      // same seven steps the server enforces.
      process: {
        steps: EXIT_STEP_DEFINITIONS,
        summary:
          "A member cannot be signed out of a cooperative by the office. The request convenes a " +
          "general assembly, the members vote, the cooperative settles the member's savings, " +
          "shares and loans, the release is recorded, and the cooperative issues a certificate " +
          "of past membership before the register entry is archived.",
      },
      settlement: {
        methods: SETTLEMENT_METHODS,
        methodLabels: SETTLEMENT_METHOD_LABELS,
        explanation:
          "What the member walks away with is their own savings, share capital and special " +
          "levies, plus their share of the cooperative's distributable net worth, less any " +
          "outstanding loans. The figure must be recorded against the request before the " +
          "release can be entered.",
      },
      meeting: {
        ...assemblyPolicy(ASSEMBLY_KIND, ASSEMBLY_MATTER),
        resolutions: MEETING_RESOLUTIONS,
        explanation:
          "A member's request to leave is decided by the general assembly, not by the office. " +
          "Because it cannot wait for the March or October ordinary assembly it is convened as " +
          `an extraordinary assembly: at least ${NOTICE_DAYS.extraordinary} days' notice, and ` +
          `${Math.round(QUORUM_FRACTION.extraordinary.first * 100)}% of those entitled to sit ` +
          "must attend for the first call to be competent. If that fails, a second call within " +
          `${SECOND_CALL_WINDOW.extraordinary.amount} ${SECOND_CALL_WINDOW.extraordinary.unit} ` +
          `needs ${Math.round(QUORUM_FRACTION.extraordinary.second * 100)}%. Releasing a member ` +
          "is ordinary business, so it carries on an absolute majority of the votes cast. If two " +
          "calls fail to reach quorum the matter goes to the RCA for direction.",
      },
    },
  });
});

// ─── GET /exit-requests/mine ──────────────────────────────────────────────────
// Everything the signed-in user has filed, newest first.
router.get("/exit-requests/mine", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `${SELECT_REQUEST} WHERE r.requested_by = $1 ORDER BY r.created_at DESC`,
      [req.user!.userId]
    );

    let memberRecord = null;
    if (req.user!.cooperativeId) {
      memberRecord = await resolveMemberForUser(req.user!.userId, req.user!.cooperativeId);
    }

    res.json({
      success: true,
      data: result.rows.map(withProcess),
      memberRecord,
      responseWindowDays: RESPONSE_WINDOW_DAYS,
    });
  } catch (err) {
    console.error("GET /membership/exit-requests/mine error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /settlement ──────────────────────────────────────────────────────────
// What a departing member would walk away with. Members get their own figure;
// reviewers may pass ?memberId= to price any member of their cooperative.
//
// The arithmetic lives in services/settlement.ts, because the same calculation
// has to produce the estimate shown here AND the settlement the cooperative
// records against the exit. Two copies of it would eventually disagree, and the
// member would be the one to discover that.
router.get("/settlement", async (req: Request, res: Response) => {
  try {
    const actor = await query(`SELECT role, cooperative_id FROM users WHERE id = $1`, [
      req.user!.userId,
    ]);
    const role = actor.rows[0]?.role as string;
    const isReviewer = REVIEWER_ROLES.includes(role);
    const requestedMemberId = req.query.memberId as string | undefined;

    let memberId: string | null = null;
    let cooperativeId: string | null = req.user!.cooperativeId ?? null;

    if (requestedMemberId) {
      if (!isReviewer) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      const m = await query(`SELECT id, cooperative_id FROM members WHERE id = $1`, [
        requestedMemberId,
      ]);
      if (m.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }
      if (
        ["manager", "cooperative"].includes(role) &&
        m.rows[0].cooperative_id !== req.user!.cooperativeId
      ) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      memberId = m.rows[0].id;
      cooperativeId = m.rows[0].cooperative_id;
    } else {
      if (!cooperativeId) {
        return res.status(400).json({
          success: false,
          message: "Your account is not linked to a cooperative.",
        });
      }
      const own = await resolveMemberForUser(req.user!.userId, cooperativeId);
      if (!own) {
        return res.status(404).json({
          success: false,
          message:
            "We could not match your account to an entry in the member register, so no " +
            "settlement can be calculated.",
        });
      }
      memberId = own.id;
    }

    const settlement = await calculateSettlement(memberId!, cooperativeId!);
    if (!settlement) {
      return res.status(404).json({ success: false, message: "Member or cooperative not found" });
    }

    res.json({ success: true, data: settlement });
  } catch (err) {
    console.error("GET /membership/settlement error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// ─── POST /exit-requests ──────────────────────────────────────────────────────
router.post("/exit-requests", async (req: Request, res: Response) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        message: "Your account is not linked to a cooperative, so there is nothing to withdraw from.",
      });
    }

    const {
      reasonCategory,
      reasonDetail,
      preferredExitDate,
      savingsInstruction,
      contactPhone,
      acknowledgedTerms,
    } = req.body;

    if (!reasonCategory || !REASON_CATEGORIES.includes(reasonCategory)) {
      return res.status(400).json({
        success: false,
        message: `reasonCategory must be one of: ${REASON_CATEGORIES.join(", ")}`,
      });
    }
    if (!reasonDetail || String(reasonDetail).trim().length < MIN_REASON_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Please explain your reason in at least ${MIN_REASON_LENGTH} characters so the cooperative can act on it.`,
      });
    }
    if (savingsInstruction && !SAVINGS_INSTRUCTIONS.includes(savingsInstruction)) {
      return res.status(400).json({
        success: false,
        message: `savingsInstruction must be one of: ${SAVINGS_INSTRUCTIONS.join(", ")}`,
      });
    }
    if (acknowledgedTerms !== true) {
      return res.status(400).json({
        success: false,
        message: "You must confirm you understand the effect of withdrawing before submitting.",
      });
    }
    if (preferredExitDate && Number.isNaN(Date.parse(preferredExitDate))) {
      return res.status(400).json({ success: false, message: "preferredExitDate is not a valid date." });
    }

    const open = await query(
      `SELECT id FROM membership_exit_requests
        WHERE requested_by = $1 AND status = ANY($2::text[])`,
      [req.user!.userId, OPEN_STATUSES]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: "You already have a removal request awaiting a response. Withdraw it before filing another.",
      });
    }

    const member = await resolveMemberForUser(req.user!.userId, cooperativeId);

    const result = await query(
      `INSERT INTO membership_exit_requests
         (cooperative_id, member_id, requested_by, reason_category, reason_detail,
          preferred_exit_date, savings_instruction, contact_phone, acknowledged_terms,
          status, response_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'pending', NOW() + ($9 || ' days')::interval)
       RETURNING id`,
      [
        cooperativeId,
        member?.id ?? null,
        req.user!.userId,
        reasonCategory,
        String(reasonDetail).trim(),
        preferredExitDate || null,
        savingsInstruction || "refund_mobile_money",
        contactPhone || null,
        String(RESPONSE_WINDOW_DAYS),
      ]
    );

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [result.rows[0].id]);
    const request = created.rows[0];

    const notified = await notifyReviewers(
      cooperativeId,
      "Membership removal request",
      `${request.requester_name} has requested removal from ${request.cooperative_name}. ` +
        `A general assembly must be convened to decide it, and a response is due by ` +
        `${new Date(request.response_due_at).toLocaleDateString()}.`
    );

    res.status(201).json({
      success: true,
      message:
        `Request submitted. ${request.cooperative_name} must call a general assembly to decide it ` +
        `and respond within ${RESPONSE_WINDOW_DAYS} days.`,
      data: withProcess(request),
      notifiedReviewers: notified,
    });
  } catch (err) {
    console.error("POST /membership/exit-requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /exit-requests/:id/withdraw ────────────────────────────────────────
// The member changes their mind before a decision is made.
router.patch("/exit-requests/:id/withdraw", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE membership_exit_requests
          SET status = 'withdrawn', updated_at = NOW()
        WHERE id = $1 AND requested_by = $2 AND status = ANY($3::text[])
        RETURNING id`,
      [req.params.id, req.user!.userId, OPEN_STATUSES]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No open request of yours was found to withdraw.",
      });
    }

    // Withdrawing kills any assembly that was called for it — there is nothing
    // left to decide, and leaving the meeting on the calendar wastes members' time.
    const cancelled = await query(
      `UPDATE membership_exit_meetings
          SET status = 'cancelled',
              cancellation_reason = 'The member withdrew their request before the assembly sat.',
              updated_at = NOW()
        WHERE exit_request_id = $1 AND status = 'scheduled'
        RETURNING activity_id`,
      [req.params.id]
    );
    for (const row of cancelled.rows) {
      if (row.activity_id) {
        await query(
          `UPDATE activities
              SET status = 'cancelled',
                  cancellation_reason = 'The member withdrew their removal request.',
                  updated_at = NOW()
            WHERE id = $1`,
          [row.activity_id]
        );
      }
    }

    res.json({
      success: true,
      message:
        cancelled.rowCount
          ? "Request withdrawn, and the general assembly called to decide it has been cancelled."
          : "Request withdrawn.",
    });
  } catch (err) {
    console.error("PATCH /membership/exit-requests/:id/withdraw error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /exit-requests ───────────────────────────────────────────────────────
// Reviewer queue. Managers see only their own cooperative; admins see everything.
router.get("/exit-requests", authorize(...REVIEWER_ROLES), async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const role = req.user!.role;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (["manager", "cooperative"].includes(role)) {
      if (!req.user!.cooperativeId) {
        return res.json({ success: true, data: [], responseWindowDays: RESPONSE_WINDOW_DAYS });
      }
      params.push(req.user!.cooperativeId);
      conditions.push(`r.cooperative_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(OPEN_STATUSES);
    const result = await query(
      `${SELECT_REQUEST} ${where}
       ORDER BY
         CASE WHEN r.status = ANY($${params.length}::text[]) THEN 0 ELSE 1 END,
         r.response_due_at ASC`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map(withProcess),
      responseWindowDays: RESPONSE_WINDOW_DAYS,
      meetingRules: assemblyPolicy(ASSEMBLY_KIND, ASSEMBLY_MATTER),
    });
  } catch (err) {
    console.error("GET /membership/exit-requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /exit-requests/:id ───────────────────────────────────────────────────
// One request with its meetings. The member who filed it and any reviewer of the
// cooperative may read it.
router.get("/exit-requests/:id", async (req: Request, res: Response) => {
  try {
    const result = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const request = result.rows[0];
    const role = req.user!.role;
    const isOwner = request.requested_by === req.user!.userId;
    const isReviewer =
      REVIEWER_ROLES.includes(role) &&
      (["admin", "generalManager"].includes(role) || request.cooperative_id === req.user!.cooperativeId);

    if (!isOwner && !isReviewer) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({
      success: true,
      data: withProcess(request),
      meetingRules: assemblyPolicy(ASSEMBLY_KIND, ASSEMBLY_MATTER),
    });
  } catch (err) {
    console.error("GET /membership/exit-requests/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * Loads a request and checks the caller may act on it as a reviewer. Returns the
 * row, or null after having already answered the response.
 */
async function loadForReview(req: Request, res: Response) {
  const found = await query(
    `SELECT r.*, c.name AS cooperative_name, u.name AS requester_name
       FROM membership_exit_requests r
       JOIN cooperatives c ON c.id = r.cooperative_id
       JOIN users u        ON u.id = r.requested_by
      WHERE r.id = $1`,
    [req.params.id]
  );
  if (found.rowCount === 0) {
    res.status(404).json({ success: false, message: "Request not found" });
    return null;
  }
  const request = found.rows[0];
  if (
    ["manager", "cooperative"].includes(req.user!.role) &&
    request.cooperative_id !== req.user!.cooperativeId
  ) {
    res.status(403).json({ success: false, message: "Access denied" });
    return null;
  }
  return request;
}

// ─── POST /exit-requests/:id/meeting ──────────────────────────────────────────
// Convene the general assembly that will decide the request.
//
// The meeting is written into the activities calendar as well as its own table,
// so it appears alongside every other cooperative event and its attendance is
// recorded the same way. Members of the cooperative are notified, because an
// assembly nobody was told about is not an assembly.
router.post(
  "/exit-requests/:id/meeting",
  authorize(...REVIEWER_ROLES),
  async (req: Request, res: Response) => {
    try {
      const request = await loadForReview(req, res);
      if (!request) return;

      if (!["pending", "under_review"].includes(request.status)) {
        return res.status(409).json({
          success: false,
          message:
            request.status === "meeting_scheduled"
              ? "An assembly has already been called for this request. Cancel it before calling another."
              : `This request is ${request.status} and no longer needs an assembly.`,
        });
      }

      // Which call is this? A first call that failed quorum entitles the
      // cooperative to a second on a lower threshold; anything beyond that goes
      // to the RCA rather than being put to the members a third time.
      const priorCalls = await query(
        `SELECT id, call_number, quorum_met, second_call_due_by
           FROM membership_exit_meetings
          WHERE exit_request_id = $1 AND status = 'held'
          ORDER BY call_number DESC LIMIT 1`,
        [request.id]
      );
      const prior = priorCalls.rows[0];
      const callNumber: AssemblyCall = prior && prior.quorum_met === false ? 2 : 1;

      if (prior && prior.call_number >= 2 && prior.quorum_met === false) {
        return res.status(409).json({
          success: false,
          message:
            "Two calls have already failed to reach quorum. Under the RCA rules the matter now " +
            "goes to the National Agency for direction rather than to a third assembly.",
          referToAgency: true,
        });
      }

      const { scheduledFor, location, agenda } = req.body;
      if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
        return res.status(400).json({
          success: false,
          message: "scheduledFor must be the date and time the assembly will sit.",
        });
      }

      const when = new Date(scheduledFor);
      const noticeDays = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
      const requiredNotice = NOTICE_DAYS[ASSEMBLY_KIND];
      if (noticeDays < requiredNotice) {
        return res.status(400).json({
          success: false,
          message:
            `An extraordinary assembly needs at least ${requiredNotice} days' notice under the ` +
            `RCA rules. The date you chose is ${noticeDays} day(s) away.`,
        });
      }
      // A second call must follow the failed first within the brochure's window.
      if (callNumber === 2 && prior?.second_call_due_by) {
        // second_call_due_by is a DATE, so it arrives as midnight. The deadline
        // is the end of that day — comparing a 10am meeting against 00:00 would
        // reject the last day the rules actually allow.
        const dueBy = new Date(prior.second_call_due_by);
        dueBy.setHours(23, 59, 59, 999);
        if (when > dueBy) {
          return res.status(400).json({
            success: false,
            message:
              `The second call must sit by ${dueBy.toLocaleDateString()} — within ` +
              `${SECOND_CALL_WINDOW[ASSEMBLY_KIND].amount} ` +
              `${SECOND_CALL_WINDOW[ASSEMBLY_KIND].unit} of the failed first call.`,
          });
        }
      }
      if (!location || !String(location).trim()) {
        return res.status(400).json({ success: false, message: "A meeting location is required." });
      }

      // Above 100 members the assembly is a body of elected delegates, not the
      // whole register, so quorum is counted against the delegates. The delegate
      // count is set by the National Agency and cannot be derived, so a
      // cooperative over the threshold with none recorded is told to record it
      // rather than being silently measured against the wrong denominator.
      const eligible = await query(
        `SELECT
           (SELECT COUNT(*) FROM members
             WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active') AS members,
           (SELECT delegate_count FROM cooperatives WHERE id = $1) AS delegates`,
        [request.cooperative_id]
      );
      const activeMembers = parseInt(eligible.rows[0].members, 10);
      const delegateCount = eligible.rows[0].delegates as number | null;
      const usesDelegates = activeMembers > DELEGATE_THRESHOLD_MEMBERS;

      if (usesDelegates && !delegateCount) {
        return res.status(409).json({
          success: false,
          message:
            `${request.cooperative_name} has ${activeMembers} members, so its general assembly ` +
            `is made up of delegates elected by their peers rather than of every member. ` +
            "Record the number of delegates on the cooperative before calling an assembly, or " +
            "quorum would be counted against the wrong body.",
          needsDelegateCount: true,
        });
      }

      const membersEligible = usesDelegates ? (delegateCount as number) : activeMembers;
      const eligibleBasis = usesDelegates ? "delegates" : "members";
      const requiredQuorum = quorumRequired(ASSEMBLY_KIND, callNumber, membersEligible);

      const title = `General Assembly — removal request: ${request.requester_name}`;
      const defaultAgenda =
        `1. Confirm quorum.\n` +
        `2. Read the removal request filed by ${request.requester_name} on ` +
        `${new Date(request.created_at).toLocaleDateString()}.\n` +
        `3. Hear the member's stated reason: ${request.reason_category.replace(/_/g, " ")}.\n` +
        `4. Debate whether the reasons justify release from membership.\n` +
        `5. Settle the member's savings, share capital and outstanding loans.\n` +
        `6. Vote and minute the resolution.`;

      // The wall-clock date and time as typed — toISOString() shifted a 10:00
      // assembly in Kigali to 08:00 on the activity.
      const sits = assemblyDateTime(String(scheduledFor));
      const activity = await query(
        `INSERT INTO activities
           (cooperative_id, title, type, status, date, start_time, location, description,
            objectives, budget, actual_cost, created_by)
         VALUES ($1,$2,'meeting','planned',$3,$4,$5,$6,$7,0,0,$8)
         RETURNING id`,
        [
          request.cooperative_id,
          title,
          sits.date,
          sits.time,
          String(location).trim(),
          `Extraordinary general assembly convened to decide the removal request filed by ` +
            `${request.requester_name}.`,
          JSON.stringify([
            "Hear the member's reasons for leaving",
            "Confirm the settlement owed to or by the member",
            "Resolve whether to release the member from the cooperative",
          ]),
          req.user!.userId,
        ]
      );

      const meeting = await query(
        `INSERT INTO membership_exit_meetings
           (exit_request_id, cooperative_id, activity_id, scheduled_for, location, agenda,
            convened_by, status, members_eligible, quorum_required,
            assembly_kind, call_number, follows_meeting_id, eligible_basis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          request.id,
          request.cooperative_id,
          activity.rows[0].id,
          when.toISOString(),
          String(location).trim(),
          agenda && String(agenda).trim() ? String(agenda).trim() : defaultAgenda,
          req.user!.userId,
          membersEligible,
          requiredQuorum,
          ASSEMBLY_KIND,
          callNumber,
          callNumber === 2 ? prior.id : null,
          eligibleBasis,
        ]
      );

      // Every active member is on the meeting's register, so it is on their
      // own activities and attendance is taken against the whole membership.
      const membersRegistered = await registerAllMembers(activity.rows[0].id, request.cooperative_id);

      await query(
        `UPDATE membership_exit_requests SET status = 'meeting_scheduled', updated_at = NOW()
          WHERE id = $1`,
        [request.id]
      );

      // The member who filed it hears about it personally.
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'General assembly called on your request',$2,'alert','/membership')`,
        [
          request.requested_by,
          `${request.cooperative_name} has called a general assembly for ` +
            `${when.toLocaleDateString()} at ${String(location).trim()} to decide your removal request.`,
        ]
      );

      // ── And every member is sent the notice as a message ──────────────────
      // A bell notification disappears the moment it is dismissed. A notice of
      // assembly has to be readable weeks later, because a member who says they
      // were never told is making a claim the cooperative must be able to
      // answer. Convening therefore broadcasts a proper message to the whole
      // cooperative, carrying the four things an invitation must state: time,
      // date, venue and agenda.
      const noticeAgenda =
        agenda && String(agenda).trim() ? String(agenda).trim() : defaultAgenda;
      const broadcast = await broadcastToCooperative({
        cooperativeId: request.cooperative_id,
        senderId: req.user!.userId,
        senderName: req.user!.name,
        subject: `Notice of general assembly — ${when.toLocaleDateString()}`,
        body:
          `An ${ASSEMBLY_KIND} general assembly of ${request.cooperative_name} is called for ` +
          `${when.toLocaleDateString()} at ${when.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}, at ${String(location).trim()}.\n\n` +
          `Purpose: to decide the request by ${request.requester_name} to be released from ` +
          `membership.\n\n` +
          `Quorum: ${requiredQuorum} of ${membersEligible} ${eligibleBasis} must attend for this ` +
          `assembly (call ${callNumber}) to be competent to decide. Releasing a member carries on ` +
          `an absolute majority of the votes cast.\n\n` +
          `Agenda:\n${noticeAgenda}\n\n` +
          `Please attend. If quorum is not reached a second call must be held within ` +
          `${SECOND_CALL_WINDOW[ASSEMBLY_KIND].amount} ${SECOND_CALL_WINDOW[ASSEMBLY_KIND].unit}.`,
        // The notification opens the meeting itself on the activities page.
        link: `/activities/${activity.rows[0].id}`,
      });

      const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
      res.status(201).json({
        success: true,
        message:
          `General assembly called for ${when.toLocaleDateString()}. It is on the activities ` +
          `calendar with all ${membersRegistered} active member(s) registered, and the notice has ` +
          `been sent to ${broadcast.accountsReached} member account(s). ` +
          `${requiredQuorum} of ${membersEligible} ${eligibleBasis} must attend for the vote to stand ` +
          `(${ASSEMBLY_KIND} assembly, call ${callNumber}).` +
          (broadcast.note ? ` ${broadcast.note}` : ""),
        data: withProcess(updated.rows[0]),
        meetingId: meeting.rows[0].id,
        notifiedMembers: broadcast.accountsReached,
        broadcast,
      });
    } catch (err) {
      console.error("POST /membership/exit-requests/:id/meeting error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─── PATCH /exit-requests/:id/meeting/:meetingId ──────────────────────────────
// Record what the assembly actually resolved.
//
// Quorum and the majority are computed here rather than taken on trust: a
// resolution carried by four people out of forty is not a resolution, and the
// system should say so before the decision is recorded against a member's name.
router.patch(
  "/exit-requests/:id/meeting/:meetingId",
  authorize(...REVIEWER_ROLES),
  async (req: Request, res: Response) => {
    try {
      const request = await loadForReview(req, res);
      if (!request) return;

      const found = await query(
        `SELECT * FROM membership_exit_meetings WHERE id = $1 AND exit_request_id = $2`,
        [req.params.meetingId, req.params.id]
      );
      if (found.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Meeting not found" });
      }
      const meeting = found.rows[0];
      if (meeting.status !== "scheduled") {
        return res.status(409).json({
          success: false,
          message: `This meeting is already marked ${meeting.status}.`,
        });
      }

      const { membersPresent, votesFor, votesAgainst, votesAbstain, resolution, resolutionNote, minutesUrl } =
        req.body;

      if (!resolution || !MEETING_RESOLUTIONS.includes(resolution)) {
        return res.status(400).json({
          success: false,
          message: `resolution must be one of: ${MEETING_RESOLUTIONS.join(", ")}`,
        });
      }
      const nums = { membersPresent, votesFor, votesAgainst, votesAbstain };
      for (const [key, value] of Object.entries(nums)) {
        if (value == null || Number.isNaN(Number(value)) || Number(value) < 0) {
          return res.status(400).json({
            success: false,
            message: `${key} is required and must be zero or more.`,
          });
        }
      }

      const present = Number(membersPresent);
      const forVotes = Number(votesFor);
      const againstVotes = Number(votesAgainst);
      const abstainVotes = Number(votesAbstain);
      const cast = forVotes + againstVotes + abstainVotes;

      if (cast > present) {
        return res.status(400).json({
          success: false,
          message: `${cast} votes were recorded but only ${present} members attended.`,
        });
      }
      if (meeting.members_eligible != null && present > meeting.members_eligible) {
        return res.status(400).json({
          success: false,
          message:
            `${present} attendees were recorded but the register holds only ` +
            `${meeting.members_eligible} active members.`,
        });
      }

      const requiredQuorum = meeting.quorum_required ?? 0;
      const quorumMet = present >= requiredQuorum;

      // A resolution requires quorum. Without it the meeting can only defer.
      if (!quorumMet && resolution !== "deferred") {
        return res.status(409).json({
          success: false,
          message:
            `Only ${present} of the ${meeting.members_eligible} ${meeting.eligible_basis} ` +
            `attended; ${requiredQuorum} were needed. Quorum for this assembly is ` +
            quorumBasis(ASSEMBLY_KIND, meeting.call_number as AssemblyCall, meeting.members_eligible) +
            " Record the meeting as deferred; " +
            (meeting.call_number === 1
              ? `a second call within ${SECOND_CALL_WINDOW[ASSEMBLY_KIND].amount} ` +
                `${SECOND_CALL_WINDOW[ASSEMBLY_KIND].unit} needs only ` +
                `${Math.round(QUORUM_FRACTION[ASSEMBLY_KIND].second * 100)}%.`
              : "as this was the second call, the matter now goes to the RCA for direction."),
        });
      }
      // And the arithmetic has to support what is being minuted.
      // Releasing a member is ordinary business, so the RCA's absolute-majority
      // rule applies: more than half of the votes cast. A tie does not carry and
      // the brochure says the vote is repeated.
      const outcome = voteCarries(ASSEMBLY_MATTER, forVotes, againstVotes, abstainVotes);
      if (resolution === "approve_exit" && !outcome.carried) {
        return res.status(409).json({
          success: false,
          message: `The vote does not carry a removal. ${outcome.basis}`,
        });
      }
      if (resolution === "reject_exit" && outcome.carried) {
        return res.status(409).json({
          success: false,
          message:
            `The vote carried in favour of the removal (${forVotes} of ${cast}), so it cannot be ` +
            "minuted as a refusal. Record it as approve_exit, or correct the figures.",
        });
      }
      if (resolution !== "deferred" && !String(resolutionNote ?? "").trim()) {
        return res.status(400).json({
          success: false,
          message:
            "Minute the assembly's reasoning. The member is entitled to know why the meeting " +
            "decided as it did.",
        });
      }

      // Two reporting clocks start the moment the assembly sits: the sector and
      // district administrations within 3 working days, the National Agency
      // within 7 days.
      const heldAt = new Date();
      const deadlines = reportDeadlines(heldAt);

      // A failed first call must be followed by a second inside the window; a
      // failed second call is the end of the road and goes to the RCA.
      const failedCall = !quorumMet;
      const isSecondCall = meeting.call_number === 2;
      const secondCallDueBy =
        failedCall && !isSecondCall
          ? SECOND_CALL_WINDOW[ASSEMBLY_KIND].unit === "working days"
            ? addWorkingDays(heldAt, SECOND_CALL_WINDOW[ASSEMBLY_KIND].amount)
            : addDays(heldAt, SECOND_CALL_WINDOW[ASSEMBLY_KIND].amount)
          : null;
      const referToAgency = failedCall && isSecondCall;

      await query(
        `UPDATE membership_exit_meetings
            SET status = 'held', members_present = $1, quorum_met = $2,
                votes_for = $3, votes_against = $4, votes_abstain = $5,
                resolution = $6, resolution_note = $7, minutes_url = $8,
                held_at = $9, recorded_by = $10,
                report_due_local_at = $11, report_due_agency_at = $12,
                second_call_due_by = $13, referred_to_agency_at = $14,
                chaired_by_name = $15, minuted_by_name = $16,
                updated_at = NOW()
          WHERE id = $17`,
        [
          present,
          quorumMet,
          forVotes,
          againstVotes,
          abstainVotes,
          resolution,
          resolutionNote ? String(resolutionNote).trim() : null,
          minutesUrl || null,
          heldAt.toISOString(),
          req.user!.userId,
          deadlines.sectorAndDistrict.toISOString(),
          deadlines.nationalAgency.toISOString(),
          secondCallDueBy ? secondCallDueBy.toISOString().slice(0, 10) : null,
          referToAgency ? heldAt.toISOString() : null,
          req.body.chairedBy ? String(req.body.chairedBy).trim() : null,
          req.body.minutedBy ? String(req.body.minutedBy).trim() : null,
          meeting.id,
        ]
      );

      // "If two calls fail to reach quorum, the matter goes to the National
      // Agency for direction." Telling the RCA is the whole point of that rule,
      // so it is done here rather than left to the cooperative to remember.
      if (referToAgency) {
        const officers = await query(
          `SELECT id FROM users
            WHERE status = 'active'
              AND (oversight_level IN ('sector','rca') OR role IN ('admin','generalManager'))`
        );
        for (const o of officers.rows) {
          await query(
            `INSERT INTO notifications (user_id, title, message, type, link)
             VALUES ($1,'Assembly failed twice — RCA direction needed',$2,'alert','/membership')`,
            [
              o.id,
              `${request.cooperative_name} called two assemblies to decide a member's removal ` +
                "request and neither reached quorum. Under the RCA rules the matter now comes to " +
                "the National Agency for direction.",
            ]
          );
        }
      }

      if (meeting.activity_id) {
        await query(
          `UPDATE activities
              SET status = 'completed',
                  outcome = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            meeting.activity_id,
            `Assembly ${quorumMet ? "reached quorum" : "failed to reach quorum"} with ${present} of ` +
              `${meeting.members_eligible} members present. Resolution: ${resolution.replace(/_/g, " ")}.`,
          ]
        );
      }

      // Deferred keeps the request alive for another assembly; anything else
      // moves it to the point where the office can record the decision.
      const nextStatus = resolution === "deferred" ? "under_review" : "meeting_held";
      await query(
        `UPDATE membership_exit_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nextStatus, request.id]
      );

      const outcomeText =
        resolution === "deferred"
          ? `The general assembly on your removal request was deferred${
              quorumMet ? "" : " because it did not reach quorum"
            }. Another assembly will be called.`
          : `The general assembly of ${request.cooperative_name} voted ${forVotes} to ${againstVotes} ` +
            `${resolution === "approve_exit" ? "to release you from membership" : "against releasing you from membership"}.`;

      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'General assembly outcome',$2,'alert','/membership')`,
        [request.requested_by, outcomeText]
      );

      const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
      res.json({
        success: true,
        message:
          resolution !== "deferred"
            ? `Meeting recorded. The assembly resolved to ${resolution.replace(/_/g, " ")}; ` +
              "record the formal decision to complete the request."
            : referToAgency
              ? "Meeting recorded. Two calls have now failed to reach quorum, so the matter goes " +
                "to the RCA for direction — a third assembly is not provided for. The sector and " +
                "RCA officers have been notified."
              : secondCallDueBy
                ? "Meeting recorded as deferred. Call the second assembly by " +
                  `${secondCallDueBy.toLocaleDateString()}; it needs only ` +
                  `${Math.round(QUORUM_FRACTION[ASSEMBLY_KIND].second * 100)}% to be competent.`
                : "Meeting recorded as deferred. Call another assembly to decide the request.",
        data: withProcess(updated.rows[0]),
        quorum: {
          required: requiredQuorum,
          present,
          met: quorumMet,
          basis: quorumBasis(
            ASSEMBLY_KIND,
            meeting.call_number as AssemblyCall,
            meeting.members_eligible
          ),
          call: meeting.call_number,
        },
        vote: outcome,
        reporting: {
          sectorAndDistrictDueBy: deadlines.sectorAndDistrict.toISOString(),
          nationalAgencyDueBy: deadlines.nationalAgency.toISOString(),
        },
        referredToAgency: referToAgency,
      });
    } catch (err) {
      console.error("PATCH /membership/exit-requests/:id/meeting/:meetingId error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─── PATCH /exit-requests/:id/meeting/:meetingId/cancel ───────────────────────
router.patch(
  "/exit-requests/:id/meeting/:meetingId/cancel",
  authorize(...REVIEWER_ROLES),
  async (req: Request, res: Response) => {
    try {
      const request = await loadForReview(req, res);
      if (!request) return;

      const { reason } = req.body;
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({
          success: false,
          message: "Give a reason for cancelling the assembly — the members were already notified.",
        });
      }

      const cancelled = await query(
        `UPDATE membership_exit_meetings
            SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW()
          WHERE id = $2 AND exit_request_id = $3 AND status = 'scheduled'
          RETURNING activity_id`,
        [String(reason).trim(), req.params.meetingId, req.params.id]
      );
      if (cancelled.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "No scheduled meeting was found to cancel.",
        });
      }
      if (cancelled.rows[0].activity_id) {
        await query(
          `UPDATE activities
              SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW()
            WHERE id = $2`,
          [String(reason).trim(), cancelled.rows[0].activity_id]
        );
      }

      await query(
        `UPDATE membership_exit_requests SET status = 'under_review', updated_at = NOW()
          WHERE id = $1 AND status = 'meeting_scheduled'`,
        [request.id]
      );
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'General assembly cancelled',$2,'alert','/membership')`,
        [
          request.requested_by,
          `The assembly called to decide your removal request was cancelled: ${String(reason).trim()}`,
        ]
      );

      const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
      res.json({ success: true, message: "Assembly cancelled.", data: withProcess(updated.rows[0]) });
    } catch (err) {
      console.error("PATCH /membership/exit-requests/:id/meeting/:meetingId/cancel error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);


// ─── GET /exit-requests/:id/settlement ────────────────────────────────────────
// Step 5, read side. Returns the settlement already recorded against the
// request, or — when none has been recorded yet — the live calculation the
// cooperative is about to record, so the manager fills the form with the real
// figures instead of retyping them.
router.get("/exit-requests/:id/settlement", async (req: Request, res: Response) => {
  try {
    const found = await query(
      `SELECT r.*, c.name AS cooperative_name, u.name AS requester_name
         FROM membership_exit_requests r
         JOIN cooperatives c ON c.id = r.cooperative_id
         JOIN users u        ON u.id = r.requested_by
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const request = found.rows[0];

    const role = req.user!.role;
    const isOwner = request.requested_by === req.user!.userId;
    const isReviewer =
      REVIEWER_ROLES.includes(role) &&
      (["admin", "generalManager"].includes(role) ||
        request.cooperative_id === req.user!.cooperativeId);
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const recorded = await query(
      `SELECT s.*, u.name AS recorded_by_name
         FROM membership_exit_settlements s
         LEFT JOIN users u ON u.id = s.recorded_by
        WHERE s.exit_request_id = $1`,
      [request.id]
    );

    const calculated = request.member_id
      ? await calculateSettlement(request.member_id, request.cooperative_id)
      : null;

    res.json({
      success: true,
      data: {
        recorded: recorded.rows[0] ?? null,
        calculated,
        // What the member asked for when they filed, so the cooperative does
        // not have to go and look it up.
        memberInstruction: request.savings_instruction,
        suggestedMethod:
          INSTRUCTION_TO_METHOD[request.savings_instruction as string] ?? "mobile_money",
        contactPhone: request.contact_phone,
        methods: SETTLEMENT_METHODS,
        methodLabels: SETTLEMENT_METHOD_LABELS,
        canRecord: isReviewer,
        notOnRegister: !request.member_id,
      },
    });
  } catch (err) {
    console.error("GET /membership/exit-requests/:id/settlement error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /exit-requests/:id/settlement ───────────────────────────────────────
// Step 5, write side: the cooperative RESOLVES the member's assets.
//
// This is the step the process was missing. Before it existed, a manager could
// approve a removal while the cooperative still held the member's savings, and
// nothing in the system would ever say so. Now the release cannot be recorded
// until this row exists.
//
// The figures are recomputed here rather than taken from the request body. A
// manager may override a line — the cooperative's audited accounts, not this
// system, are the final word — but an override must be explained, and the
// computed figures are stored alongside so the difference is visible.
router.post(
  "/exit-requests/:id/settlement",
  authorize(...REVIEWER_ROLES),
  async (req: Request, res: Response) => {
    try {
      const request = await loadForReview(req, res);
      if (!request) return;

      if (!OPEN_STATUSES.includes(request.status)) {
        return res.status(409).json({
          success: false,
          message: `This request is already ${request.status}; its settlement can no longer be recorded.`,
        });
      }

      // The assembly has to have released the member before their money is
      // paid out. Settling first would hand back savings on a request the
      // members might still refuse.
      const resolved = await query(
        `SELECT resolution, held_at FROM membership_exit_meetings
          WHERE exit_request_id = $1 AND status = 'held' AND resolution = 'approve_exit'
          ORDER BY held_at DESC LIMIT 1`,
        [request.id]
      );
      if (resolved.rowCount === 0) {
        return res.status(409).json({
          success: false,
          message:
            "No general assembly has resolved to release this member yet. Settle their savings " +
            "and shares only once the members have voted to let them go.",
          requiresMeeting: true,
        });
      }

      const existing = await query(
        `SELECT id FROM membership_exit_settlements WHERE exit_request_id = $1`,
        [request.id]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return res.status(409).json({
          success: false,
          message:
            "A settlement is already recorded against this request. It cannot be recorded twice; " +
            "correct it through the cooperative's accounts if the figures were wrong.",
        });
      }

      const {
        settlementMethod,
        paymentReference,
        amountPaid,
        settledOn,
        otherDeductions,
        otherDeductionsNote,
        notes,
      } = req.body;

      if (!settlementMethod || !(SETTLEMENT_METHODS as readonly string[]).includes(settlementMethod)) {
        return res.status(400).json({
          success: false,
          message: `settlementMethod must be one of: ${SETTLEMENT_METHODS.join(", ")}`,
        });
      }

      // The computed position, from the same code that produces the member's
      // own estimate.
      const computed = request.member_id
        ? await calculateSettlement(request.member_id, request.cooperative_id)
        : null;

      if (!computed && settlementMethod !== "nothing_due") {
        return res.status(409).json({
          success: false,
          message:
            "This account has no entry in the member register, so there is no savings or share " +
            "position to settle. Record the settlement as 'nothing_due', or correct the register " +
            "first.",
        });
      }

      const extraDeductions = otherDeductions != null ? Number(otherDeductions) : 0;
      if (Number.isNaN(extraDeductions) || extraDeductions < 0) {
        return res.status(400).json({
          success: false,
          message: "otherDeductions must be zero or a positive amount.",
        });
      }
      if (extraDeductions > 0 && !String(otherDeductionsNote ?? "").trim()) {
        return res.status(400).json({
          success: false,
          message:
            "A deduction beyond the member's outstanding loans has to be explained. The member " +
            "is entitled to know what was taken off and why.",
        });
      }

      const gross = computed?.grossEntitlement ?? 0;
      const loans = computed?.deductions.outstandingLoans ?? 0;
      const netPayable = Math.max(0, gross - loans - extraDeductions);
      const owedByMember = Math.max(0, loans + extraDeductions - gross);

      const paid = amountPaid != null ? Number(amountPaid) : netPayable;
      if (Number.isNaN(paid) || paid < 0) {
        return res.status(400).json({ success: false, message: "amountPaid must be zero or more." });
      }
      if (paid > netPayable) {
        return res.status(400).json({
          success: false,
          message:
            `RWF ${paid.toLocaleString()} was entered as paid but only RWF ` +
            `${netPayable.toLocaleString()} is due. Correct the figure, or record the difference ` +
            "as a separate transaction in the cooperative's books.",
        });
      }
      // Paying out less than is due, without saying why, is how a member ends
      // up short and nobody can explain it afterwards.
      if (paid < netPayable && !String(notes ?? "").trim()) {
        return res.status(400).json({
          success: false,
          message:
            `RWF ${netPayable.toLocaleString()} is due but RWF ${paid.toLocaleString()} was paid. ` +
            "Explain the difference in the notes — an instalment plan, a disputed figure, " +
            "whatever it is — so the member and the auditor can both read it.",
        });
      }
      if (
        ["mobile_money", "bank_transfer"].includes(settlementMethod) &&
        paid > 0 &&
        !String(paymentReference ?? "").trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A mobile money or bank payment needs its transaction reference. Without one there " +
            "is nothing to check the payment against.",
        });
      }

      const inserted = await query(
        `INSERT INTO membership_exit_settlements
           (exit_request_id, cooperative_id, member_id,
            own_savings, share_capital, special_levies, share_of_net_worth,
            outstanding_loans, other_deductions, other_deductions_note,
            gross_entitlement, net_payable, balance_owed_by_member,
            settlement_method, payment_reference, amount_paid, settled_on, notes,
            computation, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 COALESCE($17::date, CURRENT_DATE),$18,$19,$20)
         RETURNING *`,
        [
          request.id,
          request.cooperative_id,
          request.member_id,
          computed?.ownFunds.savings ?? 0,
          computed?.ownFunds.shareCapital ?? 0,
          computed?.ownFunds.specialLevies ?? 0,
          computed?.shareOfCooperative.amount ?? 0,
          loans,
          extraDeductions,
          extraDeductions > 0 ? String(otherDeductionsNote).trim() : null,
          gross,
          netPayable,
          owedByMember,
          settlementMethod,
          paymentReference ? String(paymentReference).trim() : null,
          paid,
          settledOn || null,
          notes ? String(notes).trim() : null,
          computed ? JSON.stringify(computed) : null,
          req.user!.userId,
        ]
      );

      // The member is told exactly what was settled, in figures, not in a
      // status change they have to interpret.
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'Your settlement has been recorded',$2,'alert','/membership')`,
        [
          request.requested_by,
          `${request.cooperative_name} has settled your account: RWF ${gross.toLocaleString()} ` +
            `due, RWF ${(loans + extraDeductions).toLocaleString()} deducted, RWF ` +
            `${paid.toLocaleString()} ${SETTLEMENT_METHOD_LABELS[
              settlementMethod as keyof typeof SETTLEMENT_METHOD_LABELS
            ].toLowerCase()}. Confirm receipt on the Membership page.`,
        ]
      );

      const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
      res.status(201).json({
        success: true,
        message:
          owedByMember > 0
            ? `Settlement recorded. The member still owes the cooperative RWF ` +
              `${owedByMember.toLocaleString()}; the release can now be entered, but that balance ` +
              "remains recoverable."
            : `Settlement recorded: RWF ${paid.toLocaleString()} paid to the member. You can now ` +
              "enter the release.",
        data: withProcess(updated.rows[0]),
        settlement: inserted.rows[0],
      });
    } catch (err) {
      console.error("POST /membership/exit-requests/:id/settlement error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─── PATCH /exit-requests/:id/settlement/acknowledge ──────────────────────────
// The member confirms on their own portal that they received what was settled.
// This is the only place in the exit the member gets the last word, and it is
// what turns "the cooperative says it paid" into "the member agrees it was paid".
router.patch("/exit-requests/:id/settlement/acknowledge", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE membership_exit_settlements s
          SET acknowledged_by_member = TRUE, acknowledged_at = NOW(), updated_at = NOW()
        FROM membership_exit_requests r
        WHERE s.exit_request_id = r.id
          AND r.id = $1 AND r.requested_by = $2
          AND s.acknowledged_by_member = FALSE
        RETURNING s.id, s.amount_paid`,
      [req.params.id, req.user!.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message:
          "No settlement of yours was found awaiting confirmation. Either none has been recorded " +
          "yet, or you have already confirmed it.",
      });
    }

    const reviewers = await query(
      `SELECT u.id FROM users u
         JOIN membership_exit_requests r ON r.id = $1
        WHERE u.status = 'active'
          AND ((u.role IN ('manager','cooperative') AND u.cooperative_id = r.cooperative_id)
               OR u.role IN ('admin','generalManager'))`,
      [req.params.id]
    );
    for (const reviewer of reviewers.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'Settlement confirmed by the member',$2,'info','/membership')`,
        [
          reviewer.id,
          `${req.user!.name ?? "The member"} has confirmed receipt of RWF ` +
            `${Number(result.rows[0].amount_paid).toLocaleString()}.`,
        ]
      );
    }

    res.json({ success: true, message: "Thank you — receipt confirmed." });
  } catch (err) {
    console.error("PATCH /membership/exit-requests/:id/settlement/acknowledge error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * Issues the certificate of past membership and archives the register entry.
 *
 * Both happen together because they are the same act: the cooperative closes the
 * member's file and hands them proof of what was in it. Doing one without the
 * other produces either a member archived with nothing to show for their years,
 * or a certificate for somebody still on the register.
 */
async function issueCertificateAndArchive(options: {
  request: any;
  issuedBy: string;
  issuedByName: string;
  decisionNote: string | null;
}) {
  const { request, issuedBy, issuedByName } = options;

  const [memberRes, coopRes, settlementRes, meetingRes, contribRes] = await Promise.all([
    request.member_id
      ? query(
          `SELECT full_name, national_id, membership_number, membership_date, role,
                  total_contributions, total_savings
             FROM members WHERE id = $1`,
          [request.member_id]
        )
      : Promise.resolve({ rows: [], rowCount: 0 } as any),
    query(`SELECT name, registration_number FROM cooperatives WHERE id = $1`, [
      request.cooperative_id,
    ]),
    query(
      `SELECT amount_paid, net_payable FROM membership_exit_settlements WHERE exit_request_id = $1`,
      [request.id]
    ),
    query(
      `SELECT held_at, resolution, votes_for, votes_against, votes_abstain
         FROM membership_exit_meetings
        WHERE exit_request_id = $1 AND status = 'held' AND resolution = 'approve_exit'
        ORDER BY held_at DESC LIMIT 1`,
      [request.id]
    ),
    request.member_id
      ? query(
          `SELECT COALESCE(SUM(amount),0) AS total FROM member_contributions WHERE member_id = $1`,
          [request.member_id]
        )
      : Promise.resolve({ rows: [{ total: 0 }] } as any),
  ]);

  const member = memberRes.rows[0] ?? null;
  const coop = coopRes.rows[0];
  const settlement = settlementRes.rows[0] ?? null;
  const meeting = meetingRes.rows[0] ?? null;

  const joinedOn: string | null = member?.membership_date ?? null;
  const leftOn = new Date().toISOString().slice(0, 10);
  const monthsOfMembership = joinedOn
    ? Math.max(
        0,
        Math.round(
          (new Date(leftOn).getTime() - new Date(joinedOn).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        )
      )
    : null;

  // Offices the member held, taken from the leadership register rather than
  // assumed from their row in the member list.
  const offices = member
    ? await query(
        `SELECT role FROM cooperative_leadership
          WHERE cooperative_id = $1 AND LOWER(name) = LOWER($2)`,
        [request.cooperative_id, member.full_name]
      )
    : { rows: [] as Array<{ role: string }> };
  const registerRole =
    member && member.role && member.role !== "member"
      ? member.role.charAt(0).toUpperCase() + member.role.slice(1)
      : null;
  const rolesHeld =
    [...offices.rows.map((r: { role: string }) => r.role), registerRole].filter(Boolean).join(", ") ||
    null;

  const year = new Date().getFullYear();
  const seq = await query(
    `SELECT COUNT(*) AS n FROM membership_certificates WHERE EXTRACT(YEAR FROM issued_at) = $1`,
    [year]
  );
  const certificateNumber = `MC/${year}/${String(parseInt(seq.rows[0].n, 10) + 1).padStart(5, "0")}`;
  // Short, readable, and unguessable enough that a certificate cannot be
  // fabricated by counting upwards from somebody else's.
  const verificationCode = `${request.id.replace(/-/g, "").slice(0, 8)}${Date.now()
    .toString(36)
    .toUpperCase()
    .slice(-6)}`.toUpperCase();

  const memberName = member?.full_name ?? request.requester_name ?? "Member";
  const statement = certificateStatement({
    memberName,
    cooperativeName: coop.name,
    registrationNumber: coop.registration_number,
    joinedOn,
    leftOn,
    monthsOfMembership,
    rolesHeld,
    assemblyHeldOn: meeting?.held_at ?? null,
  });

  const inserted = await query(
    `INSERT INTO membership_certificates
       (certificate_number, cooperative_id, member_id, exit_request_id, issued_to_user_id,
        purpose, member_name, national_id, membership_number, cooperative_name,
        registration_number, joined_on, left_on, months_of_membership, roles_held,
        total_contributions, settlement_amount, exit_ground, assembly_held_on,
        assembly_resolution, statement, verification_code, issued_by, issued_by_name)
     VALUES ($1,$2,$3,$4,$5,'exit',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      certificateNumber,
      request.cooperative_id,
      request.member_id,
      request.id,
      request.requested_by,
      memberName,
      member?.national_id ?? null,
      member?.membership_number ?? null,
      coop.name,
      coop.registration_number,
      joinedOn,
      leftOn,
      monthsOfMembership,
      rolesHeld,
      Number(contribRes.rows[0]?.total ?? member?.total_contributions ?? 0),
      settlement ? Number(settlement.amount_paid) : null,
      String(request.reason_category ?? "").replace(/_/g, " ") || null,
      meeting?.held_at ? new Date(meeting.held_at).toISOString().slice(0, 10) : null,
      meeting
        ? `The general assembly resolved to release the member by ${meeting.votes_for} votes for, ` +
          `${meeting.votes_against} against and ${meeting.votes_abstain} abstentions.`
        : null,
      statement,
      verificationCode,
      issuedBy,
      issuedByName,
    ]
  );

  // ── Archive, don't delete ────────────────────────────────────────────────
  // deleted_at is still set so every existing query that filters on it keeps
  // behaving; archived_at is what says this was an orderly departure rather
  // than a record somebody removed.
  if (request.member_id) {
    await query(
      `UPDATE members
          SET status = 'inactive',
              archived_at = NOW(),
              archive_reason = $2,
              exit_request_id = $3,
              deleted_at = COALESCE(deleted_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [
        request.member_id,
        `Released by the general assembly on the member's own request. Certificate ` +
          `${certificateNumber} issued.`,
        request.id,
      ]
    );
  }

  return inserted.rows[0];
}

// ─── PATCH /exit-requests/:id/decision ────────────────────────────────────────
// Steps 6 and 7: the release is recorded, and the certificate is issued.
//
// This endpoint cannot invent an outcome. Approving requires a held assembly
// that resolved to approve AND a recorded settlement of the member's assets;
// rejecting requires an assembly that resolved to refuse. An admin may override
// the assembly requirement in the exceptional case where the cooperative cannot
// convene at all, but only with a stated reason written into the decision note
// where the member can read it. Nobody may override the settlement: releasing a
// member while still holding their money is not an administrative shortcut, it
// is the thing the procedure exists to prevent.
router.patch("/exit-requests/:id/decision", authorize(...REVIEWER_ROLES), async (req: Request, res: Response) => {
  try {
    const { decision, note } = req.body;
    const allowed = ["under_review", "approved", "rejected"];
    if (!decision || !allowed.includes(decision)) {
      return res.status(400).json({
        success: false,
        message: `decision must be one of: ${allowed.join(", ")}`,
      });
    }
    if (decision === "rejected" && (!note || String(note).trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: "A note explaining the decision is required when rejecting a request.",
      });
    }

    const existing = await query(
      `SELECT r.*, c.name AS cooperative_name, u.name AS requester_name
         FROM membership_exit_requests r
         JOIN cooperatives c ON c.id = r.cooperative_id
         JOIN users u        ON u.id = r.requested_by
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const request = existing.rows[0];

    const role = req.user!.role;
    if (["manager", "cooperative"].includes(role) && request.cooperative_id !== req.user!.cooperativeId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (!OPEN_STATUSES.includes(request.status)) {
      return res.status(409).json({
        success: false,
        message: `This request is already ${request.status} and can no longer be decided.`,
      });
    }

    const isFinal = decision !== "under_review";

    // ── The assembly's resolution is what authorises a final decision ────────
    let overrideNote = "";
    if (isFinal) {
      const heldMeeting = await query(
        `SELECT resolution, resolution_note, held_at, votes_for, votes_against, votes_abstain
           FROM membership_exit_meetings
          WHERE exit_request_id = $1 AND status = 'held' AND resolution IN ('approve_exit','reject_exit')
          ORDER BY held_at DESC LIMIT 1`,
        [request.id]
      );
      const resolved = heldMeeting.rows[0];
      const authorised = resolved ? RESOLUTION_TO_DECISION[resolved.resolution] : null;
      const overriding = req.body.override === true;

      if (!resolved && !overriding) {
        return res.status(409).json({
          success: false,
          message:
            "No general assembly has resolved on this request yet. Members decide whether one of " +
            "their own is released — call an assembly, record its vote, then enter the decision.",
          requiresMeeting: true,
        });
      }
      if (resolved && authorised !== decision && !overriding) {
        return res.status(409).json({
          success: false,
          message:
            `The general assembly resolved to ${resolved.resolution.replace(/_/g, " ")} ` +
            `(${resolved.votes_for} for, ${resolved.votes_against} against), so this request can ` +
            `only be recorded as ${authorised}.`,
          assemblyResolution: resolved.resolution,
        });
      }
      if (overriding) {
        if (!["admin", "generalManager"].includes(role)) {
          return res.status(403).json({
            success: false,
            message:
              "Only an administrator may decide a removal request without an assembly resolution.",
          });
        }
        if (!String(note ?? "").trim()) {
          return res.status(400).json({
            success: false,
            message: "An override must carry a written reason. It is shown to the member.",
          });
        }
        overrideNote =
          " [Recorded without a general assembly resolution, under administrative override.]";
      }
    }

    // ── And the member's assets must be resolved before they are released ────
    // No override. A cooperative that cannot yet pay should record the
    // settlement with what it has paid and explain the balance in the notes —
    // that at least leaves the member with a figure they can hold it to.
    if (decision === "approved") {
      const settled = await query(
        `SELECT id, net_payable, amount_paid FROM membership_exit_settlements
          WHERE exit_request_id = $1`,
        [request.id]
      );
      if (settled.rowCount === 0) {
        return res.status(409).json({
          success: false,
          message:
            "The member's savings, share capital and outstanding loans have not been settled. " +
            "Record the settlement against this request before releasing them — a member cannot " +
            "be taken off the register while the cooperative still holds their money.",
          requiresSettlement: true,
        });
      }
    }

    await query(
      `UPDATE membership_exit_requests
          SET status = $1,
              decision_note = $2,
              decided_by = CASE WHEN $4::boolean THEN $3 ELSE decided_by END,
              decided_at = CASE WHEN $4::boolean THEN NOW() ELSE decided_at END,
              updated_at = NOW()
        WHERE id = $5`,
      [
        decision,
        note ? `${String(note).trim()}${overrideNote}` : overrideNote || null,
        req.user!.userId,
        isFinal,
        request.id,
      ]
    );

    // ── Step 7: certificate, archive, and release of the account ─────────────
    let certificate: any = null;
    if (decision === "approved") {
      const previousStatus = request.member_id
        ? (await query(`SELECT status FROM members WHERE id = $1`, [request.member_id])).rows[0]
            ?.status ?? "active"
        : null;

      certificate = await issueCertificateAndArchive({
        request,
        issuedBy: req.user!.userId,
        issuedByName: req.user!.name ?? "Cooperative office",
        decisionNote: note ? String(note).trim() : null,
      });

      if (request.member_id) {
        await query(
          `INSERT INTO member_status_log (member_id, old_status, new_status, reason, changed_by, changed_at)
           VALUES ($1,$2,'inactive',$3,$4,NOW())`,
          [
            request.member_id,
            previousStatus,
            `Released by the general assembly on the member's own request; settlement recorded ` +
              `and certificate ${certificate.certificate_number} issued. ` +
              `${note ? String(note).trim() : ""}`.trim(),
            req.user!.userId,
          ]
        );
      }

      // The account keeps its login — that is how the departed member reaches
      // their certificate — but it is no longer attached to the cooperative.
      await query(`UPDATE users SET cooperative_id = NULL, updated_at = NOW() WHERE id = $1`, [
        request.requested_by,
      ]);
    }

    const messages: Record<string, string> = {
      under_review: `Your removal request from ${request.cooperative_name} is now under review.`,
      approved:
        `Your removal request from ${request.cooperative_name} has been approved. Your ` +
        `certificate of membership is ready to download from the Membership page, and your ` +
        `record has been archived.`,
      rejected: `Your removal request from ${request.cooperative_name} was not approved.`,
    };
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,'Membership removal request',$2,'alert','/membership')`,
      [request.requested_by, `${messages[decision]}${note ? ` Note: ${String(note).trim()}` : ""}`]
    );

    const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
    res.json({
      success: true,
      message:
        decision === "approved"
          ? `Released. Certificate ${certificate.certificate_number} has been issued to ` +
            `${certificate.member_name} and their register entry is archived.`
          : `Request marked ${decision}.`,
      data: withProcess(updated.rows[0]),
      certificate,
    });
  } catch (err) {
    console.error("PATCH /membership/exit-requests/:id/decision error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /certificates ────────────────────────────────────────────────────────
// Every certificate the signed-in account holds. A departed member's login
// survives their membership precisely so this list keeps working.
router.get("/certificates", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM membership_certificates
        WHERE issued_to_user_id = $1 AND revoked_at IS NULL
        ORDER BY issued_at DESC`,
      [req.user!.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /membership/certificates error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /certificates/issued ─────────────────────────────────────────────────
// The cooperative's own record of what it has issued. Managers see their own
// cooperative; administrators see everything.
router.get(
  "/certificates/issued",
  authorize(...REVIEWER_ROLES),
  async (req: Request, res: Response) => {
    try {
      const scoped = ["manager", "cooperative"].includes(req.user!.role);
      if (scoped && !req.user!.cooperativeId) {
        return res.json({ success: true, data: [] });
      }
      const result = await query(
        `SELECT mc.*, u.name AS holder_account_name
           FROM membership_certificates mc
           LEFT JOIN users u ON u.id = mc.issued_to_user_id
          ${scoped ? "WHERE mc.cooperative_id = $1" : ""}
          ORDER BY mc.issued_at DESC`,
        scoped ? [req.user!.cooperativeId] : []
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error("GET /membership/certificates/issued error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─── GET /certificates/verify/:code ───────────────────────────────────────────
// Open to any signed-in account. A certificate is worthless if the bank or the
// next cooperative cannot check it, so this returns the printed facts for a
// code — and nothing else about the holder.
router.get("/certificates/verify/:code", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT certificate_number, member_name, cooperative_name, registration_number,
              joined_on, left_on, months_of_membership, roles_held, issued_at,
              issued_by_name, revoked_at, revocation_reason
         FROM membership_certificates
        WHERE UPPER(verification_code) = UPPER($1)`,
      [req.params.code]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: "No certificate matches that verification code.",
      });
    }
    const certificate = result.rows[0];
    res.json({
      success: true,
      valid: !certificate.revoked_at,
      data: certificate,
      message: certificate.revoked_at
        ? `This certificate was revoked on ${new Date(certificate.revoked_at).toLocaleDateString()}.`
        : "Certificate is valid.",
    });
  } catch (err) {
    console.error("GET /membership/certificates/verify/:code error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /archive ─────────────────────────────────────────────────────────────
// Members who have left properly. Kept separate from the active register so a
// cooperative can see its history without those people counting towards quorum,
// member totals or engagement figures.
router.get("/archive", authorize(...REVIEWER_ROLES), async (req: Request, res: Response) => {
  try {
    const scoped = ["manager", "cooperative"].includes(req.user!.role);
    if (scoped && !req.user!.cooperativeId) {
      return res.json({ success: true, data: [] });
    }
    const result = await query(
      `SELECT m.id, m.full_name, m.membership_number, m.national_id, m.phone,
              m.membership_date, m.archived_at, m.archive_reason, m.total_contributions,
              c.name AS cooperative_name,
              r.reason_category, r.decided_at,
              s.amount_paid, s.settlement_method, s.acknowledged_by_member,
              mc.certificate_number, mc.verification_code
         FROM members m
         JOIN cooperatives c ON c.id = m.cooperative_id
         LEFT JOIN membership_exit_requests r ON r.id = m.exit_request_id
         LEFT JOIN membership_exit_settlements s ON s.exit_request_id = r.id
         LEFT JOIN membership_certificates mc ON mc.member_id = m.id AND mc.revoked_at IS NULL
        WHERE m.archived_at IS NOT NULL
          ${scoped ? "AND m.cooperative_id = $1" : ""}
        ORDER BY m.archived_at DESC`,
      scoped ? [req.user!.cooperativeId] : []
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /membership/archive error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /exit-requests/:id/reverse ─────────────────────────────────────────
// Undo an approved exit that should not have happened — recorded in error, or
// approved while testing. Until now the only way back was editing the database
// by hand, which is how a member kept finding themselves "not associated with
// any cooperative".
//
// It reinstates the member's register entry, re-attaches their login, revokes
// the certificate (it no longer states a fact), and keeps the settlement as
// history with a note. The request itself is marked `reversed`, with who and
// why, so the record shows both that the member left and that it was undone.
router.patch("/exit-requests/:id/reverse", authorize(...REVIEWER_ROLES), async (req: Request, res: Response) => {
  try {
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Say why the exit is being reversed, in at least 10 characters.",
      });
    }

    const found = await query(
      `SELECT e.*, c.name AS cooperative_name, c.deleted_at AS cooperative_deleted_at
         FROM membership_exit_requests e
         JOIN cooperatives c ON c.id = e.cooperative_id
        WHERE e.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Exit request not found" });
    }
    const request = found.rows[0];

    // A manager reverses exits from their own cooperative only.
    if (["manager", "cooperative"].includes(req.user!.role) && req.user!.cooperativeId !== request.cooperative_id) {
      return res.status(403).json({ success: false, message: "This exit belongs to another cooperative." });
    }
    if (request.status !== "approved") {
      return res.status(409).json({
        success: false,
        message: `Only an approved exit can be reversed; this one is ${request.status.replace(/_/g, " ")}.`,
      });
    }
    if (request.cooperative_deleted_at) {
      return res.status(409).json({
        success: false,
        message: `${request.cooperative_name} has been dissolved, so there is nothing to reinstate the member into.`,
      });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE membership_exit_requests
            SET status = 'reversed', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [request.id, req.user!.userId, reason]
      );

      await client.query(
        `UPDATE membership_certificates
            SET revoked_at = NOW(), revocation_reason = $2
          WHERE exit_request_id = $1 AND revoked_at IS NULL`,
        [request.id, `The exit was reversed: ${reason}`]
      );

      await client.query(
        `UPDATE membership_exit_settlements
            SET notes = TRIM(BOTH E'\\n' FROM COALESCE(notes, '') || E'\\n' || $2), updated_at = NOW()
          WHERE exit_request_id = $1`,
        [request.id, `[Exit reversed ${new Date().toISOString().slice(0, 10)}: ${reason}]`]
      );

      if (request.member_id) {
        // Back to the status they held before the release, which the status
        // log recorded when they were archived.
        const before = await client.query(
          `SELECT old_status FROM member_status_log
            WHERE member_id = $1 AND new_status = 'inactive'
            ORDER BY changed_at DESC LIMIT 1`,
          [request.member_id]
        );
        const restored = before.rows[0]?.old_status && before.rows[0].old_status !== "inactive"
          ? before.rows[0].old_status
          : "active";

        await client.query(
          `UPDATE members
              SET status = $2, deleted_at = NULL, archived_at = NULL, archive_reason = NULL,
                  exit_request_id = NULL, updated_at = NOW()
            WHERE id = $1`,
          [request.member_id, restored]
        );
        await client.query(
          `INSERT INTO member_status_log (member_id, old_status, new_status, reason, changed_by, changed_at)
           VALUES ($1,'inactive',$2,$3,$4,NOW())`,
          [request.member_id, restored, `Exit reversed: ${reason}`, req.user!.userId]
        );
      }

      // Re-attach the login: the one that filed the request, and any other
      // account linked to this member record.
      const relinked = await client.query(
        `UPDATE users
            SET cooperative_id = $1, member_id = COALESCE(member_id, $2), updated_at = NOW()
          WHERE id = $3 OR ($2::uuid IS NOT NULL AND member_id = $2::uuid)
          RETURNING id`,
        [request.cooperative_id, request.member_id, request.requested_by]
      );

      for (const u of relinked.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,'Your membership has been restored',$2,'info','/members/me')`,
          [
            u.id,
            `Your exit from ${request.cooperative_name} was reversed: ${reason}. You are a member ` +
              "again and your record is back as it was.",
          ]
        );
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        message: `Exit reversed. The member is back on ${request.cooperative_name}'s register and their login is re-attached.`,
        data: { exitRequestId: request.id, accountsRelinked: relinked.rowCount },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("PATCH /membership/exit-requests/:id/reverse error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
