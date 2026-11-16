import { Router, Request, Response } from "express";
import { query } from "../config/db";

/**
 * GET /api/documents/verify/:code — open to anyone, signed in or not.
 *
 * The person checking a report is usually not a user: a bank officer, an
 * auditor, a funder handed a printout. So this needs no account, and returns
 * only what is already printed on the document — title, reference, who it
 * covers, the period, who issued it and when — never its contents.
 */
const router = Router();

router.get("/verify/:code", async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
      return res.status(400).json({ success: false, valid: false, message: "That is not a verification code." });
    }
    // Accept the code with or without its hyphen, or the document reference.
    const result = await query(
      `SELECT d.reference, d.verification_code, d.kind, d.title, d.scope_label,
              TO_CHAR(d.period_from, 'YYYY-MM-DD') AS period_from, TO_CHAR(d.period_to, 'YYYY-MM-DD') AS period_to,
              d.issued_by_name, d.issued_by_role, d.issued_at, d.revoked_at, d.fingerprint,
              c.name AS cooperative_name
         FROM issued_documents d LEFT JOIN cooperatives c ON c.id = d.cooperative_id
        WHERE REPLACE(d.verification_code, '-', '') = REPLACE($1, '-', '') OR UPPER(d.reference) = $1`,
      [code]
    );
    const doc = result.rows[0];

    // Membership certificates carry their own code; the same page checks them.
    if (!doc) {
      const cert = await query(
        `SELECT certificate_number, member_name, cooperative_name,
                TO_CHAR(joined_on, 'YYYY-MM-DD') AS joined_on, TO_CHAR(left_on, 'YYYY-MM-DD') AS left_on, issued_at,
                issued_by_name, revoked_at
           FROM membership_certificates WHERE UPPER(verification_code) = $1`,
        [code]
      );
      const c = cert.rows[0];
      if (c) {
        return res.json({
          success: true,
          valid: !c.revoked_at,
          message: c.revoked_at
            ? `This certificate was revoked on ${new Date(c.revoked_at).toLocaleDateString("en-GB")}.`
            : "This membership certificate was issued through CoopInsightAI.",
          data: {
            reference: c.certificate_number,
            title: `Certificate of Membership — ${c.member_name}`,
            kind: "certificate",
            covers: c.cooperative_name,
            periodFrom: c.joined_on,
            periodTo: c.left_on,
            issuedBy: c.issued_by_name,
            issuedByRole: null,
            issuedAt: c.issued_at,
            fingerprint: null,
          },
        });
      }
    }

    if (!doc) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: "No document issued by CoopInsightAI matches that code. Treat the document as unverified.",
      });
    }
    res.json({
      success: true,
      valid: !doc.revoked_at,
      message: doc.revoked_at
        ? `This document was withdrawn on ${new Date(doc.revoked_at).toLocaleDateString("en-GB")}.`
        : "This document was issued by CoopInsightAI.",
      data: {
        reference: doc.reference,
        title: doc.title,
        kind: doc.kind,
        covers: doc.scope_label ?? doc.cooperative_name,
        periodFrom: doc.period_from,
        periodTo: doc.period_to,
        issuedBy: doc.issued_by_name,
        issuedByRole: doc.issued_by_role,
        issuedAt: doc.issued_at,
        fingerprint: doc.fingerprint,
      },
    });
  } catch (err) {
    console.error("GET /documents/verify error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
