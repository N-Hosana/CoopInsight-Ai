import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET / — paginated messages, filter by type and search
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, type, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const userId = req.user!.userId;
    const cooperativeId = req.user!.cooperativeId;

    const scopeClause = `(m.sender_id = $1 OR (m.recipient_id = $1 AND m.deleted_at IS NULL) OR m.type = 'broadcast' OR (m.type = 'cooperative' AND m.cooperative_id = $2))`;

    const conditions: string[] = [];
    const params: any[] = [userId, cooperativeId];

    if (type) {
      params.push(type);
      conditions.push(`m.type = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(m.subject ILIKE $${params.length} OR m.body ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";

    // Count query
    const countParams: any[] = [userId, cooperativeId];
    const countConditions: string[] = [];
    if (type) { countParams.push(type); countConditions.push(`m.type = $${countParams.length}`); }
    if (search) { countParams.push(`%${search}%`); countConditions.push(`(m.subject ILIKE $${countParams.length} OR m.body ILIKE $${countParams.length})`); }
    const countWhere = countConditions.length > 0 ? ` AND ${countConditions.join(" AND ")}` : "";

    params.push(Number(limit), offset);
    const limitParam = params.length - 1;
    const offsetParam = params.length;

    const result = await query(
      `SELECT m.*,
        s.name AS sender_name, s.email AS sender_email,
        r.name AS recipient_name,
        (SELECT COUNT(*) FROM message_replies mr WHERE mr.message_id = m.id) AS reply_count
       FROM messages m
       LEFT JOIN users s ON s.id = m.sender_id
       LEFT JOIN users r ON r.id = m.recipient_id
       WHERE ${scopeClause}${whereClause}
       ORDER BY m.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const totalResult = await query(
      `SELECT COUNT(*) FROM messages m WHERE ${scopeClause}${countWhere}`,
      countParams
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: parseInt(totalResult.rows[0].count),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /unread-count
router.get("/unread-count", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `SELECT COUNT(*) FROM messages WHERE (recipient_id = $1 OR type = 'broadcast') AND read_at IS NULL AND deleted_at IS NULL`,
      [userId]
    );
    res.json({ success: true, data: { count: parseInt(result.rows[0].count) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /:id — full message with replies
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const role = req.user!.role;

    const result = await query(
      `SELECT m.*,
        s.name AS sender_name, s.email AS sender_email,
        r.name AS recipient_name
       FROM messages m
       LEFT JOIN users s ON s.id = m.sender_id
       LEFT JOIN users r ON r.id = m.recipient_id
       WHERE m.id = $1`,
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ success: false, message: "Message not found" });

    const message = result.rows[0];
    const isAdmin = role === "admin" || role === "generalManager";
    const hasAccess =
      message.sender_id === userId ||
      message.recipient_id === userId ||
      message.type === "broadcast" ||
      isAdmin;
    if (!hasAccess) return res.status(403).json({ success: false, message: "Forbidden" });

    // Mark as read
    if (message.recipient_id === userId && !message.read_at) {
      await query(
        `UPDATE messages SET read_at = NOW() WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL`,
        [id, userId]
      );
    }

    const repliesResult = await query(
      `SELECT mr.*, u.name AS sender_name
       FROM message_replies mr
       LEFT JOIN users u ON u.id = mr.sender_id
       WHERE mr.message_id = $1
       ORDER BY mr.created_at ASC`,
      [id]
    );

    res.json({ success: true, data: { ...message, replies: repliesResult.rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST / — create message
router.post("/", async (req: Request, res: Response) => {
  try {
    const { type, subject, body, recipientId, cooperativeId: msgCoopId } = req.body;
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    if (!type || !subject || !body) {
      return res.status(400).json({ success: false, message: "type, subject, and body are required" });
    }
    if (!["personal", "broadcast", "cooperative"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid message type" });
    }
    if (type === "personal" && !recipientId) {
      return res.status(400).json({ success: false, message: "recipientId is required for personal messages" });
    }
    if (type === "broadcast" && !["admin", "generalManager"].includes(userRole)) {
      return res.status(403).json({ success: false, message: "Only admins can send broadcasts" });
    }

    const result = await query(
      `INSERT INTO messages (type, subject, body, sender_id, recipient_id, cooperative_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [type, subject, body, userId, recipientId || null, msgCoopId || req.user!.cooperativeId || null]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /:id/reply
router.post("/:id/reply", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { body } = req.body;
    const userId = req.user!.userId;

    if (!body) return res.status(400).json({ success: false, message: "body is required" });

    const msgResult = await query(`SELECT * FROM messages WHERE id = $1`, [id]);
    if (!msgResult.rows.length) return res.status(404).json({ success: false, message: "Message not found" });

    const message = msgResult.rows[0];
    if (message.sender_id !== userId && message.recipient_id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const result = await query(
      `INSERT INTO message_replies (message_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [id, userId, body]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /read-all — must be before /:id/read
router.patch("/read-all", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `UPDATE messages SET read_at = NOW() WHERE recipient_id = $1 AND read_at IS NULL`,
      [userId]
    );
    res.json({ success: true, message: "All messages marked as read", count: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /:id/read
router.patch("/:id/read", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    await query(
      `UPDATE messages SET read_at = NOW() WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [id, userId]
    );
    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const result = await query(
      `UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)`,
      [id, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Message not found or no permission" });
    }
    res.json({ success: true, message: "Message deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
