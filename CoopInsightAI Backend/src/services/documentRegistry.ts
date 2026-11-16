import crypto from "crypto";
import { query } from "../config/db";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES A PRINTED DOCUMENT CHECKABLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A PDF on its own proves nothing: anyone can retype a figure. So every
 * document the system issues is entered in `issued_documents` with
 *
 *   reference          CI-2026-RPT-7KQ2M9 — quoted in letters and filing
 *   verification code  printed on every page; typed into /verify by whoever
 *                      is shown the document, it returns who issued it, when,
 *                      for which cooperative and period
 *   fingerprint        SHA-256 of the content as issued, so the record of what
 *                      the document said cannot be changed after the fact
 *
 * A stored report keeps one entry for life, however often it is downloaded —
 * the reference on the second copy matches the first.
 */

export interface IssuedDocument {
  reference: string;
  verificationCode: string;
  fingerprint: string;
  issuedAt: string;
  issuedByName: string | null;
  issuedByRole: string | null;
  scopeLabel: string | null;
}

/** No 0/O, 1/I/L: a code read off paper has to be typed back correctly. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const randomCode = (length: number) =>
  Array.from(crypto.randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join("");

const KIND_TAG: Record<string, string> = { report: "RPT", export: "DOC", register: "REG" };

export const fingerprintOf = (content: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(content ?? null)).digest("hex");

/** The job title to print, not the raw role: all three oversight tiers are `government`. */
export function roleTitle(role: string | null | undefined, oversightLevel?: string | null): string {
  if (role === "government") {
    return oversightLevel === "sector" ? "Sector Cooperative Officer"
      : oversightLevel === "district" ? "District Cooperative Officer"
      : "RCA Officer";
  }
  return ({
    admin: "System Administrator",
    generalManager: "Gasabo General Manager",
    manager: "Cooperative Manager",
    cooperative: "Cooperative",
    member: "Cooperative Member",
  } as Record<string, string>)[role ?? ""] ?? (role ?? "User");
}

const fromRow = (r: any): IssuedDocument => ({
  reference: r.reference,
  verificationCode: r.verification_code,
  fingerprint: r.fingerprint,
  issuedAt: new Date(r.issued_at).toISOString(),
  issuedByName: r.issued_by_name,
  issuedByRole: r.issued_by_role,
  scopeLabel: r.scope_label,
});

export async function registerDocument(input: {
  kind: "report" | "export" | "register";
  title: string;
  content: unknown;
  reportId?: string | null;
  cooperativeId?: string | null;
  scopeLabel?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  issuedBy?: string | null;
  issuedByName?: string | null;
  issuedByRole?: string | null;
  issuedAt?: string | null;
}): Promise<IssuedDocument> {
  // One entry per stored report, however many times it is printed.
  if (input.reportId) {
    const existing = await query(`SELECT * FROM issued_documents WHERE report_id = $1`, [input.reportId]);
    if (existing.rows[0]) return fromRow(existing.rows[0]);
  }

  const year = new Date(input.issuedAt ?? Date.now()).getFullYear();
  // A clash on a random 6+10 character code is vanishingly unlikely; retry anyway.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await query(
        `INSERT INTO issued_documents
           (reference, verification_code, kind, title, report_id, cooperative_id, scope_label,
            period_from, period_to, issued_by, issued_by_name, issued_by_role, fingerprint, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14::timestamptz, NOW()))
         RETURNING *`,
        [
          `CI-${year}-${KIND_TAG[input.kind]}-${randomCode(6)}`,
          `${randomCode(4)}-${randomCode(4)}`,
          input.kind,
          input.title.slice(0, 300),
          input.reportId ?? null,
          input.cooperativeId ?? null,
          input.scopeLabel ?? null,
          input.periodFrom ?? null,
          input.periodTo ?? null,
          input.issuedBy ?? null,
          input.issuedByName ?? null,
          input.issuedByRole ?? null,
          fingerprintOf(input.content),
          input.issuedAt ?? null,
        ]
      );
      return fromRow(res.rows[0]);
    } catch (err: any) {
      if (err?.code !== "23505" || attempt === 3) throw err; // 23505 = unique violation
    }
  }
  throw new Error("Could not register the document.");
}

/** Where a holder checks a document. Printed on every page. */
export const verifyUrl = (code?: string) => {
  const base = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
  return code ? `${base}/verify/${code}` : `${base}/verify`;
};
