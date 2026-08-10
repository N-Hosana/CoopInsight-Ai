import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET / — paginated notifications
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, type, read } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const userId = req.user!.userId;

    const params: any[] = [userId];
    const conditions: string[] = ["user_id = $1"];

    if (type) { params.push(type); conditions.push(`type = $${params.length}`); }
    if (read === "true") conditions.push(`read_at IS NOT NULL`);
    else if (read === "false") conditions.push(`read_at IS NULL`);

    const whereClause = conditions.join(" AND ");
    const countParams = [...params];
    params.push(Number(limit), offset);
    const lp = params.length - 1;
    const op = params.length;

    const result = await query(
      `SELECT * FROM notifications WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${lp} OFFSET $${op}`,
      params
    );

    const totalResult = await query(`SELECT COUNT(*) FROM notifications WHERE ${whereClause}`, countParams);
    const unreadResult = await query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      unreadCount: parseInt(unreadResult.rows[0].count),
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
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    res.json({ success: true, data: { count: parseInt(result.rows[0].count) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /compliance-reminders
router.get("/compliance-reminders", async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const cooperativeId = req.user!.cooperativeId;
    const isAdmin = role === "admin" || role === "generalManager";
    const reminders: any[] = [];

    // Overdue loans
    const loanParams: any[] = [];
    let loanWhere = `status = 'active' AND due_at < NOW()`;
    if (!isAdmin && cooperativeId) {
      loanParams.push(cooperativeId);
      loanWhere += ` AND cooperative_id = $${loanParams.length}`;
    }
    const overdueLoans = await query(
      `SELECT COUNT(*) FROM loan_records WHERE ${loanWhere}`,
      loanParams
    ).catch(() => ({ rows: [{ count: "0" }] }));
    if (parseInt(overdueLoans.rows[0].count) > 0) {
      reminders.push({
        type: "overdue_loans",
        severity: "high",
        title: "Overdue Loans",
        message: `${overdueLoans.rows[0].count} loan(s) are overdue`,
        count: parseInt(overdueLoans.rows[0].count),
      });
    }

    // Cooperatives with fewer than 3 documents
    const docParams: any[] = [];
    let docWhere = ``;
    if (!isAdmin && cooperativeId) {
      docParams.push(cooperativeId);
      docWhere = ` AND c.id = $${docParams.length}`;
    }
    const missingDocs = await query(
      `SELECT COUNT(*) FROM cooperatives c WHERE (SELECT COUNT(*) FROM documents d WHERE d.cooperative_id = c.id) < 3${docWhere}`,
      docParams
    ).catch(() => ({ rows: [{ count: "0" }] }));
    if (parseInt(missingDocs.rows[0].count) > 0) {
      reminders.push({
        type: "missing_documents",
        severity: "medium",
        title: "Missing Documents",
        message: `${missingDocs.rows[0].count} cooperative(s) have fewer than 3 documents`,
        count: parseInt(missingDocs.rows[0].count),
      });
    }

    // Inactive members — no transactions in 90 days
    const inactiveParams: any[] = [];
    let inactiveWhere = `u.status = 'active' AND (SELECT MAX(t.created_at) FROM transactions t WHERE t.member_id = u.id) < NOW() - INTERVAL '90 days'`;
    if (!isAdmin && cooperativeId) {
      inactiveParams.push(cooperativeId);
      inactiveWhere += ` AND u.cooperative_id = $${inactiveParams.length}`;
    }
    const inactiveMembers = await query(
      `SELECT COUNT(*) FROM users u WHERE ${inactiveWhere}`,
      inactiveParams
    ).catch(() => ({ rows: [{ count: "0" }] }));
    if (parseInt(inactiveMembers.rows[0].count) > 0) {
      reminders.push({
        type: "inactive_members",
        severity: "low",
        title: "Inactive Members",
        message: `${inactiveMembers.rows[0].count} member(s) have had no transactions in 90 days`,
        count: parseInt(inactiveMembers.rows[0].count),
      });
    }

    res.json({ success: true, data: reminders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /sms-status
router.get("/sms-status", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(
      `SELECT status, COUNT(*) AS count FROM sms_logs WHERE sent_by = $1 GROUP BY status`,
      [userId]
    );
    const lastSentResult = await query(
      `SELECT MAX(sent_at) AS last_sent_at FROM sms_logs WHERE sent_by = $1`,
      [userId]
    );
    const stats: Record<string, number> = { delivered: 0, pending: 0, failed: 0, queued: 0 };
    result.rows.forEach((r: any) => { stats[r.status] = parseInt(r.count); });
    res.json({
      success: true,
      data: {
        delivered: stats.delivered,
        pending: stats.pending,
        failed: stats.failed,
        queued: stats.queued,
        totalSent: Object.values(stats).reduce((a, b) => a + b, 0),
        lastSentAt: lastSentResult.rows[0]?.last_sent_at || null,
      },
    });
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
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    res.json({ success: true, message: "All notifications marked as read", count: result.rowCount });
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
    const result = await query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING *`,
      [id, userId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /broadcast — admin/generalManager only
router.post("/broadcast", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const {
      title,
      message,
      type = "info",
      link,
      channels = ["in_app"],
      targetRole,
      targetCooperativeId,
    } = req.body;
    const userId = req.user!.userId;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "title and message are required" });
    }
    if (!channels.length) {
      return res.status(400).json({ success: false, message: "At least one channel is required" });
    }

    // Determine recipients
    const recipientParams: any[] = [];
    let recipientWhere = `status = 'active'`;
    if (targetRole) { recipientParams.push(targetRole); recipientWhere += ` AND role = $${recipientParams.length}`; }
    if (targetCooperativeId) { recipientParams.push(targetCooperativeId); recipientWhere += ` AND cooperative_id = $${recipientParams.length}`; }

    const recipientsResult = await query(
      `SELECT id, phone FROM users WHERE ${recipientWhere}`,
      recipientParams
    );
    const recipients = recipientsResult.rows;

    // Insert in_app notifications
    let notifCount = 0;
    if (channels.includes("in_app")) {
      for (const recipient of recipients) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link) VALUES ($1, $2, $3, $4, $5)`,
          [recipient.id, title, message, type, link || null]
        );
        notifCount++;
      }
    }

    // SMS — queue for Africa's Talking
    if (channels.includes("sms")) {
      const memberIds = recipients.map((r: any) => r.id);
      await query(
        `INSERT INTO sms_logs (member_ids, message, sent_by, status) VALUES ($1, $2, $3, 'queued')`,
        [JSON.stringify(memberIds), message, userId]
      );
      // TODO: Send SMS via Africa's Talking API
    }

    // TODO: Send email via email provider

    res.json({
      success: true,
      message: "Broadcast sent",
      data: { recipientCount: notifCount },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /sms
router.post("/sms", async (req: Request, res: Response) => {
  try {
    const { memberIds, message } = req.body;
    const userId = req.user!.userId;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ success: false, message: "memberIds must be a non-empty array" });
    }
    if (!message || message.length > 160) {
      return res.status(400).json({ success: false, message: "message is required and must be at most 160 characters" });
    }

    const result = await query(
      `INSERT INTO sms_logs (member_ids, message, sent_by, status) VALUES ($1, $2, $3, 'queued') RETURNING *`,
      [JSON.stringify(memberIds), message, userId]
    );

    // TODO: Call Africa's Talking API to send SMS to each member

    res.json({ success: true, data: { queued: memberIds.length, log: result.rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /clear-all — must be before /:id
router.delete("/clear-all", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const result = await query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    res.json({ success: true, message: "All notifications cleared", count: result.rowCount });
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
    const result = await query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
