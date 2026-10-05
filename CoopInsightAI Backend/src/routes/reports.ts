import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { buildReport, toCsv } from "../services/reportBuilder";

const router = Router();
router.use(authenticate);

const VALID_REPORT_TYPES = [
  "financial_summary",
  "member_activity",
  "loan_performance",
  "savings_growth",
  "compliance",
  "audit",
  "budget_variance",
  "annual",
];
const VALID_FORMATS = ["pdf", "excel", "csv", "json"];

const TEMPLATES = [
  { id: "financial_summary", name: "Financial Summary", description: "Overview of income, expenses, and net position", type: "financial_summary", parameters: ["from", "to", "cooperativeId"] },
  { id: "member_activity", name: "Member Activity Report", description: "Track member transactions and engagement", type: "member_activity", parameters: ["from", "to", "cooperativeId"] },
  { id: "loan_performance", name: "Loan Performance Report", description: "Loan disbursements, repayments, and defaults", type: "loan_performance", parameters: ["from", "to", "cooperativeId"] },
  { id: "savings_growth", name: "Savings Growth Report", description: "Member savings trends and growth analysis", type: "savings_growth", parameters: ["from", "to", "cooperativeId"] },
  { id: "compliance", name: "Compliance Report", description: "Regulatory compliance status and gaps", type: "compliance", parameters: ["cooperativeId"] },
  { id: "budget_variance", name: "Budget Variance Report", description: "Actual vs planned budget comparison", type: "budget_variance", parameters: ["budgetId", "cooperativeId"] },
  { id: "annual", name: "Annual Report", description: "Comprehensive annual cooperative report", type: "annual", parameters: ["year", "cooperativeId"] },
];

