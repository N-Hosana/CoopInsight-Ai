import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO CAN WRITE TO WHOM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three kinds of message, and each has an audience the sender must be entitled
 * to address:
 *
 *   personal     one named account.
 *   cooperative  every account attached to one cooperative — what a manager
 *                sends to their own members.
 *   broadcast    an announcement. District-wide from the RCA, the district
 *                office or an administrator; limited to their own sector when a
 *                sector cooperative officer sends it.
 *
 * A note on recipients, because this is where the bug was: a `personal` message
 * addresses a **user account**, not a row in the member register. Those are
 * separate tables with no foreign key between them, so offering the member
 * register as the recipient list produced a foreign-key violation on every
 * send — surfacing as a bare "Server error". `GET /recipients` below returns
 * accounts, which is what `messages.recipient_id` actually points at.
 */

type Audience = "district" | "sector" | "cooperative";

async function loadActor(userId: string) {
  const res = await query(
    `SELECT id, name, role, sector, cooperative_id, oversight_level
       FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return row
    ? {
        id: row.id as string,
        name: row.name as string,
        role: row.role as string,
        sector: row.sector as string | null,
        cooperativeId: row.cooperative_id as string | null,
        oversightLevel: row.oversight_level as string | null,
      }
    : null;
}

type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;

/**
 * What this account may broadcast to, if anything. Returning the audience
 * rather than a boolean is what lets a sector officer send an announcement
 * without it reaching the whole district.
 */
function broadcastAudience(actor: Actor): Audience | null {
  if (["admin", "generalManager"].includes(actor.role)) return "district";
  if (actor.role === "government") {
    // RCA and district officers speak to the district; a sector officer to
    // their own sector.
    return actor.oversightLevel === "sector" ? "sector" : "district";
  }
  return null;
}

/** May this account address a whole cooperative, and which one? */
function cooperativeAudience(actor: Actor, requested?: string | null): string | null {
  if (["admin", "generalManager"].includes(actor.role)) {
    return requested || actor.cooperativeId || null;
  }
  if (["manager", "cooperative"].includes(actor.role)) return actor.cooperativeId;
  return null;
}

// GET / — paginated messages, filter by type and search
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, type, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const userId = req.user!.userId;
    const actor = await loadActor(userId);
    const cooperativeId = actor?.cooperativeId ?? null;
    // The JWT predates oversight_level and sector, so read them from the row.
    const userSector = actor?.sector ?? null;

    // A broadcast reaches you when its audience covers you: district-wide ones
    // reach everyone, a sector one only that sector, and a cooperative message
    // only that cooperative. Without the audience test every sector officer's
    // announcement would land in all seven cooperatives.
    const scopeClause = `(
      m.sender_id = $1
      OR (m.recipient_id = $1 AND m.deleted_at IS NULL)
      OR (m.type = 'broadcast' AND (
            m.audience_scope IS NULL
            OR m.audience_scope = 'district'
            OR (m.audience_scope = 'sector' AND m.audience_sector IS NOT DISTINCT FROM $3)
          ))
      OR (m.type = 'cooperative' AND m.cooperative_id = $2)
    )`;

    const conditions: string[] = [];
    const params: any[] = [userId, cooperativeId ?? null, userSector];

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
    const countParams: any[] = [userId, cooperativeId ?? null, userSector];
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

// GET /recipients — the accounts this sender may write to, and the audiences
// they may address.
//
// This exists because the compose form previously listed the *member register*
// and sent a member id as `recipientId`. `messages.recipient_id` points at
// `users`, so every personal message failed on a foreign key and came back as
// "Server error". These are accounts.
router.get("/recipients", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const conditions = ["u.status = 'active'", "u.id <> $1"];
    const params: any[] = [actor.id];

    if (["manager", "cooperative"].includes(actor.role)) {
      // Their own cooperative, plus the officers who supervise it.
      params.push(actor.cooperativeId);
      params.push(actor.sector);
      conditions.push(
        `(u.cooperative_id = $${params.length - 1}
          OR u.oversight_level IN ('district','rca')
          OR (u.oversight_level = 'sector' AND u.sector = $${params.length}))`
      );
    } else if (actor.role === "member") {
      // A member writes to their own office and their sector officer — not to
      // the rest of the membership.
      params.push(actor.cooperativeId);
      params.push(actor.sector);
      conditions.push(
        `((u.cooperative_id = $${params.length - 1} AND u.role IN ('manager','cooperative'))
          OR (u.oversight_level = 'sector' AND u.sector = $${params.length}))`
      );
    } else if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(
        `(u.sector = $${params.length}
          OR u.cooperative_id IN (SELECT id FROM cooperatives WHERE sector = $${params.length}))`
      );
    }
    // Administrators, RCA and district officers may write to anyone.

    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.oversight_level, u.sector,
              c.name AS cooperative_name
         FROM users u
         LEFT JOIN cooperatives c ON c.id = u.cooperative_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY c.name NULLS FIRST, u.name`,
      params
    );

    const audience = broadcastAudience(actor);
    const coopAudience = cooperativeAudience(actor);

    let cooperativeName: string | null = null;
    if (coopAudience) {
      const c = await query(`SELECT name FROM cooperatives WHERE id = $1`, [coopAudience]);
      cooperativeName = c.rows[0]?.name ?? null;
    }

    res.json({
      success: true,
      data: result.rows,
      // What the compose form is allowed to offer. Driven from here so the
      // options and the server's rules cannot disagree.
      canSend: {
        personal: true,
        cooperative: coopAudience
          ? { cooperativeId: coopAudience, cooperativeName }
          : null,
        broadcast: audience
          ? {
              scope: audience,
              sector: audience === "sector" ? actor.sector : null,
              label:
                audience === "district"
                  ? "Every account in Gasabo District"
                  : `Every account in ${actor.sector} sector`,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("GET /messages/recipients error:", err);
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
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    if (!type || !String(subject ?? "").trim() || !String(body ?? "").trim()) {
      return res
        .status(400)
        .json({ success: false, message: "type, subject, and body are required" });
    }
    if (!["personal", "broadcast", "cooperative"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid message type" });
    }

    let audienceScope: Audience | null = null;
    let audienceSector: string | null = null;
    let targetCooperativeId: string | null = null;
    let audienceSize = 0;

    if (type === "personal") {
      if (!recipientId) {
        return res
          .status(400)
          .json({ success: false, message: "recipientId is required for personal messages" });
      }
      // Checked explicitly so a bad id returns a sentence the sender can act
      // on, rather than a foreign-key violation dressed up as "Server error".
      const recipient = await query(
        `SELECT id, name FROM users WHERE id = $1 AND status = 'active'`,
        [recipientId]
      );
      if (recipient.rowCount === 0) {
        return res.status(400).json({
          success: false,
          message:
            "That recipient is not an active user account. Messages are addressed to accounts, " +
            "not to entries in the member register — pick someone from the recipient list.",
        });
      }
      audienceSize = 1;
    }

    if (type === "cooperative") {
      targetCooperativeId = cooperativeAudience(actor, msgCoopId);
      if (!targetCooperativeId) {
        return res.status(403).json({
          success: false,
          message:
            "Only a cooperative's manager — or an administrator — may address all of its members.",
        });
      }
      audienceScope = "cooperative";
      const count = await query(
        `SELECT COUNT(*) AS n FROM users WHERE cooperative_id = $1 AND status = 'active' AND id <> $2`,
        [targetCooperativeId, actor.id]
      );
      audienceSize = parseInt(count.rows[0].n, 10);
    }

    if (type === "broadcast") {
      const audience = broadcastAudience(actor);
      if (!audience) {
        return res.status(403).json({
          success: false,
          message:
            "Broadcasts are sent by the RCA, the district office, a sector cooperative officer, " +
            "or an administrator. A cooperative manager can address their own members instead.",
        });
      }
      audienceScope = audience;
      audienceSector = audience === "sector" ? actor.sector : null;

      const count =
        audience === "sector"
          ? await query(
              `SELECT COUNT(*) AS n FROM users u
                WHERE u.status = 'active' AND u.id <> $1
                  AND (u.sector = $2
                       OR u.cooperative_id IN (SELECT id FROM cooperatives WHERE sector = $2))`,
              [actor.id, actor.sector]
            )
          : await query(
              `SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND id <> $1`,
              [actor.id]
            );
      audienceSize = parseInt(count.rows[0].n, 10);
    }

    const result = await query(
      `INSERT INTO messages
         (type, subject, body, sender_id, recipient_id, cooperative_id,
          audience_scope, audience_sector, audience_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        type,
        String(subject).trim(),
        String(body).trim(),
        actor.id,
        type === "personal" ? recipientId : null,
        targetCooperativeId,
        audienceScope,
        audienceSector,
        audienceSize,
      ]
    );

    // A message sitting in an inbox nobody opens is not communication. Every
    // audience member also gets a notification pointing at it.
    const message = result.rows[0];
    let notified = 0;
    if (type !== "personal") {
      const audienceQuery =
        type === "cooperative"
          ? await query(
              `SELECT id FROM users WHERE cooperative_id = $1 AND status = 'active' AND id <> $2`,
              [targetCooperativeId, actor.id]
            )
          : audienceScope === "sector"
            ? await query(
                `SELECT id FROM users u
                  WHERE u.status = 'active' AND u.id <> $1
                    AND (u.sector = $2
                         OR u.cooperative_id IN (SELECT id FROM cooperatives WHERE sector = $2))`,
                [actor.id, actor.sector]
              )
            : await query(
                `SELECT id FROM users WHERE status = 'active' AND id <> $1`,
                [actor.id]
              );
      for (const u of audienceQuery.rows) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,$2,$3,'announcement','/messages')`,
          [u.id, String(subject).trim(), `${actor.name}: ${String(body).trim().slice(0, 180)}`]
        );
      }
      notified = audienceQuery.rowCount ?? 0;
    } else {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,$2,$3,'message','/messages')`,
        [recipientId, String(subject).trim(), `${actor.name} sent you a message.`]
      );
      notified = 1;
    }

    // ── How far this actually reached ───────────────────────────────────────
    // A message goes to user ACCOUNTS. Most people on a cooperative's register
    // have never been given a login, so "sent to the whole cooperative" can
    // quietly mean "sent to the two people who happen to have accounts". The
    // sender is told the gap rather than left to assume it reached everyone —
    // and pointed at SMS, which is how the rest are actually reached.
    let reach: {
      accountsReached: number;
      onRegister: number;
      withoutAccounts: number;
      note: string | null;
    } | null = null;

    if (type !== "personal") {
      const registerRes =
        type === "cooperative"
          ? await query(
              `SELECT COUNT(*) AS n FROM members
                WHERE cooperative_id = $1 AND deleted_at IS NULL`,
              [targetCooperativeId]
            )
          : audienceScope === "sector"
            ? await query(
                `SELECT COUNT(*) AS n FROM members m
                   JOIN cooperatives c ON c.id = m.cooperative_id
                  WHERE m.deleted_at IS NULL AND c.sector = $1`,
                [actor.sector]
              )
            : await query(`SELECT COUNT(*) AS n FROM members WHERE deleted_at IS NULL`);

      const onRegister = parseInt(registerRes.rows[0].n, 10);
      const withoutAccounts = Math.max(0, onRegister - notified);

      reach = {
        accountsReached: notified,
        onRegister,
        withoutAccounts,
        note:
          notified === 0
            ? "Nobody in this audience has a user account, so this message will not be read by " +
              "anyone. Reach them by SMS instead."
            : withoutAccounts > 0
              ? `${withoutAccounts} of the ${onRegister} people on the register have no login and ` +
                "will not see this. Use the SMS panel to reach them."
              : null,
      };
    }

    res.status(201).json({
      success: true,
      message:
        type === "personal"
          ? "Message sent."
          : notified === 0
            ? "Nobody in this audience has a user account, so the message reached no one."
            : `Sent to ${notified} account(s).` +
              (reach?.withoutAccounts
                ? ` ${reach.withoutAccounts} more are on the register without a login.`
                : ""),
      data: message,
      audience: { scope: audienceScope, sector: audienceSector, size: audienceSize },
      notified,
      reach,
    });
  } catch (err) {
    console.error("POST /messages error:", err);
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
