import { Router, Request, Response } from "express";
import { query, getClient } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

const INCOME_CATEGORIES = ["member_contributions", "loan_repayments", "grants", "product_sales", "service_fees", "donations"];
const EXPENSE_CATEGORIES = ["loan_disbursements", "operational_costs", "salaries", "training", "equipment", "utilities"];
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
      conditions.push(`t.member_id = (SELECT id FROM members WHERE cooperative_id = $${params.length + 1} AND deleted_at IS NULL LIMIT 1)`);
      params.push(userCoopId);
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

    if (!cooperativeId || !type || !category || !amount || !date || !description) {
      return res.status(400).json({ message: "cooperativeId, type, category, amount, date, and description are required" });
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
        cooperativeId, type, category, amount, date, description,
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
