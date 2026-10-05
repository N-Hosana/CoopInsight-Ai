/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TELLING EVERY MEMBER SOMETHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A notification is a nudge in a bell menu. A broadcast is a message that sits
 * in every member's inbox and can be read back weeks later — which is what a
 * notice of a general assembly has to be, because a member who missed the
 * meeting is entitled to show that they were, or were not, told.
 *
 * Convening any meeting therefore writes BOTH: one `cooperative` message that
 * every member can open in Messages, and one notification per account pointing
 * at it. This module owns that pair so the assembly notice, the dissolution
 * notice and anything else a manager announces all behave identically.
 */

import { query } from "../config/db";

export interface BroadcastResult {
  messageId: string | null;
  /** Accounts that received the message. */
  accountsReached: number;
  /** People on the member register — usually more than have logins. */
  onRegister: number;
  /** Register entries with nobody to notify, so the manager knows to use SMS. */
  withoutAccounts: number;
  note: string | null;
}

/**
 * Sends one announcement to every active account attached to a cooperative.
 *
 * `link` is where the notification takes the reader; the message itself always
 * lands in Messages. The sender is excluded from their own audience.
 */
export async function broadcastToCooperative(options: {
  cooperativeId: string;
  senderId: string;
  senderName?: string;
  subject: string;
  body: string;
  link?: string;
}): Promise<BroadcastResult> {
  const { cooperativeId, senderId, subject, body } = options;
  const link = options.link ?? "/messages";

  const audience = await query(
    `SELECT id FROM users
      WHERE cooperative_id = $1 AND status = 'active' AND id <> $2`,
    [cooperativeId, senderId]
  );
  const accountsReached = audience.rowCount ?? 0;

  const inserted = await query(
    `INSERT INTO messages
       (type, subject, body, sender_id, cooperative_id, audience_scope, audience_size)
     VALUES ('cooperative',$1,$2,$3,$4,'cooperative',$5)
     RETURNING id`,
    [subject, body, senderId, cooperativeId, accountsReached]
  );
  const messageId = inserted.rows[0]?.id ?? null;

  const senderName = options.senderName ? `${options.senderName}: ` : "";
  for (const row of audience.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'announcement',$4)`,
      [row.id, subject, `${senderName}${body.trim().slice(0, 240)}`, link]
    );
  }

  const registerRes = await query(
    `SELECT COUNT(*) AS n FROM members
      WHERE cooperative_id = $1 AND deleted_at IS NULL AND archived_at IS NULL`,
    [cooperativeId]
  );
  const onRegister = parseInt(registerRes.rows[0].n, 10);
  const withoutAccounts = Math.max(0, onRegister - accountsReached);

  return {
    messageId,
    accountsReached,
    onRegister,
    withoutAccounts,
    note:
      accountsReached === 0
        ? "Nobody in this cooperative has a login, so the announcement will not be read by " +
          "anyone. Reach the members by SMS instead."
        : withoutAccounts > 0
          ? `${withoutAccounts} of the ${onRegister} people on the register have no login and will ` +
            "not see this. Use the SMS panel to reach them."
          : null,
  };
}

/**
 * Tells the oversight chain something.
 *
 * `levels` is which tiers to inform — a dissolution informs all three from the
 * moment it is filed, while a routine formation informs only the sector the
 * cooperative sits in. Passing a sector narrows the sector tier to that sector's
 * own officer; the district and RCA tiers are district-wide by definition.
 */
export async function notifyOversight(options: {
  levels: Array<"sector" | "district" | "rca">;
  sector?: string | null;
  title: string;
  message: string;
  link?: string;
}): Promise<number> {
  const { levels, title, message } = options;
  if (!levels.length) return 0;
  const link = options.link ?? "/cooperative-requests";

  // A sector officer is only told about their own sector; district and RCA
  // officers cover the whole district, so no sector filter applies to them.
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const level of levels) {
    if (level === "sector" && options.sector) {
      params.push(options.sector);
      clauses.push(`(oversight_level = 'sector' AND sector = $${params.length})`);
    } else {
      params.push(level);
      clauses.push(`oversight_level = $${params.length}`);
    }
  }

  const officers = await query(
    `SELECT id FROM users WHERE status = 'active' AND (${clauses.join(" OR ")})`,
    params
  );

  for (const officer of officers.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'alert',$4)`,
      [officer.id, title, message, link]
    );
  }
  return officers.rowCount ?? 0;
}
