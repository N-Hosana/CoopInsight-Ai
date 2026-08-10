import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

const VALID_TYPES = ["meeting", "training", "production", "sales", "distribution", "planning"];
const VALID_STATUSES = ["planned", "ongoing", "completed", "cancelled"];

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

    const act = result.rows[0];
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    if ((role === "manager" || role === "cooperative" || role === "member") && act.cooperative_id !== userCoopId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, data: act });
  } catch (err) {
    console.error("GET /activities/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /
router.post("/", authenticate, async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;

    if (role === "member" || role === "government") {
      return res.status(403).json({ success: false, message: "You do not have permission to create activities" });
    }

    const {
      title, type, cooperativeId, date, startTime, endTime,
      location, description, objectives, outcome, impact,
      budget, actualCost, participantIds,
    } = req.body;

    if (!title || !type || !cooperativeId || !date) {
      return res.status(400).json({ message: "title, type, cooperativeId, and date are required" });
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
        outcome || null, impact || null, budget || null, actualCost || null,
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

    const existing = await query(`SELECT status FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }
    if (existing.rows[0].status === "cancelled") {
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

    const existing = await query(`SELECT status FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

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

    const existing = await query(`SELECT status FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }
    if (existing.rows[0].status !== "planned") {
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

    const result = await query(
      `SELECT ap.*, m.full_name, m.phone, m.photo_url
       FROM activity_participants ap
       JOIN members m ON m.id = ap.member_id
       WHERE ap.activity_id = $1`,
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
    const { memberIds } = req.body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ message: "memberIds must be a non-empty array" });
    }

    const existing = await query(`SELECT status FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    const actStatus = existing.rows[0].status;
    if (actStatus === "cancelled" || actStatus === "completed") {
      return res.status(400).json({ message: "Cannot add participants to a cancelled or completed activity" });
    }

    let added = 0;
    for (const memberId of memberIds) {
      const r = await query(
        `INSERT INTO activity_participants (activity_id, member_id, attended)
         VALUES ($1, $2, false)
         ON CONFLICT DO NOTHING`,
        [id, memberId]
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
router.post("/:id/attachments", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { description } = req.body;

    const existing = await query(`SELECT id FROM activities WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    res.status(201).json({
      success: true,
      message: "Attachment upload pending S3 integration",
      data: {
        id: "attachment-placeholder-id",
        activityId: id,
        name: "pending",
        url: "pending S3 integration",
        description: description || null,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("POST /activities/:id/attachments error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// DELETE /:id/attachments/:attachmentId
router.delete("/:id/attachments/:attachmentId", authenticate, async (req: Request, res: Response) => {
  try {
    const { attachmentId } = req.params;

    const result = await query(
      `DELETE FROM activity_attachments WHERE id = $1`,
      [attachmentId]
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
