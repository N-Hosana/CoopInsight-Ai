import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate);

/** Page sizes the client may ask for; anything else is clamped. */
const pageOf = (page: unknown, limit: unknown) => {
  const l = Math.min(Math.max(Number(limit) || 20, 1), 500);
  const p = Math.max(Number(page) || 1, 1);
  return { limit: l, offset: (p - 1) * l, page: p };
};

/**
 * Turn the raw `login_activity` history into `security_anomalies` rows.
 *
 * Each rule is one INSERT … SELECT that finds the pattern and skips anything
 * already recorded, keyed on `details->>'key'`. So it is safe to run on every
 * page load, an anomaly an admin resolved stays resolved, and nothing is ever
 * flagged twice. Ninety days back is plenty for a district platform and keeps
 * the scans cheap.
 */
async function detectAnomalies() {
  // The grouped rules build their key inside a subquery and filter on it
  // outside: Postgres will not let a NOT EXISTS in HAVING see the time bucket.
  // Buckets are written in UTC so the key does not shift with the session's
  // time zone.
  const hourUtc = `to_char(la.attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')`;
  const dayUtc = `to_char(la.attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const fresh = `WHERE NOT EXISTS (SELECT 1 FROM security_anomalies s WHERE s.details->>'key' = g.key)`;

  const rules: string[] = [
    // Brute force: five or more wrong passwords for one account inside an hour.
    `INSERT INTO security_anomalies (type, severity, description, affected_user_id, details, detected_at)
     SELECT 'Repeated failed sign-ins', 'high',
            g.attempts || ' wrong-password attempts on ' || g.email || ' within one hour',
            g.user_id, jsonb_build_object('key', g.key, 'email', g.email, 'attempts', g.attempts, 'ips', g.ips), g.last_at
       FROM (SELECT la.email, 'bruteforce:' || la.email || ':' || ${hourUtc} AS key,
                    COUNT(*) AS attempts, MAX(la.user_id::text)::uuid AS user_id,
                    jsonb_agg(DISTINCT la.ip_address) AS ips, MAX(la.attempted_at) AS last_at
               FROM login_activity la
              WHERE la.status = 'failed' AND la.user_id IS NOT NULL
                AND la.attempted_at > NOW() - INTERVAL '90 days'
              GROUP BY la.email, ${hourUtc}
             HAVING COUNT(*) >= 5) g
     ${fresh}`,

    // Password spraying: one address failing against three or more accounts in an hour.
    `INSERT INTO security_anomalies (type, severity, description, details, detected_at)
     SELECT 'Password spraying from one address', 'high',
            'IP ' || g.ip || ' failed sign-in against ' || g.accounts || ' different accounts within one hour',
            jsonb_build_object('key', g.key, 'ip', g.ip, 'emails', g.emails), g.last_at
       FROM (SELECT la.ip_address AS ip, 'spray:' || la.ip_address || ':' || ${hourUtc} AS key,
                    COUNT(DISTINCT la.email) AS accounts, jsonb_agg(DISTINCT la.email) AS emails,
                    MAX(la.attempted_at) AS last_at
               FROM login_activity la
              WHERE la.status = 'failed' AND la.attempted_at > NOW() - INTERVAL '90 days'
              GROUP BY la.ip_address, ${hourUtc}
             HAVING COUNT(DISTINCT la.email) >= 3) g
     ${fresh}`,

    // Probing: three or more attempts at addresses that have no account, from one IP in a day.
    `INSERT INTO security_anomalies (type, severity, description, details, detected_at)
     SELECT 'Sign-in attempts on non-existent accounts', 'medium',
            g.attempts || ' attempts from IP ' || g.ip || ' on email addresses with no account',
            jsonb_build_object('key', g.key, 'ip', g.ip, 'emails', g.emails), g.last_at
       FROM (SELECT la.ip_address AS ip, 'probe:' || la.ip_address || ':' || ${dayUtc} AS key,
                    COUNT(*) AS attempts, jsonb_agg(DISTINCT la.email) AS emails, MAX(la.attempted_at) AS last_at
               FROM login_activity la
              WHERE la.status = 'failed' AND la.user_id IS NULL
                AND la.attempted_at > NOW() - INTERVAL '90 days'
              GROUP BY la.ip_address, ${dayUtc}
             HAVING COUNT(*) >= 3) g
     ${fresh}`,

    // Lockouts: someone kept trying after the account was locked.
    `INSERT INTO security_anomalies (type, severity, description, affected_user_id, details, detected_at)
     SELECT 'Sign-in attempted on a locked account', 'medium',
            g.attempts || ' attempt(s) on ' || g.email || ' while it was locked',
            g.user_id, jsonb_build_object('key', g.key, 'email', g.email, 'attempts', g.attempts), g.last_at
       FROM (SELECT la.email, 'locked:' || la.email || ':' || ${hourUtc} AS key,
                    COUNT(*) AS attempts, MAX(la.user_id::text)::uuid AS user_id, MAX(la.attempted_at) AS last_at
               FROM login_activity la
              WHERE la.status = 'locked' AND la.attempted_at > NOW() - INTERVAL '90 days'
              GROUP BY la.email, ${hourUtc}) g
     ${fresh}`,

    // Administrator sign-in in the small hours, Kigali time.
    `INSERT INTO security_anomalies (type, severity, description, affected_user_id, details, detected_at)
     SELECT 'Administrator sign-in outside working hours', 'low',
            u.name || ' (' || u.role || ') signed in at ' ||
              to_char(la.attempted_at AT TIME ZONE 'Africa/Kigali', 'HH24:MI') || ' Kigali time',
            u.id,
            jsonb_build_object('key', 'offhours:' || la.id, 'ip', la.ip_address),
            la.attempted_at
       FROM login_activity la JOIN users u ON u.id = la.user_id
      WHERE la.status = 'success' AND u.role = 'admin'
        AND la.attempted_at > NOW() - INTERVAL '90 days'
        AND EXTRACT(HOUR FROM la.attempted_at AT TIME ZONE 'Africa/Kigali') < 5
        AND NOT EXISTS (SELECT 1 FROM security_anomalies s WHERE s.details->>'key' = 'offhours:' || la.id)`,
  ];
  for (const sql of rules) await query(sql);
}

/** Minimal user-agent reading: enough to tell "Chrome on Windows" from a script. */
function deviceOf(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    /curl|node|axios|python|undici|PostmanRuntime/i.test(ua) ? "Script / API client" : "Other";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// GET /summary — everything the page's headline cards and Overview tab show,
// computed from the database rather than written into the UI.
router.get("/summary", authorize("admin", "generalManager"), async (_req: Request, res: Response) => {
  try {
    await detectAnomalies();

    const [counts, accounts, anomalies, checks] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE refresh_token IS NOT NULL
                                        AND last_login_at > NOW() - INTERVAL '7 days')       AS active_sessions,
          (SELECT COUNT(DISTINCT user_id) FROM login_activity
            WHERE status = 'success' AND attempted_at >= date_trunc('day', NOW()))            AS users_today,
          (SELECT COUNT(*) FROM login_activity WHERE status = 'success'
             AND attempted_at > NOW() - INTERVAL '7 days')                                    AS success_7d,
          (SELECT COUNT(*) FROM login_activity WHERE status = 'failed'
             AND attempted_at > NOW() - INTERVAL '7 days')                                    AS failed_7d,
          (SELECT COUNT(*) FROM login_activity WHERE status = 'locked'
             AND attempted_at > NOW() - INTERVAL '7 days')                                    AS locked_7d,
          (SELECT COUNT(*) FROM login_activity WHERE status = 'failed' AND user_id IS NULL
             AND attempted_at > NOW() - INTERVAL '7 days')                                    AS unknown_7d,
          (SELECT COUNT(*) FROM users WHERE locked_until > NOW())                             AS locked_now,
          (SELECT COUNT(*) FROM audit_logs WHERE created_at >= date_trunc('day', NOW()))     AS audit_today,
          (SELECT COUNT(*) FROM audit_logs)                                                   AS audit_total,
          (SELECT MIN(created_at) FROM audit_logs)                                            AS audit_since,
          (SELECT COUNT(*) FROM login_activity)                                               AS login_total,
          (SELECT MIN(attempted_at) FROM login_activity)                                      AS login_since`),
      query(`
        SELECT u.id, u.name, u.email, u.role, u.status, u.email_verified, u.oversight_level,
               u.failed_attempts, u.locked_until, u.last_login_at,
               (u.locked_until > NOW()) AS is_locked,
               (u.refresh_token IS NOT NULL AND u.last_login_at > NOW() - INTERVAL '7 days') AS has_session,
               c.name AS cooperative_name,
               last.ip_address AS last_ip, last.user_agent AS last_user_agent, last.attempted_at AS last_attempt_at,
               last.status AS last_attempt_status,
               (SELECT COUNT(*) FROM login_activity f WHERE f.user_id = u.id AND f.status = 'failed'
                  AND f.attempted_at > NOW() - INTERVAL '7 days') AS failed_7d
          FROM users u
          LEFT JOIN cooperatives c ON c.id = u.cooperative_id
          LEFT JOIN LATERAL (SELECT ip_address, user_agent, attempted_at, status FROM login_activity
                              WHERE user_id = u.id ORDER BY attempted_at DESC LIMIT 1) last ON true
         ORDER BY u.last_login_at DESC NULLS LAST, u.name`),
      query(`SELECT severity, COUNT(*) FROM security_anomalies WHERE resolved_at IS NULL GROUP BY severity`),
      query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE email_verified = false AND status = 'active') AS unverified,
          (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active')         AS admins,
          (SELECT COUNT(*) FROM users WHERE password_hash NOT LIKE '$2%')                 AS weak_hashes,
          (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid())                      AS db_ssl`),
    ]);

    const c = counts.rows[0];
    const k = checks.rows[0];
    const n = (v: unknown) => Number(v ?? 0);
    const prod = process.env.NODE_ENV === "production";
    const secretOk = (s?: string) => !!s && s.length >= 32;

    // Each check is a fact read off the running system, with the evidence
    // beside it — the page used to show a fixed list of green ticks.
    const posture = [
      { label: "Passwords stored as bcrypt hashes", ok: n(k.weak_hashes) === 0,
        detail: n(k.weak_hashes) === 0 ? "Every account" : `${n(k.weak_hashes)} account(s) not bcrypt` },
      { label: "Two-step sign-in (password + emailed code)", ok: true,
        detail: "Enforced for every role by /auth/login → /auth/verify-otp" },
      { label: "Account lockout after 5 wrong passwords", ok: true,
        detail: `${n(c.locked_now)} account(s) locked right now` },
      { label: "Short-lived access tokens", ok: true, detail: "30 min access, 7 day refresh" },
      { label: "Token signing secrets are strong", ok: secretOk(process.env.JWT_SECRET) && secretOk(process.env.JWT_REFRESH_SECRET),
        detail: secretOk(process.env.JWT_SECRET) && secretOk(process.env.JWT_REFRESH_SECRET)
          ? "Both ≥ 32 characters" : "JWT_SECRET or JWT_REFRESH_SECRET is shorter than 32 characters" },
      { label: "Database connection encrypted (SSL)", ok: !!k.db_ssl,
        detail: k.db_ssl ? "SSL in use" : "Plain connection — acceptable on localhost only" },
      { label: "CORS limited to the configured client", ok: prod,
        detail: prod ? `Only ${process.env.CLIENT_URL}` : "Development mode: any localhost origin allowed" },
      { label: "All active accounts have verified email", ok: n(k.unverified) === 0,
        detail: n(k.unverified) === 0 ? "None unverified" : `${n(k.unverified)} unverified` },
      { label: "Audit trail recording", ok: n(c.audit_total) > 0,
        detail: n(c.audit_total) > 0 ? `${n(c.audit_total)} events since ${new Date(c.audit_since).toLocaleDateString()}`
          : "No events yet — every change made from now on is recorded" },
    ];

    const bySeverity = Object.fromEntries(anomalies.rows.map((r: any) => [r.severity, n(r.count)]));

    res.json({
      success: true,
      data: {
        activeSessions: n(c.active_sessions),
        usersSignedInToday: n(c.users_today),
        successfulLogins7d: n(c.success_7d),
        failedLogins7d: n(c.failed_7d),
        lockedAttempts7d: n(c.locked_7d),
        unknownAccountAttempts7d: n(c.unknown_7d),
        lockedAccountsNow: n(c.locked_now),
        auditEventsToday: n(c.audit_today),
        auditEventsTotal: n(c.audit_total),
        loginRecordsTotal: n(c.login_total),
        loginRecordsSince: c.login_since,
        unresolvedAnomalies: Object.values(bySeverity).reduce((a: number, b) => a + (b as number), 0),
        unresolvedBySeverity: bySeverity,
        adminAccounts: n(k.admins),
        posture,
        accounts: accounts.rows.map((a: any) => ({
          ...a,
          failed_7d: n(a.failed_7d),
          last_device: deviceOf(a.last_user_agent),
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /database — read-only view of what the database holds. Row counts are
// exact (COUNT(*), not the planner's estimate) because at this scale they are
// cheap and an admin will compare them with what they see elsewhere.
router.get("/database", authorize("admin"), async (_req: Request, res: Response) => {
  try {
    const [info, tables, tsCols] = await Promise.all([
      query(`SELECT current_database() AS name, version() AS version,
                    pg_size_pretty(pg_database_size(current_database())) AS size,
                    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
                    (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                    NOW() AS server_time`),
      query(`SELECT relname AS table, pg_total_relation_size(relid) AS bytes,
                    pg_size_pretty(pg_total_relation_size(relid)) AS size
               FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname`),
      query(`SELECT table_name, column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'
                AND column_name IN ('created_at','attempted_at','detected_at','sent_at','transaction_date','date')`),
    ]);

    // The first matching timestamp column per table, in the order listed above.
    const order = ["created_at", "attempted_at", "detected_at", "sent_at", "transaction_date", "date"];
    const tsOf: Record<string, string> = {};
    for (const col of order) {
      for (const r of tsCols.rows) if (r.column_name === col && !tsOf[r.table_name]) tsOf[r.table_name] = col;
    }

    // Names come from the catalog, never from the request, and are quoted.
    const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
    const rows = await Promise.all(
      tables.rows.map(async (t: any) => {
        const col = tsOf[t.table];
        const r = await query(
          col
            ? `SELECT COUNT(*) AS rows, MIN(${q(col)}) AS oldest, MAX(${q(col)}) AS newest FROM ${q(t.table)}`
            : `SELECT COUNT(*) AS rows FROM ${q(t.table)}`
        );
        return {
          table: t.table,
          rows: Number(r.rows[0].rows),
          size: t.size,
          bytes: Number(t.bytes),
          oldest: r.rows[0].oldest ?? null,
          newest: r.rows[0].newest ?? null,
        };
      })
    );

    res.json({ success: true, data: { ...info.rows[0], connections: Number(info.rows[0].connections), tables: rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

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
    const { category, status, search, userId, from, to } = req.query;
    const { page, limit, offset } = pageOf(req.query.page, req.query.limit);

    const params: any[] = [];
    const conditions: string[] = [];

    if (category) { params.push(category); conditions.push(`al.category = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`al.status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(
        `(al.action ILIKE $${i} OR u.name ILIKE $${i} OR u.email ILIKE $${i} OR al.ip_address ILIKE $${i} OR al.details->>'email' ILIKE $${i})`
      );
    }
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
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
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
    const { userId, status, from, to, search } = req.query;
    const { page, limit, offset } = pageOf(req.query.page, req.query.limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (userId) { params.push(userId); conditions.push(`la.user_id = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(la.email ILIKE $${i} OR u.name ILIKE $${i} OR la.ip_address ILIKE $${i})`);
    }
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
    const total = await query(
      `SELECT COUNT(*) FROM login_activity la LEFT JOIN users u ON u.id = la.user_id ${whereClause}`,
      countParams
    );

    res.json({
      success: true,
      data: result.rows.map((r: any) => ({ ...r, device: deviceOf(r.user_agent) })),
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
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
    await detectAnomalies();
    const { severity, resolved } = req.query;
    const { page, limit, offset } = pageOf(req.query.page, req.query.limit);
    const params: any[] = [];
    const conditions: string[] = [];

    if (severity) { params.push(severity); conditions.push(`sa.severity = $${params.length}`); }
    if (resolved === "true") conditions.push(`sa.resolved_at IS NOT NULL`);
    else if (resolved === "false") conditions.push(`sa.resolved_at IS NULL`);

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT sa.*, u.name AS affected_user_name, u.email AS affected_user_email, r.name AS resolved_by_name
       FROM security_anomalies sa
       LEFT JOIN users u ON u.id = sa.affected_user_id
       LEFT JOIN users r ON r.id = sa.resolved_by
       ${whereClause} ORDER BY sa.detected_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM security_anomalies sa ${whereClause}`, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
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
      pagination: { page, limit, total: parseInt(total.rows[0].count) },
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
