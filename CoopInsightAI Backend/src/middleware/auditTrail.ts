import { Request, Response, NextFunction } from "express";
import { query } from "../config/db";

/**
 * Writes one `audit_logs` row for every request that changes something.
 *
 * Mounted once, ahead of every router, rather than sprinkled through the
 * route modules: a trail that depends on each handler remembering to log is a
 * trail with holes in it. The row is written on `finish`, by which point the
 * router's own `authenticate` has put the caller on `req.user` and the status
 * code is known, so the entry says who did it and whether it worked.
 *
 * Reads (GET/HEAD/OPTIONS) are not recorded — they would bury the changes —
 * and neither is the silent access-token refresh the client does every 30
 * minutes. Request bodies are never stored: they carry passwords, OTP codes and
 * member financial data. Only the email address is kept for the sign-in
 * routes, because without it a failed attempt cannot be attributed to anyone.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SKIP = new Set(["/api/auth/refresh-token"]);

/** Which audit category a route prefix belongs to. Matches the page's filter. */
const CATEGORY: Record<string, string> = {
  auth: "login",
  transactions: "financial",
  funding: "financial",
  members: "member",
  membership: "member",
  "cooperative-requests": "member",
  reports: "report",
  exports: "report",
  audits: "report",
  "rca-audits": "report",
  security: "security",
  settings: "security",
  integrations: "security",
};

/** Plain-language names for the sign-in steps, which a verb + path describes badly. */
const AUTH_ACTIONS: Record<string, string> = {
  login: "Password check",
  "send-otp": "Resent sign-in code",
  "verify-otp": "Sign-in code check",
  logout: "Signed out",
  register: "Registered account",
  "verify-email": "Verified email",
  "resend-verification": "Resent email verification",
  "forgot-password": "Requested password reset",
  "verify-reset-otp": "Verified password-reset code",
  "reset-password": "Reset password",
  "report-failed-login": "Reported failed sign-in",
};

const VERB: Record<string, string> = {
  POST: "Created",
  PUT: "Updated",
  PATCH: "Updated",
  DELETE: "Deleted",
};

function describe(method: string, segments: string[]): string {
  const [resource, ...rest] = segments;
  if (resource === "auth") return AUTH_ACTIONS[rest[0]] ?? `Auth: ${rest.join("/")}`;

  // The last non-id segment is usually the operation (".../approve",
  // ".../resolve"); with none, fall back to the verb on the resource.
  // The thing acted on is the segment before the operation, or the resource.
  const words = [resource, ...rest].filter((s) => !UUID.test(s) && !/^\d+$/.test(s)).map((s) => s.replace(/-/g, " "));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (words.length > 1 && method !== "DELETE") {
    const op = words[words.length - 1];
    const noun = words[words.length - 2];
    return `${cap(op)} (${noun})`;
  }
  return `${VERB[method] ?? method} ${words[words.length - 1]}`;
}

export function auditTrail(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  const path = req.originalUrl.split("?")[0];
  if (!VERB[method] || !path.startsWith("/api/") || SKIP.has(path)) return next();

  // Taken now: the sign-in routes are the only ones whose body we look at,
  // and only for the identifying fields.
  const bodyEmail = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : null;
  const bodyUserId = typeof req.body?.userId === "string" && UUID.test(req.body.userId) ? req.body.userId : null;

  res.on("finish", () => {
    const segments = path.slice("/api/".length).split("/").filter(Boolean);
    const resource = segments[0] ?? "api";
    const resourceId = segments.find((s) => UUID.test(s)) ?? null;
    const userId = req.user?.userId ?? (resource === "auth" ? bodyUserId : null);
    const status = res.statusCode < 400 ? "success" : "failure";

    const details: Record<string, unknown> = { method, path, statusCode: res.statusCode };
    if (resource === "auth" && bodyEmail) details.email = bodyEmail;

    const write = async () => {
      // A failed password check carries only an email. Attribute it to the
      // account it was aimed at, when there is one.
      let uid = userId;
      if (!uid && bodyEmail) {
        const r = await query("SELECT id FROM users WHERE email = $1", [bodyEmail]);
        uid = r.rows[0]?.id ?? null;
      }
      await query(
        `INSERT INTO audit_logs (category, action, resource, resource_id, status, user_id, ip_address, user_agent, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          CATEGORY[resource] ?? "operations",
          describe(method, segments).slice(0, 100),
          resource.slice(0, 100),
          resourceId,
          status,
          uid,
          (req.ip ?? "").slice(0, 45),
          req.headers["user-agent"] ?? null,
          JSON.stringify(details),
        ]
      );
    };
    // Never let the trail break the request it is recording.
    write().catch((err) => console.error("[audit] could not record", method, path, err.message));
  });

  next();
}
