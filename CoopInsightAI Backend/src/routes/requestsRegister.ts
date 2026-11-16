import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth";
import { resolveTarget } from "../services/reportScope";
import { listRegister, summarise } from "../services/requestsRegister";
import { buildReport, toPdfSpec, periodText, REPORT_TITLES } from "../services/reportBuilder";
import { renderPdf, pdfFileName } from "../services/pdf";
import { registerDocument, roleTitle, verifyUrl } from "../services/documentRegistry";

/**
 * The register of everything asked of the agency — formation, dissolution,
 * certificate changes, issues, members leaving, audits, external support —
 * with who asked and where each one now sits. Same scope rule as the reports:
 * a member sees their own, a manager their cooperative's, a sector officer
 * their sector's, district and RCA officers anything they choose.
 */
const router = Router();
router.use(authenticate);

const iso = (d: Date) => d.toISOString().slice(0, 10);

function period(req: Request) {
  const to = typeof req.query.to === "string" && req.query.to ? req.query.to : iso(new Date());
  const from =
    typeof req.query.from === "string" && req.query.from
      ? req.query.from
      : iso(new Date(new Date(to).getFullYear(), 0, 1));
  return { from, to };
}

// GET / — the rows, a summary, and the scope they were drawn from.
router.get("/", async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTarget(req, { cooperativeId: req.query.cooperativeId, sector: req.query.sector });
    if (!resolved.ok) return res.status(resolved.status).json({ success: false, message: resolved.message });
    const { from, to } = period(req);
    if (from > to) return res.status(400).json({ success: false, message: "The period must start before it ends." });

    const rows = await listRegister(resolved.viewer, resolved.target, {
      from,
      to,
      group: typeof req.query.group === "string" ? req.query.group : null,
      state: typeof req.query.state === "string" ? req.query.state : null,
    });
    res.json({
      success: true,
      data: rows,
      summary: summarise(rows),
      scope: { label: resolved.target.label, from, to },
    });
  } catch (err) {
    console.error("GET /requests-register error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /pdf — the same register as a registered, verifiable document.
router.get("/pdf", async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTarget(req, { cooperativeId: req.query.cooperativeId, sector: req.query.sector });
    if (!resolved.ok) return res.status(resolved.status).json({ success: false, message: resolved.message });
    const { from, to } = period(req);
    const { viewer, target } = resolved;

    const content = await buildReport({
      type: "requests_register",
      title: REPORT_TITLES.requests_register,
      cooperativeId: target.cooperativeId,
      sector: target.sector,
      from,
      to,
      preparedBy: viewer.name,
      preparedByRole: roleTitle(viewer.role, viewer.level),
      viewer,
      target,
    });
    const issued = await registerDocument({
      kind: "register",
      title: content.title,
      content,
      cooperativeId: target.cooperativeId,
      scopeLabel: target.label,
      periodFrom: from,
      periodTo: to,
      issuedBy: viewer.userId,
      issuedByName: viewer.name,
      issuedByRole: roleTitle(viewer.role, viewer.level),
      issuedAt: content.generatedAt,
    });

    const pdf = await renderPdf(
      toPdfSpec(content, {
        reference: issued.reference,
        verificationCode: issued.verificationCode,
        issuedAt: issued.issuedAt,
        issuedBy: issued.issuedByName,
        issuedByRole: issued.issuedByRole,
        scopeLabel: issued.scopeLabel,
        period: periodText(content),
        fingerprint: issued.fingerprint,
        verifyUrl: verifyUrl(issued.verificationCode),
      })
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdfFileName("requests-register", to)}"`);
    res.send(pdf);
  } catch (err) {
    console.error("GET /requests-register/pdf error:", err);
    res.status(500).json({ success: false, message: "The register could not be produced." });
  }
});

export default router;