// GET / — paginated list
router.get("/", async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    if (role === "member") return res.status(403).json({ success: false, message: "Access denied" });

    const { page = 1, limit = 20, type, cooperativeId, from, to, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (type) { params.push(type); conditions.push(`r.type = $${params.length}`); }
    if (cooperativeId) { params.push(cooperativeId); conditions.push(`r.cooperative_id = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`r.created_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`r.created_at <= $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`r.title ILIKE $${params.length}`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT r.*, u.name AS generated_by_name, c.name AS cooperative_name
       FROM reports r
       LEFT JOIN users u ON u.id = r.generated_by
       LEFT JOIN cooperatives c ON c.id = r.cooperative_id
       ${whereClause} ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM reports r ${whereClause}`, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: Number(page), limit: Number(limit), total: parseInt(total.rows[0].count) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /templates
router.get("/templates", async (_req: Request, res: Response) => {
  res.json({ success: true, data: TEMPLATES });
});

// GET /schedules
router.get("/schedules", async (req: Request, res: Response) => {
  try {
    const { cooperativeId } = req.query;
    const params: any[] = [];
    let whereClause = `WHERE rs.active = true`;
    if (cooperativeId) {
      params.push(cooperativeId);
      whereClause += ` AND rs.cooperative_id = $${params.length}`;
    }

    const result = await query(
      `SELECT rs.*, u.name AS created_by_name
       FROM report_schedules rs LEFT JOIN users u ON u.id = rs.created_by
       ${whereClause} ORDER BY rs.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /budgets
router.get("/budgets", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, cooperativeId, status, year } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (cooperativeId) { params.push(cooperativeId); conditions.push(`b.cooperative_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }
    if (year) { params.push(year); conditions.push(`EXTRACT(YEAR FROM b.period_start) = $${params.length}`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT b.*, c.name AS cooperative_name, u.name AS created_by_name
       FROM budgets b
       LEFT JOIN cooperatives c ON c.id = b.cooperative_id
       LEFT JOIN users u ON u.id = b.created_by
       ${whereClause} ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM budgets b ${whereClause}`, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: Number(page), limit: Number(limit), total: parseInt(total.rows[0].count) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /budgets/:id
router.get("/budgets/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT b.*, c.name AS cooperative_name, u.name AS created_by_name,
        json_agg(
          json_build_object(
            'id', bl.id,
            'category', bl.category,
            'description', bl.description,
            'planned_amount', bl.planned_amount
          ) ORDER BY bl.category
        ) AS line_items
       FROM budgets b
       LEFT JOIN cooperatives c ON c.id = b.cooperative_id
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN budget_lines bl ON bl.budget_id = b.id
       WHERE b.id = $1
       GROUP BY b.id, c.name, u.name`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Budget not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /budgets/:id/variance
router.get("/budgets/:id/variance", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const budgetResult = await query(`SELECT * FROM budgets WHERE id = $1`, [id]);
    if (!budgetResult.rows.length) {
      return res.status(404).json({ success: false, message: "Budget not found" });
    }

    const variance = await query(
      `SELECT bl.category, bl.description, bl.planned_amount,
        COALESCE(SUM(t.amount), 0) AS actual_amount,
        bl.planned_amount - COALESCE(SUM(t.amount), 0) AS variance,
        CASE WHEN bl.planned_amount > 0
          THEN ROUND((COALESCE(SUM(t.amount), 0) / bl.planned_amount * 100)::numeric, 2)
          ELSE 0
        END AS utilization_pct
       FROM budget_lines bl
       LEFT JOIN transactions t ON t.category = bl.category
         AND t.created_at BETWEEN (SELECT period_start FROM budgets WHERE id = $1)
         AND (SELECT period_end FROM budgets WHERE id = $1)
       WHERE bl.budget_id = $1
       GROUP BY bl.id, bl.category, bl.description, bl.planned_amount`,
      [id]
    );

    res.json({ success: true, data: { budget: budgetResult.rows[0], variance: variance.rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /budgets/:id/export
router.get("/budgets/:id/export", async (req: Request, res: Response) => {
  res.json({ success: true, message: "Budget export is pending. You will be notified when it is ready." });
});

// GET /:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = req.user!.role;
    if (role === "member") return res.status(403).json({ success: false, message: "Access denied" });

    const result = await query(
      `SELECT r.*, u.name AS generated_by_name, c.name AS cooperative_name
       FROM reports r
       LEFT JOIN users u ON u.id = r.generated_by
       LEFT JOIN cooperatives c ON c.id = r.cooperative_id
       WHERE r.id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /:id/download
// GET /:id/download — the report itself, as a file.
//
// `?format=csv` streams a spreadsheet; `json` returns the structured content
// the viewer renders. Reports generated before the builder existed have no
// content and say so, rather than serving an empty file that looks like a
// report with nothing in it.
router.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const format = String(req.query.format ?? "csv").toLowerCase();

    const result = await query(
      `SELECT title, type, content, format, generated_at FROM reports WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    const row = result.rows[0];
    if (!row.content) {
      return res.status(409).json({
        success: false,
        message:
          "This report was recorded before report contents were stored, so there is nothing to " +
          "download. Generate it again to produce a file.",
        regenerate: true,
      });
    }

    const safeName = String(row.title).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const stamp = row.generated_at
      ? new Date(row.generated_at).toISOString().slice(0, 10)
      : "report";

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${stamp}.json"`);
      return res.send(JSON.stringify(row.content, null, 2));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${stamp}.csv"`);
    return res.send(toCsv(row.content));
  } catch (err) {
    console.error("GET /reports/:id/download error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /generate
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    if (role === "member") return res.status(403).json({ success: false, message: "Access denied" });

    const { type, from, to, format = "pdf", cooperativeId, title } = req.body;
    const userId = req.user!.userId;

    if (!type || !from || !to || !format) {
      return res.status(400).json({ success: false, message: "type, from, to, and format are required" });
    }
    if (!VALID_REPORT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid report type" });
    }
    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({ success: false, message: "Invalid format" });
    }

    // ── Build it now, rather than queueing something nothing consumes ──────
    // This endpoint used to insert file_url = 'pending' and return. There was
    // no worker, so "pending" was permanent and every download button on the
    // page led nowhere. The figures are queried here and stored with the row,
    // which is what makes the download real — and what freezes the report at
    // the moment it was run, instead of silently recomputing later.
    const scopedCooperativeId = cooperativeId || req.user!.cooperativeId || null;
    const resolvedTitle = title || TEMPLATES.find((t) => t.type === type)?.name || `${type} report`;

    const content = await buildReport({
      type,
      title: resolvedTitle,
      cooperativeId: scopedCooperativeId,
      from,
      to,
    });

    const result = await query(
      `INSERT INTO reports
         (title, type, cooperative_id, parameters, file_url, format, generated_by,
          content, row_count, period_from, period_to, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
      [
        resolvedTitle,
        type,
        scopedCooperativeId,
        JSON.stringify({ from, to }),
        "generated",
        format,
        userId,
        JSON.stringify(content),
        content.rowCount,
        from,
        to,
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message:
        content.rowCount > 0
          ? `Report generated — ${content.rowCount} row(s). Open or download it from the list.`
          : "Report generated, but there was no data in that period.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /schedule
router.post("/schedule", async (req: Request, res: Response) => {
  try {
    const { type, frequency, format = "pdf", recipients, cooperativeId, title, nextRunAt } = req.body;
    const userId = req.user!.userId;

    if (!type || !frequency || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: "type, frequency, and recipients are required" });
    }

    const result = await query(
      `INSERT INTO report_schedules (type, cooperative_id, frequency, format, recipients, title, next_run_at, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING *`,
      [
        type,
        cooperativeId || req.user!.cooperativeId || null,
        frequency,
        format,
        JSON.stringify(recipients),
        title || `Scheduled ${type}`,
        nextRunAt || null,
        userId,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /budgets
router.post("/budgets", async (req: Request, res: Response) => {
  try {
    const { title, cooperativeId, periodStart, periodEnd, lineItems = [], notes } = req.body;
    const userId = req.user!.userId;

    if (!title || !periodStart || !periodEnd) {
      return res.status(400).json({ success: false, message: "title, periodStart, and periodEnd are required" });
    }

    const totalPlanned = lineItems.reduce(
      (sum: number, item: any) => sum + (Number(item.planned_amount) || 0),
      0
    );

    await query("BEGIN");
    try {
      const budgetResult = await query(
        `INSERT INTO budgets (title, cooperative_id, period_start, period_end, total_planned, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'draft',$6,$7) RETURNING *`,
        [title, cooperativeId || req.user!.cooperativeId || null, periodStart, periodEnd, totalPlanned, notes || null, userId]
      );
      const budget = budgetResult.rows[0];

      for (const item of lineItems) {
        await query(
          `INSERT INTO budget_lines (budget_id, category, description, planned_amount) VALUES ($1,$2,$3,$4)`,
          [budget.id, item.category, item.description || null, item.planned_amount]
        );
      }

      await query("COMMIT");
      res.status(201).json({ success: true, data: { ...budget, lineItems } });
    } catch (e) {
      await query("ROLLBACK");
      throw e;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /budgets/:id
router.put("/budgets/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, periodStart, periodEnd, notes, lineItems } = req.body;

    const existing = await query(`SELECT status FROM budgets WHERE id = $1`, [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "Budget not found" });
    }
    if (existing.rows[0].status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft budgets can be edited" });
    }

    const totalPlanned = lineItems
      ? lineItems.reduce((sum: number, item: any) => sum + (Number(item.planned_amount) || 0), 0)
      : undefined;

    await query("BEGIN");
    try {
      const updateResult = await query(
        `UPDATE budgets SET
           title = COALESCE($1, title),
           period_start = COALESCE($2, period_start),
           period_end = COALESCE($3, period_end),
           notes = COALESCE($4, notes),
           total_planned = COALESCE($5, total_planned),
           updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [title || null, periodStart || null, periodEnd || null, notes || null, totalPlanned ?? null, id]
      );

      if (lineItems) {
        await query(`DELETE FROM budget_lines WHERE budget_id = $1`, [id]);
        for (const item of lineItems) {
          await query(
            `INSERT INTO budget_lines (budget_id, category, description, planned_amount) VALUES ($1,$2,$3,$4)`,
            [id, item.category, item.description || null, item.planned_amount]
          );
        }
      }

      await query("COMMIT");
      res.json({ success: true, data: updateResult.rows[0] });
    } catch (e) {
      await query("ROLLBACK");
      throw e;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /budgets/:id/approve
router.patch("/budgets/:id/approve", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const existing = await query(`SELECT status FROM budgets WHERE id = $1`, [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "Budget not found" });
    }
    if (existing.rows[0].status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft budgets can be approved" });
    }

    const result = await query(
      `UPDATE budgets SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2 RETURNING *`,
      [userId, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /budgets/:id
router.delete("/budgets/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await query(`SELECT status FROM budgets WHERE id = $1`, [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "Budget not found" });
    }
    if (existing.rows[0].status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft budgets can be deleted" });
    }

    await query(`DELETE FROM budget_lines WHERE budget_id = $1`, [id]);
    await query(`DELETE FROM budgets WHERE id = $1`, [id]);
    res.json({ success: true, message: "Budget deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /schedules/:id
router.delete("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query(`UPDATE report_schedules SET active = false WHERE id = $1`, [id]);
    res.json({ success: true, message: "Schedule cancelled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const role = req.user!.role;
    const isAdmin = role === "admin" || role === "generalManager";

    const existing = await query(`SELECT generated_by FROM reports WHERE id = $1`, [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    if (!isAdmin && existing.rows[0].generated_by !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await query(`DELETE FROM reports WHERE id = $1`, [id]);
    res.json({ success: true, message: "Report deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
