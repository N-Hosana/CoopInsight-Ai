import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

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
 * THESE ARE CONFIGURATION, NOT LAW. Cooperative bylaws differ; confirm the
 * quorum and majority against the bylaws in force and change them here.
 */
export const MEETING_RULES = {
  /** Minimum notice, in days, between convening the assembly and it sitting. */
  minimumNoticeDays: 7,
  /** Share of the register that must attend for the meeting to be competent. */
  quorumFraction: 0.5,
  /** Share of votes cast that must be in favour for a resolution to carry. */
  majorityFraction: 0.5,
};

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
              'createdAt', g.created_at) ORDER BY g.created_at)
              FROM membership_exit_meetings g
              LEFT JOIN users cb ON cb.id = g.convened_by
             WHERE g.exit_request_id = r.id), '[]') AS meetings
    FROM membership_exit_requests r
    JOIN cooperatives c ON c.id = r.cooperative_id
    JOIN users u        ON u.id = r.requested_by
    LEFT JOIN members m ON m.id = r.member_id
    LEFT JOIN users d   ON d.id = r.decided_by
`;

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
      meeting: {
        ...MEETING_RULES,
        resolutions: MEETING_RESOLUTIONS,
        explanation:
          "A member's request to leave is decided by the general assembly, not by the office. " +
          `The assembly must be called at least ${MEETING_RULES.minimumNoticeDays} days ahead, ` +
          `is competent once ${Math.round(MEETING_RULES.quorumFraction * 100)}% of the register ` +
          `attends, and carries a resolution on more than ` +
          `${Math.round(MEETING_RULES.majorityFraction * 100)}% of the votes cast.`,
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
      data: result.rows,
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
// The calculation, in order:
//   1. Own money      = savings + share capital + special levies paid in
//   2. Share of value = (member share capital / cooperative share capital)
//                       × distributable net worth
//   3. Deductions     = outstanding loan balances
//   4. Net payable    = 1 + 2 − 3   (floored at zero)
//
// Distributable net worth comes from the latest balance sheet when one exists.
// Otherwise it is estimated as lifetime surplus (completed income − expense)
// less the members' own savings, since those are a liability owed back to
// members, not cooperative equity. That fallback is flagged in the response.
router.get("/settlement", async (req: Request, res: Response) => {
  try {
    const actor = await query(
      `SELECT role, cooperative_id FROM users WHERE id = $1`,
      [req.user!.userId]
    );
    const role = actor.rows[0]?.role as string;
    const isReviewer = REVIEWER_ROLES.includes(role);
    const requestedMemberId = req.query.memberId as string | undefined;

    let memberId: string | null = null;
    let cooperativeId: string | null = req.user!.cooperativeId ?? null;

    if (requestedMemberId) {
      if (!isReviewer) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      const m = await query(
        `SELECT id, cooperative_id FROM members WHERE id = $1`,
        [requestedMemberId]
      );
      if (m.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }
      if (["manager", "cooperative"].includes(role) && m.rows[0].cooperative_id !== req.user!.cooperativeId) {
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
          message: "We could not match your account to an entry in the member register, so no settlement can be calculated.",
        });
      }
      memberId = own.id;
    }

    const [memberRes, coopRes, contribRes, coopContribRes, loanRes, balanceRes, surplusRes] = await Promise.all([
      query(
        `SELECT id, full_name, membership_number, membership_date, total_savings, total_contributions
           FROM members WHERE id = $1`,
        [memberId]
      ),
      query(
        `SELECT id, name, total_savings,
                (SELECT COUNT(*) FROM members m WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count
           FROM cooperatives c WHERE c.id = $1`,
        [cooperativeId]
      ),
      query(
        `SELECT type, COALESCE(SUM(amount),0) AS total
           FROM member_contributions WHERE member_id = $1 GROUP BY type`,
        [memberId]
      ),
      query(
        `SELECT COALESCE(SUM(mc.amount),0) AS total
           FROM member_contributions mc
           JOIN members m ON m.id = mc.member_id
          WHERE m.cooperative_id = $1 AND mc.type = 'share_capital'`,
        [cooperativeId]
      ),
      query(
        `SELECT COALESCE(SUM(balance),0) AS outstanding
           FROM loan_records
          WHERE member_id = $1 AND status IN ('active','overdue')`,
        [memberId]
      ),
      query(
        `SELECT cash, bank_balance, inventory, fixed_assets, loans_outstanding,
                external_loans, accounts_payable, member_savings, share_capital,
                retained_earnings, period_end
           FROM balance_sheets WHERE cooperative_id = $1
          ORDER BY period_end DESC LIMIT 1`,
        [cooperativeId]
      ),
      query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)  AS income,
           COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
           FROM transactions WHERE cooperative_id = $1 AND status = 'completed'`,
        [cooperativeId]
      ),
    ]);

    if (memberRes.rowCount === 0 || coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Member or cooperative not found" });
    }

    const member = memberRes.rows[0];
    const coop = coopRes.rows[0];
    const num = (v: unknown) => Number(v ?? 0);

    const byType: Record<string, number> = {};
    for (const row of contribRes.rows) byType[row.type] = num(row.total);
    const savingsContributions = byType.savings ?? 0;
    const shareCapital = byType.share_capital ?? 0;
    const specialLevies = byType.special_levy ?? 0;

    // members.total_savings is the running balance the cooperative reports; the
    // contributions ledger may be incomplete, so take whichever is higher.
    const recordedSavings = num(member.total_savings);
    const memberSavings = Math.max(recordedSavings, savingsContributions);

    const cooperativeShareCapital = num(coopContribRes.rows[0]?.total);
    const outstandingLoans = num(loanRes.rows[0]?.outstanding);

    let netWorth: number;
    let netWorthBasis: string;
    let estimated: boolean;
    const balance = balanceRes.rows[0];

    if (balance) {
      const assets = num(balance.cash) + num(balance.bank_balance) + num(balance.inventory) +
        num(balance.fixed_assets) + num(balance.loans_outstanding);
      const liabilities = num(balance.external_loans) + num(balance.accounts_payable) + num(balance.member_savings);
      netWorth = assets - liabilities;
      netWorthBasis = `Latest balance sheet, period ending ${new Date(balance.period_end).toISOString().slice(0, 10)}: assets RWF ${assets.toLocaleString()} less liabilities RWF ${liabilities.toLocaleString()}.`;
      estimated = false;
    } else {
      const income = num(surplusRes.rows[0]?.income);
      const expense = num(surplusRes.rows[0]?.expense);
      const surplus = income - expense;
      netWorth = surplus - num(coop.total_savings);
      netWorthBasis = `No balance sheet on file. Estimated from completed transactions: income RWF ${income.toLocaleString()} less expenses RWF ${expense.toLocaleString()}, less members' savings of RWF ${num(coop.total_savings).toLocaleString()} which are owed back to members.`;
      estimated = true;
    }

    const distributableNetWorth = Math.max(0, netWorth);
    const sharePercentage = cooperativeShareCapital > 0 ? shareCapital / cooperativeShareCapital : 0;
    const shareOfNetWorth = Math.round(distributableNetWorth * sharePercentage);

    const ownFunds = memberSavings + shareCapital + specialLevies;
    const grossEntitlement = ownFunds + shareOfNetWorth;
    const netPayable = Math.max(0, grossEntitlement - outstandingLoans);

    const warnings: string[] = [];
    if (cooperativeShareCapital === 0) {
      warnings.push(
        "No share capital contributions are recorded for this cooperative, so no share of retained value can be attributed. Only the member's own funds are payable."
      );
    }
    if (estimated) {
      warnings.push(
        "No balance sheet has been filed, so the cooperative's net worth is estimated from transaction history. File a balance sheet for an accurate figure."
      );
    }
    if (netWorth < 0) {
      warnings.push(
        `The cooperative's net worth is negative (RWF ${Math.round(netWorth).toLocaleString()}), so no surplus is distributable. Members may still be liable for losses under the bylaws.`
      );
    }
    if (outstandingLoans > 0) {
      warnings.push(
        `RWF ${outstandingLoans.toLocaleString()} of outstanding loans must be settled and has been deducted.`
      );
    }
    if (outstandingLoans > grossEntitlement) {
      warnings.push(
        `Outstanding loans exceed the member's entitlement by RWF ${Math.round(outstandingLoans - grossEntitlement).toLocaleString()}. The member owes this balance to the cooperative.`
      );
    }

    res.json({
      success: true,
      data: {
        member: {
          id: member.id,
          fullName: member.full_name,
          membershipNumber: member.membership_number,
          membershipDate: member.membership_date,
        },
        cooperative: {
          id: coop.id,
          name: coop.name,
          memberCount: Number(coop.member_count),
          totalMemberSavings: num(coop.total_savings),
          shareCapital: cooperativeShareCapital,
        },
        ownFunds: {
          savings: memberSavings,
          shareCapital,
          specialLevies,
          total: ownFunds,
        },
        shareOfCooperative: {
          distributableNetWorth,
          sharePercentage: Number((sharePercentage * 100).toFixed(4)),
          amount: shareOfNetWorth,
          basis: netWorthBasis,
          estimated,
        },
        deductions: {
          outstandingLoans,
          total: outstandingLoans,
        },
        grossEntitlement,
        netPayable,
        balanceOwedToCooperative: Math.max(0, outstandingLoans - grossEntitlement),
        warnings,
        disclaimer:
          "Indicative figure computed from the records currently held in CoopInsight. The amount actually paid is set by the cooperative's bylaws and its audited accounts at the date of exit.",
        calculatedAt: new Date().toISOString(),
      },
    });
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
      data: request,
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
      data: result.rows,
      responseWindowDays: RESPONSE_WINDOW_DAYS,
      meetingRules: MEETING_RULES,
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

    res.json({ success: true, data: request, meetingRules: MEETING_RULES });
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

      const { scheduledFor, location, agenda } = req.body;
      if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
        return res.status(400).json({
          success: false,
          message: "scheduledFor must be the date and time the assembly will sit.",
        });
      }

      const when = new Date(scheduledFor);
      const noticeDays = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
      if (noticeDays < MEETING_RULES.minimumNoticeDays) {
        return res.status(400).json({
          success: false,
          message:
            `Members must be given at least ${MEETING_RULES.minimumNoticeDays} days' notice. ` +
            `The date you chose is ${noticeDays} day(s) away.`,
        });
      }
      if (!location || !String(location).trim()) {
        return res.status(400).json({ success: false, message: "A meeting location is required." });
      }

      const eligible = await query(
        `SELECT COUNT(*) AS n FROM members
          WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [request.cooperative_id]
      );
      const membersEligible = parseInt(eligible.rows[0].n, 10);
      const quorumRequired = Math.ceil(membersEligible * MEETING_RULES.quorumFraction);

      const title = `General Assembly — removal request: ${request.requester_name}`;
      const defaultAgenda =
        `1. Confirm quorum.\n` +
        `2. Read the removal request filed by ${request.requester_name} on ` +
        `${new Date(request.created_at).toLocaleDateString()}.\n` +
        `3. Hear the member's stated reason: ${request.reason_category.replace(/_/g, " ")}.\n` +
        `4. Debate whether the reasons justify release from membership.\n` +
        `5. Settle the member's savings, share capital and outstanding loans.\n` +
        `6. Vote and minute the resolution.`;

      const activity = await query(
        `INSERT INTO activities
           (cooperative_id, title, type, status, date, start_time, location, description,
            objectives, budget, actual_cost, created_by)
         VALUES ($1,$2,'meeting','planned',$3,$4,$5,$6,$7,0,0,$8)
         RETURNING id`,
        [
          request.cooperative_id,
          title,
          when.toISOString().slice(0, 10),
          when.toISOString().slice(11, 19),
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
            convened_by, status, members_eligible, quorum_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9)
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
          quorumRequired,
        ]
      );

      await query(
        `UPDATE membership_exit_requests SET status = 'meeting_scheduled', updated_at = NOW()
          WHERE id = $1`,
        [request.id]
      );

      // The member who filed it, and everyone entitled to vote on it.
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'General assembly called on your request',$2,'alert','/membership')`,
        [
          request.requested_by,
          `${request.cooperative_name} has called a general assembly for ` +
            `${when.toLocaleDateString()} at ${String(location).trim()} to decide your removal request.`,
        ]
      );
      const voters = await query(
        `SELECT id FROM users
          WHERE cooperative_id = $1 AND status = 'active' AND id <> $2`,
        [request.cooperative_id, request.requested_by]
      );
      for (const v of voters.rows) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,'General assembly called',$2,'reminder','/activities')`,
          [
            v.id,
            `A general assembly sits on ${when.toLocaleDateString()} at ${String(location).trim()} ` +
              `to decide a member's request to leave ${request.cooperative_name}. ` +
              `${quorumRequired} of ${membersEligible} members must attend for it to be competent.`,
          ]
        );
      }

      const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
      res.status(201).json({
        success: true,
        message:
          `General assembly called for ${when.toLocaleDateString()}. ` +
          `${quorumRequired} of ${membersEligible} members must attend for the vote to stand.`,
        data: updated.rows[0],
        meetingId: meeting.rows[0].id,
        notifiedMembers: voters.rowCount ?? 0,
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

      const quorumRequired = meeting.quorum_required ?? 0;
      const quorumMet = present >= quorumRequired;

      // A resolution requires quorum. Without it the meeting can only defer.
      if (!quorumMet && resolution !== "deferred") {
        return res.status(409).json({
          success: false,
          message:
            `Only ${present} of the ${meeting.members_eligible} members attended; ` +
            `${quorumRequired} were needed for the assembly to be competent. ` +
            "Record the meeting as deferred and call another one.",
        });
      }
      // And the arithmetic has to support what is being minuted.
      if (resolution === "approve_exit" && !(cast > 0 && forVotes / cast > MEETING_RULES.majorityFraction)) {
        return res.status(409).json({
          success: false,
          message:
            `The vote does not carry a removal: ${forVotes} of ${cast} votes were in favour, ` +
            `and more than ${Math.round(MEETING_RULES.majorityFraction * 100)}% is required.`,
        });
      }
      if (resolution === "reject_exit" && cast > 0 && forVotes / cast > MEETING_RULES.majorityFraction) {
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

      await query(
        `UPDATE membership_exit_meetings
            SET status = 'held', members_present = $1, quorum_met = $2,
                votes_for = $3, votes_against = $4, votes_abstain = $5,
                resolution = $6, resolution_note = $7, minutes_url = $8,
                held_at = NOW(), recorded_by = $9, updated_at = NOW()
          WHERE id = $10`,
        [
          present,
          quorumMet,
          forVotes,
          againstVotes,
          abstainVotes,
          resolution,
          resolutionNote ? String(resolutionNote).trim() : null,
          minutesUrl || null,
          req.user!.userId,
          meeting.id,
        ]
      );

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
          resolution === "deferred"
            ? "Meeting recorded as deferred. Call another assembly to decide the request."
            : `Meeting recorded. The assembly resolved to ${resolution.replace(/_/g, " ")}; ` +
              "record the formal decision to complete the request.",
        data: updated.rows[0],
        quorum: { required: quorumRequired, present, met: quorumMet },
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
      res.json({ success: true, message: "Assembly cancelled.", data: updated.rows[0] });
    } catch (err) {
      console.error("PATCH /membership/exit-requests/:id/meeting/:meetingId/cancel error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ─── PATCH /exit-requests/:id/decision ────────────────────────────────────────
// Records the decision the general assembly reached.
//
// This endpoint deliberately cannot invent an outcome: approving requires a
// held assembly that resolved to approve, and rejecting requires one that
// resolved to refuse. An admin may override that in the exceptional case where
// the cooperative cannot convene at all, but only with a stated reason, and the
// override is written into the decision note where the member can read it.
//
// Approving removes the member from the register the same way DELETE /members/:id
// does — status 'inactive' plus a soft delete — and records why in member_status_log.
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
      `SELECT r.*, c.name AS cooperative_name
         FROM membership_exit_requests r
         JOIN cooperatives c ON c.id = r.cooperative_id
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

    if (decision === "approved" && request.member_id) {
      const current = await query(`SELECT status FROM members WHERE id = $1`, [request.member_id]);
      const oldStatus = current.rows[0]?.status ?? "active";

      await query(
        `UPDATE members
            SET status = 'inactive', deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND deleted_at IS NULL`,
        [request.member_id]
      );
      await query(
        `INSERT INTO member_status_log (member_id, old_status, new_status, reason, changed_by, changed_at)
         VALUES ($1,$2,'inactive',$3,$4,NOW())`,
        [
          request.member_id,
          oldStatus,
          `Member-requested removal approved. ${note ? String(note).trim() : ""}`.trim(),
          req.user!.userId,
        ]
      );
      // The user account keeps its login but is no longer tied to the cooperative.
      await query(
        `UPDATE users SET cooperative_id = NULL, updated_at = NOW() WHERE id = $1`,
        [request.requested_by]
      );
    }

    const messages: Record<string, string> = {
      under_review: `Your removal request from ${request.cooperative_name} is now under review.`,
      approved: `Your removal request from ${request.cooperative_name} has been approved.`,
      rejected: `Your removal request from ${request.cooperative_name} was not approved.`,
    };
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,'Membership removal request',$2,'alert','/membership')`,
      [request.requested_by, `${messages[decision]}${note ? ` Note: ${String(note).trim()}` : ""}`]
    );

    const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
    res.json({ success: true, message: `Request marked ${decision}.`, data: updated.rows[0] });
  } catch (err) {
    console.error("PATCH /membership/exit-requests/:id/decision error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
