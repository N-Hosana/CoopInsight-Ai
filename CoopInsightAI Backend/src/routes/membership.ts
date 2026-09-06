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
         d.name  AS decided_by_name
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
        WHERE requested_by = $1 AND status IN ('pending','under_review')`,
      [req.user!.userId]
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
      `${request.requester_name} has requested removal from ${request.cooperative_name}. A response is due by ${new Date(request.response_due_at).toLocaleDateString()}.`
    );

    res.status(201).json({
      success: true,
      message: `Request submitted. ${request.cooperative_name} has ${RESPONSE_WINDOW_DAYS} days to respond.`,
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
        WHERE id = $1 AND requested_by = $2 AND status IN ('pending','under_review')
        RETURNING id`,
      [req.params.id, req.user!.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No open request of yours was found to withdraw.",
      });
    }

    res.json({ success: true, message: "Request withdrawn." });
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
    const result = await query(
      `${SELECT_REQUEST} ${where}
       ORDER BY
         CASE WHEN r.status IN ('pending','under_review') THEN 0 ELSE 1 END,
         r.response_due_at ASC`,
      params
    );

    res.json({ success: true, data: result.rows, responseWindowDays: RESPONSE_WINDOW_DAYS });
  } catch (err) {
    console.error("GET /membership/exit-requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /exit-requests/:id/decision ────────────────────────────────────────
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
    if (!["pending", "under_review"].includes(request.status)) {
      return res.status(409).json({
        success: false,
        message: `This request is already ${request.status} and can no longer be decided.`,
      });
    }

    const isFinal = decision !== "under_review";
    await query(
      `UPDATE membership_exit_requests
          SET status = $1,
              decision_note = $2,
              decided_by = CASE WHEN $4::boolean THEN $3 ELSE decided_by END,
              decided_at = CASE WHEN $4::boolean THEN NOW() ELSE decided_at END,
              updated_at = NOW()
        WHERE id = $5`,
      [decision, note ? String(note).trim() : null, req.user!.userId, isFinal, request.id]
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
