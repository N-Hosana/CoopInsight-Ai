import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { renderPdf, pdfFileName, PdfDocumentSpec } from "../services/pdf";
import { registerDocument, roleTitle, verifyUrl } from "../services/documentRegistry";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ANY SCREEN, AS A PDF
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Besides formal reports, most pages let the user take what they are looking
 * at away with them — a member's record, the AI's findings, the league table, a
 * balance sheet. Each page used to assemble a .txt or .csv in the browser. They
 * now describe the document (title, figures, tables) and post it here, and it
 * comes back as a PDF in the same house style as the reports.
 *
 * The page supplies the content it is already showing, so this exposes nothing
 * the caller could not see. The server adds what makes it a document: the
 * letterhead of the caller's cooperative (or the cooperative named, if the
 * caller may read it), who produced it, and when.
 */

const MAX_SECTIONS = 60;
const MAX_ROWS = 5000;

async function letterheadFor(cooperativeId: string | null) {
  if (!cooperativeId) return null;
  const res = await query(
    `SELECT name, registration_number, type, cell, sector, district, phone, email
       FROM cooperatives WHERE id = $1`,
    [cooperativeId]
  );
  const c = res.rows[0];
  if (!c) return null;
  return {
    name: c.name as string,
    lines: [
      [c.registration_number ? `Registration no. ${c.registration_number}` : null, c.type ? `${c.type} cooperative` : null]
        .filter(Boolean)
        .join("  ·  "),
      [c.cell ? `${c.cell} cell` : null, c.sector ? `${c.sector} sector` : null, c.district ? `${c.district} District` : null]
        .filter(Boolean)
        .join(", "),
      [c.phone ? `Tel. ${c.phone}` : null, c.email].filter(Boolean).join("  ·  "),
    ].filter((l) => l.length > 0),
  };
}

// POST /pdf — render a described document.
router.post("/pdf", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<PdfDocumentSpec> & { cooperativeId?: string | null };
    if (!body.title || typeof body.title !== "string") {
      return res.status(400).json({ success: false, message: "A document title is required." });
    }
    const sections = Array.isArray(body.sections) ? body.sections.slice(0, MAX_SECTIONS) : [];
    const rowTotal = sections.reduce((a, s) => a + (Array.isArray(s.rows) ? s.rows.length : 0), 0);
    if (rowTotal > MAX_ROWS) {
      return res.status(413).json({
        success: false,
        message: `That document has ${rowTotal} rows; narrow the filters to ${MAX_ROWS} or fewer and export again.`,
      });
    }

    // Whose letterhead: the caller's own cooperative, or — for someone who
    // supervises several — the one the document is about.
    const role = req.user!.role;
    const own = ["manager", "cooperative", "member"].includes(role);
    const organisation =
      (await letterheadFor(own ? req.user!.cooperativeId ?? null : body.cooperativeId ?? null)) ??
      (own ? null : { name: "Gasabo District — Cooperative Oversight", lines: [] });

    const title = body.title.slice(0, 160);
    const subtitle = body.subtitle ? String(body.subtitle).slice(0, 200) : null;
    const narrative = Array.isArray(body.narrative) ? body.narrative.slice(0, 12).map(String) : [];
    const summary = Array.isArray(body.summary) ? body.summary.slice(0, 12) : [];
    const signatories = Array.isArray(body.signatories) ? body.signatories.slice(0, 4).map(String) : [];

    // Every exported page is entered in the document register like a report,
    // so it carries a reference and a code that can be checked.
    const me = await query(`SELECT oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
    const issuedByRole = roleTitle(role, me.rows[0]?.oversight_level ?? null);
    const issued = await registerDocument({
      kind: "export",
      title,
      content: { title, subtitle, narrative, summary, sections },
      cooperativeId: own ? req.user!.cooperativeId ?? null : body.cooperativeId ?? null,
      scopeLabel: organisation?.name ?? null,
      issuedBy: req.user!.userId,
      issuedByName: req.user!.name ?? null,
      issuedByRole,
    });

    const spec: PdfDocumentSpec = {
      title,
      subtitle,
      organisation,
      document: {
        reference: issued.reference,
        verificationCode: issued.verificationCode,
        issuedAt: issued.issuedAt,
        issuedBy: issued.issuedByName,
        issuedByRole,
        scopeLabel: issued.scopeLabel,
        period: subtitle,
        fingerprint: issued.fingerprint,
        verifyUrl: verifyUrl(issued.verificationCode),
      },
      narrative,
      summary,
      sections,
      signatories,
      footer: title.slice(0, 80),
    };

    const pdf = await renderPdf(spec);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${pdfFileName(spec.title, new Date().toISOString().slice(0, 10))}"`
    );
    res.send(pdf);
  } catch (err) {
    console.error("POST /exports/pdf error:", err);
    res.status(500).json({ success: false, message: "The document could not be produced." });
  }
});

export default router;
