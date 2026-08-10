import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /overview — admin/generalManager
router.get("/overview", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const [lockedAccounts, failedLogins, unresolvedAnomalies, unverifiedUsers, auditLogsToday] =
      await Promise.all([
        query(`SELECT COUNT(*) FROM users WHERE locked_until > NOW()`),
        query(`SELECT COUNT(*) FROM login_activity WHERE status = 'failed' AND attempted_at > NOW() - INTERVAL '24 hours'`),
        query(`SELECT COUNT(*) FROM security_anomalies WHERE resolved_at IS NULL`),
        query(`SELECT COUNT(*) FROM users WHERE email_verified = false AND status = 'active'`),
        query(`SELECT COUNT(*) FROM audit_logs WHERE created_at >= CURRENT_DATE`),
      ]);

    res.json({
      success: true,
      data: {
        lockedAccounts: parseInt(lockedAccounts.rows[0].count),
        failedLoginsLast24h: parseInt(failedLogins.rows[0].count),
        unresolvedAnomalies: parseInt(unresolvedAnomalies.rows[0].count),
        unverifiedUsers: parseInt(unverifiedUsers.rows[0].count),
        auditLogsToday: parseInt(auditLogsToday.rows[0].count),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /audit-logs/export — must be before /audit-logs/:id
router.get("/audit-logs/export", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { category, status, from, to } = req.query;
    const params: any[] = [];
    const conditions: string[] = [];
    if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`created_at <= $${params.length}`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(`SELECT COUNT(*) FROM audit_logs ${whereClause}`, params);
    res.json({ success: true, message: "Export pending", count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /audit-logs
router.get("/audit-logs", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, category, status, search, userId, from, to } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [];
    const conditions: string[] = [];

    if (category) { params.push(category); conditions.push(`al.category = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`al.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`al.action ILIKE $${params.length}`); }
    if (userId) { params.push(userId); conditions.push(`al.user_id = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`al.created_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`al.created_at <= $${params.length}`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT al.*, u.name AS user_name, u.role AS user_role, u.email AS user_email
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
       ${whereClause} ORDER BY al.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(
      `SELECT COUNT(*) FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ${whereClause}`,
      countParams
    );

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

// GET /audit-logs/:id
router.get("/audit-logs/:id", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT al.*, u.name AS user_name, u.role AS user_role, u.email AS user_email
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE al.id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Audit log not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /audit-logs
router.post("/audit-logs", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { category, action, resource, resourceId, status, details } = req.body;
    const userId = req.user!.userId;
    if (!category || !action) {
      return res.status(400).json({ success: false, message: "category and action are required" });
    }

    const result = await query(
      `INSERT INTO audit_logs (category, action, resource, resource_id, status, user_id, ip_address, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        category,
        action,
        resource || null,
        resourceId || null,
        status || "success",
        userId,
        req.ip,
        req.headers["user-agent"] || null,
        details ? JSON.stringify(details) : null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /login-activity
router.get("/login-activity", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, userId, status, from, to } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (userId) { params.push(userId); conditions.push(`la.user_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`la.status = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`la.attempted_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`la.attempted_at <= $${params.length}`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT la.*, u.name AS user_name, u.role AS user_role
       FROM login_activity la LEFT JOIN users u ON u.id = la.user_id
       ${whereClause} ORDER BY la.attempted_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM login_activity la ${whereClause}`, countParams);

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

// GET /login-activity/:userId — own user or admin
router.get("/login-activity/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user!.userId;
    const role = req.user!.role;
    if (requestingUserId !== userId && role !== "admin" && role !== "generalManager") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const result = await query(
      `SELECT * FROM login_activity WHERE user_id = $1 ORDER BY attempted_at DESC LIMIT 30`,
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /anomalies
router.get("/anomalies", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, severity, resolved } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (severity) { params.push(severity); conditions.push(`sa.severity = $${params.length}`); }
    if (resolved === "true") conditions.push(`sa.resolved_at IS NOT NULL`);
    else if (resolved === "false") conditions.push(`sa.resolved_at IS NULL`);

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT sa.*, u.name AS affected_user_name
       FROM security_anomalies sa LEFT JOIN users u ON u.id = sa.affected_user_id
       ${whereClause} ORDER BY sa.detected_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM security_anomalies sa ${whereClause}`, countParams);

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

// PATCH /anomalies/:id/resolve
router.patch("/anomalies/:id/resolve", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolution, notes } = req.body;
    const userId = req.user!.userId;
    if (!resolution) return res.status(400).json({ success: false, message: "resolution is required" });

    const result = await query(
      `UPDATE security_anomalies SET resolved_at = NOW(), resolved_by = $1, resolution = $2, notes = $3 WHERE id = $4 RETURNING *`,
      [userId, resolution, notes || null, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Anomaly not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /anomalies/alert
router.post("/anomalies/alert", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { title, message, severity } = req.body;
    if (!title || !message || !severity) {
      return res.status(400).json({ success: false, message: "title, message, and severity are required" });
    }

    const admins = await query(
      `SELECT id, email FROM users WHERE role IN ('admin', 'generalManager') AND status = 'active'`
    );
    for (const admin of admins.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'alert')`,
        [admin.id, title, message]
      );
    }

    // TODO: Send email/SMS alerts to admins

    res.json({
      success: true,
      message: "Alert sent to admins",
      data: { recipientCount: admins.rows.length },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /users — admin only
router.get("/users", authorize("admin"), async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (role) { params.push(role); conditions.push(`u.role = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`u.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.email_verified,
         u.failed_attempts, u.locked_until, u.last_login_at, u.created_at,
         c.name AS cooperative_name
       FROM users u LEFT JOIN cooperatives c ON c.id = u.cooperative_id
       ${whereClause} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM users u ${whereClause}`, countParams);

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

// PATCH /users/:id/unlock
router.patch("/users/:id/unlock", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id, name, email, status, failed_attempts, locked_until`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /users/:id/suspend
router.patch("/users/:id/suspend", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const result = await query(
      `UPDATE users SET status = 'suspended', suspension_reason = $1, refresh_token = NULL WHERE id = $2 RETURNING id, name, email, status`,
      [reason, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
