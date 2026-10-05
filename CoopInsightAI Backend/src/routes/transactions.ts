import { Router, Request, Response } from "express";
import { query, getClient } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { writableCooperative } from "../services/cooperativeAccess";

const router = Router();

const INCOME_CATEGORIES = ["member_contributions", "loan_repayments", "grants", "product_sales", "service_fees", "donations"];
const EXPENSE_CATEGORIES = ["loan_disbursements", "dividends", "operational_costs", "salaries", "training", "equipment", "utilities"];
const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

// GET / — list transactions
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, type, category, from, to, search, page = 1, limit = 20 } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const params: any[] = [];

    // Role scoping
    if (role === "manager" || role === "cooperative") {
      conditions.push(`t.cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    } else if (role === "member") {
      // The member's own entries only, through the stored login→member link.
      // This used to pick "the first member found in the cooperative", so a
      // member was shown somebody else's transactions.
      conditions.push(`t.member_id = (SELECT member_id FROM users WHERE id = $${params.length + 1})`);
      params.push(req.user!.userId);
    } else if (cooperativeId) {
      conditions.push(`t.cooperative_id = $${params.length + 1}`);
      params.push(cooperativeId);
    }

    if (type) {
      conditions.push(`t.type = $${params.length + 1}`);
      params.push(type);
    }
    if (category) {
      conditions.push(`t.category = $${params.length + 1}`);
      params.push(category);
    }
    if (from && to) {
      conditions.push(`t.date BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(from, to);
    } else if (from) {
      conditions.push(`t.date >= $${params.length + 1}`);
      params.push(from);
    } else if (to) {
      conditions.push(`t.date <= $${params.length + 1}`);
      params.push(to);
    }
    if (search) {
      conditions.push(`(t.description ILIKE $${params.length + 1} OR t.reference ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM transactions t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await query(
      `SELECT t.*, c.name AS cooperative_name, u.name AS recorded_by_name, m.full_name AS member_name
       FROM transactions t
       LEFT JOIN cooperatives c ON c.id = t.cooperative_id
       LEFT JOIN users u ON u.id = t.recorded_by
       LEFT JOIN members m ON m.id = t.member_id
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /transactions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /summary
router.get("/summary", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, from, to } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const conditions: string[] = ["status = 'completed'"];
    const params: any[] = [];

    if (role === "manager" || role === "cooperative") {
      conditions.push(`cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    } else if (role === "member") {
      // A member's summary is their own money, not the district's.
      conditions.push(`member_id = (SELECT member_id FROM users WHERE id = $${params.length + 1})`);
      params.push(req.user!.userId);
    } else if (cooperativeId) {
      conditions.push(`cooperative_id = $${params.length + 1}`);
      params.push(cooperativeId);
    }

    if (from && to) {
      conditions.push(`date BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(from, to);
    } else if (from) {
      conditions.push(`date >= $${params.length + 1}`);
      params.push(from);
    } else if (to) {
      conditions.push(`date <= $${params.length + 1}`);
      params.push(to);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const result = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) AS net_balance,
        COALESCE(SUM(CASE WHEN category='member_contributions' THEN amount ELSE 0 END), 0) AS total_contributions,
        COALESCE(SUM(CASE WHEN category='loan_disbursements' THEN amount ELSE 0 END), 0) AS total_loans_disbursed,
        COALESCE(SUM(CASE WHEN category='loan_repayments' THEN amount ELSE 0 END), 0) AS total_loan_repayments,
        COALESCE(SUM(CASE WHEN category='grants' THEN amount ELSE 0 END), 0) AS total_grants,
        COALESCE(SUM(CASE WHEN category='salaries' THEN amount ELSE 0 END), 0) AS total_salaries
       FROM transactions ${whereClause}`,
      params
    );

    const row = result.rows[0];

    res.json({
      success: true,
      data: {
        cooperativeId: (role === "manager" || role === "cooperative") ? userCoopId : (cooperativeId || null),
        from: from || null,
        to: to || null,
        totalIncome: parseFloat(row.total_income),
        totalExpenses: parseFloat(row.total_expenses),
        netBalance: parseFloat(row.net_balance),
        totalContributions: parseFloat(row.total_contributions),
        totalLoansDisbursed: parseFloat(row.total_loans_disbursed),
        totalLoanRepayments: parseFloat(row.total_loan_repayments),
        totalGrants: parseFloat(row.total_grants),
        totalSalaries: parseFloat(row.total_salaries),
      },
    });
  } catch (err) {
    console.error("GET /transactions/summary error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /balance-sheet
router.get("/balance-sheet", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, periodId } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const coopId = (role === "manager" || role === "cooperative") ? userCoopId : cooperativeId as string;
    if (!coopId) return res.status(400).json({ message: "cooperativeId is required" });

    let sql = `SELECT * FROM balance_sheets WHERE cooperative_id = $1`;
    const params: any[] = [coopId];

    if (periodId) {
      sql += ` AND period_id = $2`;
      params.push(periodId);
    }

    sql += ` ORDER BY generated_at DESC LIMIT 1`;

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "No balance sheet found" });
    }

    const bs = result.rows[0];
    const totalAssets = parseFloat(bs.cash || 0) + parseFloat(bs.bank_balance || 0) + parseFloat(bs.loans_outstanding || 0) + parseFloat(bs.inventory || 0) + parseFloat(bs.fixed_assets || 0);
    const totalLiabilities = parseFloat(bs.member_savings || 0) + parseFloat(bs.external_loans || 0) + parseFloat(bs.accounts_payable || 0);
    const totalEquity = parseFloat(bs.share_capital || 0) + parseFloat(bs.retained_earnings || 0);

    res.json({
      success: true,
      data: {
        id: bs.id,
        cooperativeId: bs.cooperative_id,
        periodId: bs.period_id,
        periodStart: bs.period_start,
        periodEnd: bs.period_end,
        assets: {
          cash: parseFloat(bs.cash || 0),
          bankBalance: parseFloat(bs.bank_balance || 0),
          loansOutstanding: parseFloat(bs.loans_outstanding || 0),
          inventory: parseFloat(bs.inventory || 0),
          fixedAssets: parseFloat(bs.fixed_assets || 0),
          totalAssets,
        },
        liabilities: {
          memberSavings: parseFloat(bs.member_savings || 0),
          externalLoans: parseFloat(bs.external_loans || 0),
          accountsPayable: parseFloat(bs.accounts_payable || 0),
          totalLiabilities,
        },
        equity: {
          shareCapital: parseFloat(bs.share_capital || 0),
          retainedEarnings: parseFloat(bs.retained_earnings || 0),
          totalEquity,
        },
        generatedAt: bs.generated_at,
      },
    });
  } catch (err) {
    console.error("GET /transactions/balance-sheet error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── Balance sheets, as the manager files them ───────────────────────────────
//
// The audit asks "when was the last balance sheet filed?" and the RCA brochure
// expects one a year. Until now the table could be read but never written, so
// every cooperative was told it had never filed one and could do nothing about
// it. The manager enters the closing figures; the sheet must balance.

const BALANCE_SHEET_FIELDS = {
  assets: ["cash", "bankBalance", "loansOutstanding", "inventory", "fixedAssets"],
  liabilities: ["memberSavings", "externalLoans", "accountsPayable"],
  equity: ["shareCapital", "retainedEarnings"],
} as const;

const COLUMN: Record<string, string> = {
  cash: "cash",
  bankBalance: "bank_balance",
  loansOutstanding: "loans_outstanding",
  inventory: "inventory",
  fixedAssets: "fixed_assets",
  memberSavings: "member_savings",
  externalLoans: "external_loans",
  accountsPayable: "accounts_payable",
  shareCapital: "share_capital",
  retainedEarnings: "retained_earnings",
};

// GET /balance-sheets — every sheet the cooperative has filed, newest first.
router.get("/balance-sheets", authenticate, async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const coopId =
      ["manager", "cooperative", "member"].includes(role)
        ? req.user!.cooperativeId
        : (req.query.cooperativeId as string | undefined);
    if (!coopId) return res.status(400).json({ success: false, message: "cooperativeId is required" });

    const result = await query(
      `SELECT * FROM balance_sheets WHERE cooperative_id = $1 ORDER BY period_end DESC`,
      [coopId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /transactions/balance-sheets error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /balance-sheet — file (or correct) the balance sheet for a period.
router.post("/balance-sheet", authenticate, async (req: Request, res: Response) => {
  try {
    const access = writableCooperative(req, req.body.cooperativeId);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });

    const { periodStart, periodEnd } = req.body;
    if (!periodStart || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return res.status(400).json({ success: false, message: "periodStart and periodEnd (YYYY-MM-DD) are required." });
    }
    if (periodEnd <= periodStart) {
      return res.status(400).json({ success: false, message: "The period must end after it starts." });
    }
    if (periodEnd > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ success: false, message: "A balance sheet is drawn up at the close of a period that has ended." });
    }

    const values: Record<string, number> = {};
    for (const key of Object.keys(COLUMN)) {
      const raw = req.body[key];
      const n = raw == null || raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ success: false, message: `${key} must be a number.` });
      }
      // Retained earnings go negative after a loss; nothing else can.
      if (n < 0 && key !== "retainedEarnings") {
        return res.status(400).json({ success: false, message: `${key} cannot be negative.` });
      }
      values[key] = n;
    }

    const sum = (keys: readonly string[]) => keys.reduce((a, k) => a + values[k], 0);
    const assets = sum(BALANCE_SHEET_FIELDS.assets);
    const liabilities = sum(BALANCE_SHEET_FIELDS.liabilities);
    const equity = sum(BALANCE_SHEET_FIELDS.equity);
    if (Math.abs(assets - (liabilities + equity)) > 1) {
      return res.status(400).json({
        success: false,
        message:
          `The sheet does not balance: assets ${assets.toLocaleString()} RWF against liabilities and ` +
          `equity ${(liabilities + equity).toLocaleString()} RWF (a difference of ` +
          `${(assets - liabilities - equity).toLocaleString()} RWF).`,
        totals: { assets, liabilities, equity },
      });
    }

    // One sheet per period end: filing again for the same date corrects it.
    const existing = await query(
      `SELECT id FROM balance_sheets WHERE cooperative_id = $1 AND period_end = $2`,
      [access.cooperativeId, periodEnd]
    );
    const columns = Object.values(COLUMN);
    const ordered = Object.keys(COLUMN).map((k) => values[k]);
    let saved;
    if (existing.rowCount) {
      saved = await query(
        `UPDATE balance_sheets
            SET period_start = $1, ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")},
                generated_at = NOW()
          WHERE id = $${columns.length + 2}
          RETURNING *`,
        [periodStart, ...ordered, existing.rows[0].id]
      );
    } else {
      saved = await query(
        `INSERT INTO balance_sheets (cooperative_id, period_start, period_end, ${columns.join(", ")}, generated_at)
         VALUES ($1, $2, $3, ${columns.map((_, i) => `$${i + 4}`).join(", ")}, NOW())
         RETURNING *`,
        [access.cooperativeId, periodStart, periodEnd, ...ordered]
      );
    }

    res.status(existing.rowCount ? 200 : 201).json({
      success: true,
      message: existing.rowCount
        ? `Balance sheet to ${periodEnd} corrected.`
        : `Balance sheet to ${periodEnd} filed.`,
      data: saved.rows[0],
      totals: { assets, liabilities, equity },
    });
  } catch (err) {
    console.error("POST /transactions/balance-sheet error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /periods
router.get("/periods", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const coopId = (role === "manager" || role === "cooperative") ? userCoopId : cooperativeId as string;
    if (!coopId) return res.status(400).json({ message: "cooperativeId is required" });

    const result = await query(
      `SELECT * FROM financial_periods WHERE cooperative_id = $1 ORDER BY period_end DESC`,
      [coopId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /transactions/periods error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /savings
router.get("/savings", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const coopId = (role === "manager" || role === "cooperative") ? userCoopId : cooperativeId as string;
    if (!coopId) return res.status(400).json({ message: "cooperativeId is required" });

    const result = await query(
      `SELECT
        COALESCE(SUM(total_savings), 0) AS total,
        COUNT(id) AS member_count,
        COALESCE(AVG(total_savings), 0) AS avg
       FROM members
       WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active'`,
      [coopId]
    );

    const row = result.rows[0];

    res.json({
      success: true,
      data: {
        cooperativeId: coopId,
        totalSavingsBalance: parseFloat(row.total),
        membersSaving: parseInt(row.member_count, 10),
        averageSavingsPerMember: parseFloat(row.avg),
      },
    });
  } catch (err) {
    console.error("GET /transactions/savings error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── Member money, cooperative-wide ──────────────────────────────────────────
//
// Loans, dividends and savings are recorded per member, but the Financials page
// reads them per cooperative — and it had nothing to read, so its three tabs
// showed sample data. These list them across the caller's scope: a cooperative
// sees its own, a sector officer their sector, everyone above the district (or
// one cooperative when `cooperativeId` is given).

async function memberMoneyScope(
  req: Request,
  memberColumn: string
): Promise<{ clause: string; params: unknown[] } | null> {
  const role = req.user!.role;
  if (role === "member") {
    // A member sees their own loans, dividends and savings — never a colleague's.
    return {
      clause: `${memberColumn} = (SELECT member_id FROM users WHERE id = $1)`,
      params: [req.user!.userId],
    };
  }
  if (["manager", "cooperative"].includes(role)) {
    if (!req.user!.cooperativeId) return null;
    return { clause: "c.id = $1", params: [req.user!.cooperativeId] };
  }
  const me = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
  const params: unknown[] = [];
  const parts: string[] = ["c.deleted_at IS NULL"];
  if (role === "government" && me.rows[0]?.oversight_level === "sector") {
    params.push(me.rows[0].sector);
    parts.push(`c.sector = $${params.length}`);
  }
  if (req.query.cooperativeId) {
    params.push(req.query.cooperativeId);
    parts.push(`c.id = $${params.length}`);
  }
  return { clause: parts.join(" AND "), params };
}

// GET /loans — every loan to a member, with what has been repaid.
router.get("/loans", authenticate, async (req: Request, res: Response) => {
  try {
    const scope = await memberMoneyScope(req, "l.member_id");
    if (!scope) return res.json({ success: true, data: [] });
    const result = await query(
      `SELECT l.id, l.member_id, m.full_name AS member_name, l.cooperative_id, c.name AS cooperative_name,
              l.amount, l.balance, l.purpose, l.interest_rate, l.issued_at, l.due_at, l.closed_at,
              COALESCE((SELECT SUM(r.amount) FROM loan_repayments r WHERE r.loan_id = l.id), 0) AS amount_paid,
              CASE WHEN l.status = 'active' AND l.due_at < CURRENT_DATE THEN 'overdue' ELSE l.status END AS status
         FROM loan_records l
         JOIN members m ON m.id = l.member_id
         JOIN cooperatives c ON c.id = l.cooperative_id
        WHERE ${scope.clause}
        ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.due_at`,
      scope.params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /transactions/loans error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /dividends — every dividend paid to a member.
router.get("/dividends", authenticate, async (req: Request, res: Response) => {
  try {
    const scope = await memberMoneyScope(req, "d.member_id");
    if (!scope) return res.json({ success: true, data: [] });
    const result = await query(
      `SELECT d.id, d.member_id, m.full_name AS member_name, d.cooperative_id, c.name AS cooperative_name,
              d.amount, d.period, d.paid_at, d.notes, d.created_at
         FROM dividend_records d
         JOIN members m ON m.id = d.member_id
         JOIN cooperatives c ON c.id = d.cooperative_id
        WHERE ${scope.clause}
        ORDER BY d.period DESC, m.full_name`,
      scope.params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /transactions/dividends error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /savings/accounts — each member's savings, last contribution and loan balance.
router.get("/savings/accounts", authenticate, async (req: Request, res: Response) => {
  try {
    const scope = await memberMoneyScope(req, "m.id");
    if (!scope) return res.json({ success: true, data: [] });
    const result = await query(
      `SELECT m.id, m.full_name, m.role, m.status, m.phone, m.membership_date,
              m.total_savings, m.total_contributions, m.cooperative_id, c.name AS cooperative_name,
              (SELECT MAX(mc.date) FROM member_contributions mc WHERE mc.member_id = m.id) AS last_contribution,
              COALESCE((SELECT SUM(l.balance) FROM loan_records l
                         WHERE l.member_id = m.id AND l.status IN ('active','overdue')), 0) AS loan_balance
         FROM members m
         JOIN cooperatives c ON c.id = m.cooperative_id
        WHERE m.deleted_at IS NULL AND ${scope.clause}
        ORDER BY m.total_savings DESC`,
      scope.params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /transactions/savings/accounts error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /export
router.get("/export", authenticate, async (req: Request, res: Response) => {
  try {
    const { format = "csv" } = req.query;
    if (!["csv", "pdf"].includes(format as string)) return res.status(400).json({ message: "format must be csv or pdf" });

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;
    const conditions: string[] = [];
    const params: any[] = [];

    if (role === "manager" || role === "cooperative") {
      conditions.push(`t.cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await query(`SELECT COUNT(*) AS total FROM transactions t ${whereClause}`, params);
    const rowCount = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      message: "Export pending — file generation not yet implemented",
      count: rowCount,
    });
  } catch (err) {
    console.error("GET /transactions/export error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /:id
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT t.*, c.name AS cooperative_name, u.name AS recorded_by_name, m.full_name AS member_name,
              approver.name AS approved_by_name
       FROM transactions t
       LEFT JOIN cooperatives c ON c.id = t.cooperative_id
       LEFT JOIN users u ON u.id = t.recorded_by
       LEFT JOIN members m ON m.id = t.member_id
       LEFT JOIN users approver ON approver.id = t.approved_by
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const t = result.rows[0];
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    if ((role === "manager" || role === "cooperative") && t.cooperative_id !== userCoopId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, data: t });
  } catch (err) {
    console.error("GET /transactions/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /
router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    const {
      cooperativeId, type, category, amount, date, description,
      reference, memberId, paymentMethod, mobileMoneyRef, bankRef,
      attachmentUrl, notes, periodId,
    } = req.body;

    // A manager records for their own cooperative whatever the body says.
    const access = writableCooperative(req, cooperativeId);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });

    if (!type || !category || !amount || !date || !description) {
      return res.status(400).json({ message: "type, category, amount, date, and description are required" });
    }
    if (!["income", "expense"].includes(type)) {
      return res.status(400).json({ message: "type must be income or expense" });
    }
    if (!ALL_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Invalid transaction category" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const validPaymentMethods = ["cash", "bank_transfer", "mobile_money", "cheque"];
    if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const result = await query(
      `INSERT INTO transactions
        (cooperative_id, type, category, amount, date, description, reference, member_id,
         payment_method, mobile_money_ref, bank_ref, attachment_url, notes, period_id,
         recorded_by, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed',NOW(),NOW())
       RETURNING *`,
      [
        access.cooperativeId, type, category, amount, date, description,
        reference || null, memberId || null, paymentMethod || null,
        mobileMoneyRef || null, bankRef || null, attachmentUrl || null,
        notes || null, periodId || null, req.user!.userId,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Transaction recorded successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /transactions error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /batch
router.post("/batch", authenticate, async (req: Request, res: Response) => {
  try {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ message: "transactions must be a non-empty array" });
    }
    if (transactions.length > 50) {
      return res.status(400).json({ message: "Cannot batch more than 50 transactions at once" });
    }

    const requiredFields = ["cooperativeId", "type", "category", "amount", "date", "description"];
    for (let i = 0; i < transactions.length; i++) {
      const missing = requiredFields.filter((f) => !transactions[i][f]);
      if (missing.length > 0) {
        return res.status(400).json({ message: `Transaction at index ${i} is missing: ${missing.join(", ")}` });
      }
      if (!["income", "expense"].includes(transactions[i].type)) {
        return res.status(400).json({ message: `Transaction at index ${i}: type must be income or expense` });
      }
      if (!ALL_CATEGORIES.includes(transactions[i].category)) {
        return res.status(400).json({ message: `Transaction at index ${i}: invalid category` });
      }
    }

    const client = await getClient();
    let insertedIds: string[] = [];

    try {
      await client.query("BEGIN");

      for (const txn of transactions) {
        const r = await client.query(
          `INSERT INTO transactions
            (cooperative_id, type, category, amount, date, description, reference, member_id,
             payment_method, mobile_money_ref, bank_ref, notes, period_id, recorded_by,
             status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',NOW(),NOW())
           RETURNING id`,
          [
            txn.cooperativeId, txn.type, txn.category, txn.amount, txn.date,
            txn.description, txn.reference || null, txn.memberId || null,
            txn.paymentMethod || null, txn.mobileMoneyRef || null,
            txn.bankRef || null, txn.notes || null, txn.periodId || null,
            req.user!.userId,
          ]
        );
        insertedIds.push(r.rows[0].id);
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({
      success: true,
      message: `${transactions.length} transactions recorded successfully`,
      data: { inserted: insertedIds.length, failed: 0, ids: insertedIds },
    });
  } catch (err) {
    console.error("POST /transactions/batch error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /periods
router.post("/periods", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, label, periodStart, periodEnd } = req.body;
    if (!cooperativeId || !label || !periodStart || !periodEnd) {
      return res.status(400).json({ message: "cooperativeId, label, periodStart, and periodEnd are required" });
    }

    const result = await query(
      `INSERT INTO financial_periods (cooperative_id, label, period_start, period_end, status, created_by, created_at)
       VALUES ($1, $2, $3, $4, 'open', $5, NOW())
       RETURNING *`,
      [cooperativeId, label, periodStart, periodEnd, req.user!.userId]
    );

    res.status(201).json({
      success: true,
      message: "Financial period created",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /transactions/periods error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PUT /:id
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ["category", "amount", "date", "description", "reference", "paymentMethod", "mobileMoneyRef", "bankRef", "notes", "attachmentUrl"];
    const invalidFields = Object.keys(updates).filter((k) => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Fields not updatable: ${invalidFields.join(", ")}` });
    }

    const existing = await query(`SELECT status FROM transactions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    if (existing.rows[0].status === "approved") {
      return res.status(400).json({ message: "Cannot edit an approved transaction" });
    }

    const fieldMap: Record<string, string> = {
      category: "category",
      amount: "amount",
      date: "date",
      description: "description",
      reference: "reference",
      paymentMethod: "payment_method",
      mobileMoneyRef: "mobile_money_ref",
      bankRef: "bank_ref",
      notes: "notes",
      attachmentUrl: "attachment_url",
    };

    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (fieldMap[key]) {
        setClauses.push(`${fieldMap[key]} = $${params.length + 1}`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      `UPDATE transactions SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    res.json({ success: true, message: "Transaction updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("PUT /transactions/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PATCH /:id/status
router.patch("/:id/status", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!["cancelled", "reversed"].includes(status)) {
      return res.status(400).json({ message: "status must be cancelled or reversed" });
    }
    if (!reason) {
      return res.status(400).json({ message: "reason is required for cancellation or reversal" });
    }

    const existing = await query(`SELECT * FROM transactions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const txn = existing.rows[0];

    await query(
      `UPDATE transactions SET status = $1, cancellation_reason = $2, updated_at = NOW() WHERE id = $3`,
      [status, reason, id]
    );

    if (status === "reversed") {
      await query(
        `INSERT INTO transactions
          (cooperative_id, type, category, amount, date, description, reference, member_id,
           payment_method, recorded_by, status, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, 'completed', $10, NOW(), NOW())`,
        [
          txn.cooperative_id,
          txn.type === "income" ? "expense" : "income",
          txn.category,
          txn.amount,
          `Reversal of transaction ${id}: ${reason}`,
          txn.reference ? `REV-${txn.reference}` : null,
          txn.member_id,
          txn.payment_method,
          req.user!.userId,
          `Counter-transaction for reversal of ${id}`,
        ]
      );
    }

    res.json({ success: true, message: `Transaction ${status} successfully`, data: { id, status, reason } });
  } catch (err) {
    console.error("PATCH /transactions/:id/status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PATCH /:id/approve
router.patch("/:id/approve", authenticate, authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await query(`SELECT id FROM transactions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const result = await query(
      `UPDATE transactions SET status = 'completed', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user!.userId, id]
    );

    res.json({
      success: true,
      message: "Transaction approved",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("PATCH /transactions/:id/approve error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /:id/attachment
router.post("/:id/attachment", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await query(`SELECT id FROM transactions WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    res.json({
      success: true,
      message: "Attachment upload pending S3 integration",
      data: { transactionId: id, url: "pending S3 integration" },
    });
  } catch (err) {
    console.error("POST /transactions/:id/attachment error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
