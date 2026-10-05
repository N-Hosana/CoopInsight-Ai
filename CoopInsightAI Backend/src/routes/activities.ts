import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { uploadAttachment, buildFileUrl } from "../middleware/upload";
import { writableCooperative } from "../services/cooperativeAccess";

const router = Router();

const VALID_TYPES = ["meeting", "training", "production", "sales", "distribution", "planning"];
const VALID_STATUSES = ["planned", "ongoing", "completed", "cancelled"];

const COOPERATIVE_ROLES = ["manager", "cooperative", "member"];
const OVERSIGHT_ROLES = ["government", "admin", "generalManager"];

/**
 * Whether the caller may read one activity: a cooperative's own people see
 * their own cooperative's, a sector officer sees their sector's, and the
 * district office, the RCA and administrators see all of them.
 *
 * The participant and attachment lists had no check at all, so any signed-in
 * account could read who attended anything in any cooperative.
 */
async function activityAccess(
  req: Request,
  activityId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const found = await query(
    `SELECT a.cooperative_id, c.sector FROM activities a
       JOIN cooperatives c ON c.id = a.cooperative_id
      WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [activityId]
  );
  if (found.rowCount === 0) return { ok: false, status: 404, message: "Activity not found" };
  const act = found.rows[0];

  if (COOPERATIVE_ROLES.includes(req.user!.role)) {
    return act.cooperative_id === req.user!.cooperativeId
      ? { ok: true }
      : { ok: false, status: 403, message: "Access denied" };
  }
  if (req.user!.role === "government") {
    const me = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
    const officer = me.rows[0];
    if (officer?.oversight_level === "sector" && officer.sector !== act.sector) {
      return { ok: false, status: 403, message: "This activity is not in your sector." };
    }
  }
  return { ok: true };
}

/**
 * Whether the caller may CHANGE one activity: only its own cooperative's
 * manager, or an administrator. Every write below used to trust the id alone,
 * so any manager could edit, cancel or mark attendance on another
 * cooperative's activities.
 */
async function activityWrite(
  req: Request,
  activityId: string
): Promise<{ ok: true; status: string; cooperativeId: string } | { ok: false; status: number; message: string }> {
  const found = await query(
    `SELECT cooperative_id, status FROM activities WHERE id = $1 AND deleted_at IS NULL`,
    [activityId]
  );
  if (found.rowCount === 0) return { ok: false, status: 404, message: "Activity not found" };
  const access = writableCooperative(req, found.rows[0].cooperative_id);
  if (!access.ok) return access;
  return { ok: true, status: found.rows[0].status, cooperativeId: found.rows[0].cooperative_id };
}

// ─── GET /oversight ──────────────────────────────────────────────────────────
// What cooperatives are doing, have done and plan to do, across every
// cooperative in the caller's scope, with who was invited and who turned up.
//
// Oversight only, and read-only. A sector officer sees their sector; the
// district office, the RCA and administrators see everything, broken down by
// sector (district office) or by district (RCA), and can narrow to either.
router.get("/oversight", authenticate, async (req: Request, res: Response) => {
  try {
    if (!OVERSIGHT_ROLES.includes(req.user!.role)) {
      return res.status(403).json({
        success: false,
        message: "Activity oversight is for sector, district and RCA officers.",
      });
    }
    const me = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
    const level: string | null = req.user!.role === "government" ? me.rows[0]?.oversight_level ?? null : null;
    const officerSector: string | null = level === "sector" ? me.rows[0]?.sector ?? null : null;

    const { status, type, sector, district, cooperativeId, from, to, search } = req.query;
    const by =
      officerSector ? "cooperative"
      : req.query.by === "sector" || req.query.by === "district" ? (req.query.by as string)
      : level === "district" ? "sector"
      : "district";

    // Everything except the status filter, so the status counts stay visible
    // whichever status is selected.
    const base: string[] = ["a.deleted_at IS NULL", "c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (clause: (n: number) => string, value: unknown) => {
      params.push(value);
      base.push(clause(params.length));
    };
    if (officerSector) add((n) => `c.sector = $${n}`, officerSector);
    else if (sector) add((n) => `c.sector = $${n}`, sector);
    if (district) add((n) => `c.district = $${n}`, district);
    if (cooperativeId) add((n) => `c.id = $${n}`, cooperativeId);
    if (type) add((n) => `a.type = $${n}`, type);
    if (from) add((n) => `a.date >= $${n}::date`, from);
    if (to) add((n) => `a.date <= $${n}::date`, to);
    if (search) add((n) => `(a.title ILIKE $${n} OR c.name ILIKE $${n})`, `%${search}%`);

    const listWhere = [...base];
    const listParams = [...params];
    if (status === "overdue") {
      listWhere.push(`a.status = 'planned' AND a.date < CURRENT_DATE`);
    } else if (status && VALID_STATUSES.includes(status as string)) {
      listParams.push(status);
      listWhere.push(`a.status = $${listParams.length}`);
    }

    const list = await query(
      `SELECT a.id, a.title, a.type, a.status, a.date, a.start_time, a.end_time, a.location,
              a.description, a.outcome, a.cancellation_reason, a.budget, a.actual_cost,
              c.id AS cooperative_id, c.name AS cooperative_name, c.sector, c.district,
              (a.status = 'planned' AND a.date < CURRENT_DATE) AS overdue,
              COUNT(ap.id) AS invited,
              COUNT(ap.id) FILTER (WHERE ap.attended) AS attended
         FROM activities a
         JOIN cooperatives c ON c.id = a.cooperative_id
         LEFT JOIN activity_participants ap ON ap.activity_id = a.id
        WHERE ${listWhere.join(" AND ")}
        GROUP BY a.id, c.id
        ORDER BY
          CASE WHEN a.status = 'ongoing' THEN 0
               WHEN a.status = 'planned' AND a.date >= CURRENT_DATE THEN 1
               WHEN a.status = 'planned' THEN 2
               ELSE 3 END,
          CASE WHEN a.status = 'planned' AND a.date >= CURRENT_DATE THEN a.date END ASC,
          a.date DESC
        LIMIT 300`,
      listParams
    );

    // Attendance is only meaningful once the activity has happened, so the
    // rates are computed over completed activities alone.
    const groupExpr =
      by === "district" ? "c.district" : by === "sector" ? "c.sector" : "c.name";
    const stats = `
      COUNT(DISTINCT a.id) AS activities,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'planned' AND a.date >= CURRENT_DATE) AS planned,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'ongoing') AS ongoing,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'completed') AS completed,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'planned' AND a.date < CURRENT_DATE) AS overdue,
      COUNT(ap.id) FILTER (WHERE a.status = 'completed') AS invited,
      COUNT(ap.id) FILTER (WHERE a.status = 'completed' AND ap.attended) AS attended,
      COUNT(DISTINCT c.id) AS cooperatives_active,
      COUNT(DISTINCT ap.member_id) FILTER (WHERE a.status = 'completed' AND ap.attended) AS distinct_attendees`;
    const from_ = `
      FROM activities a
      JOIN cooperatives c ON c.id = a.cooperative_id
      LEFT JOIN activity_participants ap ON ap.activity_id = a.id
      WHERE ${base.join(" AND ")}`;

    const [summary, groups, coopTotals] = await Promise.all([
      query(`SELECT ${stats} ${from_}`, params),
      query(`SELECT ${groupExpr} AS name, ${stats} ${from_} GROUP BY ${groupExpr} ORDER BY ${groupExpr}`, params),
      // Cooperatives in each group, active or not, so "how many held nothing"
      // can be answered — the silent ones are the ones to worry about.
      query(
        `SELECT ${groupExpr} AS name, COUNT(*) AS total FROM cooperatives c
          WHERE c.deleted_at IS NULL
            ${officerSector ? "AND c.sector = $1" : ""}
          GROUP BY ${groupExpr}`,
        officerSector ? [officerSector] : []
      ),
    ]);

    const toNumbers = (r: Record<string, any>) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) out[k] = k === "name" ? v : parseInt(v, 10);
      out.attendanceRate = out.invited > 0 ? Math.round((out.attended / out.invited) * 1000) / 10 : null;
      return out;
    };
    const totals = new Map(coopTotals.rows.map((r) => [r.name, parseInt(r.total, 10)]));
    const breakdown = groups.rows.map((g) => {
      const n = toNumbers(g);
      n.cooperativesTotal = totals.get(g.name) ?? n.cooperatives_active;
      return n;
    });
    // Groups with cooperatives but no activity at all in the window.
    {
      for (const [name, total] of totals) {
        if (!breakdown.some((b) => b.name === name)) {
          breakdown.push({
            name, activities: 0, planned: 0, ongoing: 0, completed: 0, cancelled: 0, overdue: 0,
            invited: 0, attended: 0, cooperatives_active: 0, distinct_attendees: 0,
            attendanceRate: null, cooperativesTotal: total,
          });
        }
      }
      breakdown.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    res.json({
      success: true,
      data: list.rows.map((r) => ({
        ...r,
        invited: parseInt(r.invited, 10),
        attended: parseInt(r.attended, 10),
      })),
      summary: toNumbers(summary.rows[0]),
      breakdown: { by, groups: breakdown },
      scope: officerSector ? { sector: officerSector } : { level: level ?? req.user!.role },
      truncated: (list.rowCount ?? 0) >= 300,
    });
  } catch (err) {
    console.error("GET /activities/oversight error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET / — list activities
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, type, status, search, from, to, page = 1, limit = 20 } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ["a.deleted_at IS NULL"];
    const params: any[] = [];

    // Role scoping
    if (role === "manager" || role === "cooperative" || role === "member") {
      conditions.push(`a.cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    } else if (cooperativeId) {
      conditions.push(`a.cooperative_id = $${params.length + 1}`);
      params.push(cooperativeId);
    }

    if (type) {
      conditions.push(`a.type = $${params.length + 1}`);
      params.push(type);
    }
    if (status) {
      conditions.push(`a.status = $${params.length + 1}`);
      params.push(status);
    }
    if (from && to) {
      conditions.push(`a.date BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(from, to);
    } else if (from) {
      conditions.push(`a.date >= $${params.length + 1}`);
      params.push(from);
    } else if (to) {
      conditions.push(`a.date <= $${params.length + 1}`);
      params.push(to);
    }
    if (search) {
      conditions.push(`(a.title ILIKE $${params.length + 1} OR a.description ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await query(
      `SELECT COUNT(DISTINCT a.id) AS total FROM activities a ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await query(
      `SELECT a.*, c.name AS cooperative_name, COUNT(ap.id) AS participant_count, u.name AS created_by_name
       FROM activities a
       LEFT JOIN cooperatives c ON c.id = a.cooperative_id
       LEFT JOIN activity_participants ap ON ap.activity_id = a.id
       LEFT JOIN users u ON u.id = a.created_by
       ${whereClause}
       GROUP BY a.id, c.name, u.name
       ORDER BY a.date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error("GET /activities error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /summary
router.get("/summary", authenticate, async (req: Request, res: Response) => {
  try {
    const { cooperativeId, from, to } = req.query;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const conditions: string[] = ["a.deleted_at IS NULL"];
    const params: any[] = [];

    if (role === "manager" || role === "cooperative" || role === "member") {
      conditions.push(`a.cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    } else if (cooperativeId) {
      conditions.push(`a.cooperative_id = $${params.length + 1}`);
      params.push(cooperativeId);
    }

    if (from && to) {
      conditions.push(`a.date BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      params.push(from, to);
    } else if (from) {
      conditions.push(`a.date >= $${params.length + 1}`);
      params.push(from);
    } else if (to) {
      conditions.push(`a.date <= $${params.length + 1}`);
      params.push(to);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const result = await query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE a.status = 'planned') AS planned,
        COUNT(*) FILTER (WHERE a.status = 'ongoing') AS ongoing,
        COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
        COALESCE(AVG(a.actual_cost), 0) AS avg_cost
       FROM activities a ${whereClause}`,
      params
    );

    const row = result.rows[0];
    const total = parseInt(row.total, 10);
    const completed = parseInt(row.completed, 10);

    res.json({
      success: true,
      data: {
        cooperativeId: (role === "manager" || role === "cooperative") ? userCoopId : (cooperativeId || null),
        totalActivities: total,
        completed,
        planned: parseInt(row.planned, 10),
        ongoing: parseInt(row.ongoing, 10),
        cancelled: parseInt(row.cancelled, 10),
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        avgCostPerActivity: parseFloat(row.avg_cost),
      },
    });
  } catch (err) {
    console.error("GET /activities/summary error:", err);
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
    const conditions: string[] = ["deleted_at IS NULL"];
    const params: any[] = [];

    if (role === "manager" || role === "cooperative" || role === "member") {
      conditions.push(`cooperative_id = $${params.length + 1}`);
      params.push(userCoopId);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const countResult = await query(`SELECT COUNT(*) AS total FROM activities ${whereClause}`, params);
    const rowCount = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      message: "Export pending — file generation not yet implemented",
      count: rowCount,
    });
  } catch (err) {
    console.error("GET /activities/export error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /:id
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT a.*, c.name AS cooperative_name, u.name AS created_by_name,
        (SELECT json_agg(json_build_object(
          'id', ap.id, 'memberId', ap.member_id, 'role', ap.role,
          'attended', ap.attended, 'notes', ap.notes,
          'fullName', m.full_name
        ))
         FROM activity_participants ap
         JOIN members m ON m.id = ap.member_id
         WHERE ap.activity_id = a.id
        ) AS participants,
        (SELECT json_agg(json_build_object(
          'id', aa.id, 'name', aa.name, 'url', aa.url,
          'sizeBytes', aa.size_bytes, 'description', aa.description,
          'uploadedAt', aa.uploaded_at
        ))
         FROM activity_attachments aa
         WHERE aa.activity_id = a.id
        ) AS attachments
       FROM activities a
       LEFT JOIN cooperatives c ON c.id = a.cooperative_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    const access = await activityAccess(req, id);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("GET /activities/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /
router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    const {
      title, type, date, startTime, endTime,
      location, description, objectives, outcome, impact,
      budget, actualCost, participantIds,
    } = req.body;

    const access = writableCooperative(req, req.body.cooperativeId);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });
    const cooperativeId = access.cooperativeId;

    if (!title || !type || !date) {
      return res.status(400).json({ message: "title, type and date are required" });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ message: "Invalid activity type" });
    }

    const result = await query(
      `INSERT INTO activities
        (cooperative_id, title, type, status, date, start_time, end_time, location,
         description, objectives, outcome, impact, budget, actual_cost, created_by,
         created_at, updated_at)
       VALUES ($1,$2,$3,'planned',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
       RETURNING *`,
      [
        cooperativeId, title, type, date,
        startTime || null, endTime || null, location || null,
        description || null, objectives ? JSON.stringify(objectives) : null,
        // Both columns are NOT NULL DEFAULT 0, so "not given" is 0, not null —
        // sending null here failed every activity created without a budget.
        outcome || null, impact || null, Number(budget) || 0, Number(actualCost) || 0,
        req.user!.userId,
      ]
    );

    const activity = result.rows[0];

    if (Array.isArray(participantIds) && participantIds.length > 0) {
      for (const memberId of participantIds) {
        await query(
          `INSERT INTO activity_participants (activity_id, member_id, attended)
           VALUES ($1, $2, false)
           ON CONFLICT DO NOTHING`,
          [activity.id, memberId]
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Activity created successfully",
      data: activity,
    });
  } catch (err) {
    console.error("POST /activities error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PUT /:id
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ["title", "type", "date", "startTime", "endTime", "location", "description", "objectives", "outcome", "impact", "budget", "actualCost"];
    const invalidFields = Object.keys(updates).filter((k) => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Fields not updatable: ${invalidFields.join(", ")}` });
    }

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });
    if (write.status === "cancelled") {
      return res.status(400).json({ message: "Cannot edit a cancelled activity" });
    }

    const fieldMap: Record<string, string> = {
      title: "title",
      type: "type",
      date: "date",
      startTime: "start_time",
      endTime: "end_time",
      location: "location",
      description: "description",
      objectives: "objectives",
      outcome: "outcome",
      impact: "impact",
      budget: "budget",
      actualCost: "actual_cost",
    };

    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (fieldMap[key]) {
        setClauses.push(`${fieldMap[key]} = $${params.length + 1}`);
        params.push(key === "objectives" ? JSON.stringify(value) : value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      `UPDATE activities SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    res.json({ success: true, message: "Activity updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("PUT /activities/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PATCH /:id/status
router.patch("/:id/status", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "status must be one of: planned, ongoing, completed, cancelled" });
    }
    if (status === "cancelled" && !reason) {
      return res.status(400).json({ message: "reason is required when cancelling an activity" });
    }

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    const result = await query(
      `UPDATE activities SET status = $1, cancellation_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [status, reason || null, id]
    );

    res.json({ success: true, message: `Activity status updated to ${status}`, data: result.rows[0] });
  } catch (err) {
    console.error("PATCH /activities/:id/status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /:id
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });
    if (write.status !== "planned") {
      return res.status(400).json({ message: "Only planned activities can be deleted" });
    }

    await query(`UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [id]);

    res.json({ success: true, message: "Activity deleted successfully" });
  } catch (err) {
    console.error("DELETE /activities/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /:id/export
router.get("/:id/export", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { format = "pdf" } = req.query;
    if (!["pdf", "txt"].includes(format as string)) return res.status(400).json({ message: "format must be pdf or txt" });

    const existing = await query(`SELECT id FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    res.json({ success: true, message: `Activity export as ${format} — implementation pending` });
  } catch (err) {
    console.error("GET /activities/:id/export error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /:id/participants
router.get("/:id/participants", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await activityAccess(req, id);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const result = await query(
      `SELECT ap.*, m.full_name, m.phone, m.photo_url, m.gender, m.membership_number,
              m.role AS member_role, m.status AS member_status
       FROM activity_participants ap
       JOIN members m ON m.id = ap.member_id
       WHERE ap.activity_id = $1
       ORDER BY ap.attended DESC, m.full_name`,
      [id]
    );

    const total = result.rows.length;
    const attended = result.rows.filter((r) => r.attended).length;

    res.json({
      success: true,
      data: result.rows,
      summary: {
        total,
        attended,
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("GET /activities/:id/participants error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /:id/participants
router.post("/:id/participants", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { memberIds, allActive, attended } = req.body;

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    // A completed activity still takes participants: the register is often
    // written up afterwards, and someone who turned up unregistered did attend.
    if (write.status === "cancelled") {
      return res.status(400).json({ message: "Cannot add participants to a cancelled activity" });
    }

    // Only the cooperative's own members, and `allActive` invites all of them.
    const members = await query(
      allActive === true
        ? `SELECT id FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active'`
        : `SELECT id FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      allActive === true ? [write.cooperativeId] : [write.cooperativeId, Array.isArray(memberIds) ? memberIds : []]
    );
    if (members.rowCount === 0) {
      return res.status(400).json({ message: "Choose at least one member of this cooperative." });
    }
    if (allActive !== true && Array.isArray(memberIds) && members.rowCount !== new Set(memberIds).size) {
      return res.status(403).json({ message: "Every participant must be a member of this cooperative." });
    }

    let added = 0;
    for (const m of members.rows) {
      const r = await query(
        typeof attended === "boolean"
          ? `INSERT INTO activity_participants (activity_id, member_id, attended)
             VALUES ($1, $2, $3)
             ON CONFLICT (activity_id, member_id) DO UPDATE SET attended = EXCLUDED.attended`
          : `INSERT INTO activity_participants (activity_id, member_id, attended)
             VALUES ($1, $2, false)
             ON CONFLICT DO NOTHING`,
        typeof attended === "boolean" ? [id, m.id, attended] : [id, m.id]
      );
      added += r.rowCount || 0;
    }

    res.status(201).json({
      success: true,
      message: `${added} participant(s) added`,
      data: { activityId: id, added },
    });
  } catch (err) {
    console.error("POST /activities/:id/participants error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /:id/participants/:memberId
router.delete("/:id/participants/:memberId", authenticate, async (req: Request, res: Response) => {
  try {
    const { id, memberId } = req.params;
    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    const result = await query(
      `DELETE FROM activity_participants WHERE activity_id = $1 AND member_id = $2`,
      [id, memberId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Participant not found in this activity" });
    }

    res.json({ success: true, message: "Participant removed from activity" });
  } catch (err) {
    console.error("DELETE /activities/:id/participants/:memberId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PATCH /:id/attendance
router.patch("/:id/attendance", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { attendance } = req.body;

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });
    if (write.status === "cancelled") {
      return res.status(400).json({ message: "A cancelled activity has no attendance to record." });
    }

    if (!Array.isArray(attendance) || attendance.length === 0) {
      return res.status(400).json({ message: "attendance must be a non-empty array" });
    }

    for (const entry of attendance) {
      if (!entry.memberId || typeof entry.attended !== "boolean") {
        return res.status(400).json({ message: "Each entry must have memberId and attended (boolean)" });
      }
    }

    let updated = 0;
    for (const entry of attendance) {
      const r = await query(
        `UPDATE activity_participants SET attended = $1, notes = COALESCE($2, notes)
         WHERE activity_id = $3 AND member_id = $4`,
        [entry.attended, entry.notes || null, id, entry.memberId]
      );
      updated += r.rowCount || 0;
    }

    res.json({
      success: true,
      message: `Attendance recorded for ${updated} member(s)`,
      data: { activityId: id, updated },
    });
  } catch (err) {
    console.error("PATCH /activities/:id/attendance error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /:id/attachments
router.get("/:id/attachments", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await activityAccess(req, id);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const result = await query(
      `SELECT * FROM activity_attachments WHERE activity_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /activities/:id/attachments error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /:id/attachments
router.post("/:id/attachments", authenticate, uploadAttachment.single("file"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    if (!req.file) {
      return res.status(400).json({ message: "A file is required" });
    }

    const fileUrl = buildFileUrl(req, "attachments", req.file.filename);

    const result = await query(
      `
      INSERT INTO activity_attachments
        (activity_id, name, url, size_bytes, description, uploaded_by, uploaded_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
      `,
      [id, name || req.file.originalname, fileUrl, req.file.size, description || null, req.user!.userId]
    );

    res.status(201).json({
      success: true,
      message: "Attachment uploaded successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /activities/:id/attachments error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /:id/attachments/:attachmentId
router.delete("/:id/attachments/:attachmentId", authenticate, async (req: Request, res: Response) => {
  try {
    const { id, attachmentId } = req.params;
    const write = await activityWrite(req, id);
    if (!write.ok) return res.status(write.status).json({ success: false, message: write.message });

    const result = await query(
      `DELETE FROM activity_attachments WHERE id = $1 AND activity_id = $2`,
      [attachmentId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Attachment not found" });
    }

    res.json({ success: true, message: "Attachment deleted successfully" });
  } catch (err) {
    console.error("DELETE /activities/:id/attachments/:attachmentId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
