import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { resolveTarget, targetClause } from "../services/reportScope";
import { runAiAudit } from "../services/aiAudit";

/**
 * /api/ai-audit — audits computed from the AI service's findings, on demand.
 *
 * Same scope rule as the reports (services/reportScope.ts): a manager audits
 * their own cooperative, a sector officer any cooperative in their sector (or
 * all of them at once), district and RCA officers anything. Members do not run
 * audits.
 */
const router = Router();
router.use(authenticate);

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

async function store(result: Awaited<ReturnType<typeof runAiAudit>>, userId: string) {
  const r = await query(
    `INSERT INTO ai_audits (cooperative_id, period, score, band, findings_count, high_count, result, run_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      result.cooperativeId,
      result.period,
      result.score,
      result.band,
      result.findings.length,
      result.findings.filter((f) => f.severity === "high").length,
      JSON.stringify(result),
      userId,
    ]
  );
  return r.rows[0].id as string;
}

// POST /run — { period: "YYYY-MM", cooperativeId?, sector? }
router.post("/run", async (req: Request, res: Response) => {
  try {
    if (req.user!.role === "member") {
      return res.status(403).json({ success: false, message: "Audits are run by managers and oversight officers." });
    }
    const period = String(req.body?.period ?? "");
    if (!PERIOD.test(period)) return res.status(400).json({ success: false, message: "Choose a month to audit." });
    const now = new Date();
    if (period > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`) {
      return res.status(400).json({ success: false, message: "A month in the future cannot be audited." });
    }

    const resolved = await resolveTarget(req, { cooperativeId: req.body?.cooperativeId, sector: req.body?.sector });
    if (!resolved.ok) return res.status(resolved.status).json({ success: false, message: resolved.message });
    const { target } = resolved;

    if (target.cooperativeId) {
      const result = await runAiAudit(target.cooperativeId, period);
      if (result.score == null && result.unreachable.includes("functionality audit")) {
        return res.status(503).json({
          success: false,
          message: "The AI service is not answering, so the audit cannot be run. Check that it is running on port 8000.",
        });
      }
      const id = await store(result, req.user!.userId);
      return res.json({ success: true, mode: "single", data: { id, ...result } });
    }

    // A sector or the district: audit each cooperative in it, one at a time.
    const params: unknown[] = [];
    const coops = await query(
      `SELECT c.id FROM cooperatives c WHERE c.deleted_at IS NULL${targetClause(target, "c.id", params)} ORDER BY c.name`,
      params
    );
    const rows = [];
    for (const c of coops.rows) {
      const result = await runAiAudit(c.id, period);
      const id = result.score != null ? await store(result, req.user!.userId) : null;
      rows.push({
        id,
        cooperativeId: result.cooperativeId,
        cooperativeName: result.cooperativeName,
        sector: result.sector,
        score: result.score,
        band: result.band,
        findings: result.findings.length,
        high: result.findings.filter((f) => f.severity === "high").length,
        topFinding: result.findings[0]?.title ?? null,
        previousScore: result.sinceLastRun?.score ?? null,
      });
    }
    if (rows.length && rows.every((r) => r.score == null)) {
      return res.status(503).json({ success: false, message: "The AI service is not answering, so the audit cannot be run." });
    }
    rows.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    res.json({ success: true, mode: "many", data: { label: target.label, period, rows } });
  } catch (err) {
    console.error("POST /ai-audit/run error:", err);
    res.status(500).json({ success: false, message: "The audit could not be completed." });
  }
});

// GET /history — past runs within the caller's reach, newest first.
router.get("/history", async (req: Request, res: Response) => {
  try {
    if (req.user!.role === "member") return res.status(403).json({ success: false, message: "Access denied" });
    const resolved = await resolveTarget(req, { cooperativeId: req.query.cooperativeId, sector: req.query.sector });
    if (!resolved.ok) return res.status(resolved.status).json({ success: false, message: resolved.message });
    const params: unknown[] = [];
    const where = targetClause(resolved.target, "a.cooperative_id", params);
    const r = await query(
      `SELECT a.id, a.cooperative_id, c.name AS cooperative_name, c.sector, a.period, a.score, a.band,
              a.findings_count, a.high_count, a.run_at, u.name AS run_by_name
         FROM ai_audits a JOIN cooperatives c ON c.id = a.cooperative_id LEFT JOIN users u ON u.id = a.run_by
        WHERE TRUE${where} ORDER BY a.run_at DESC LIMIT 30`,
      params
    );
    res.json({ success: true, data: r.rows.map((x: any) => ({ ...x, score: x.score != null ? Number(x.score) : null })) });
  } catch (err) {
    console.error("GET /ai-audit/history error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /:id — one stored run, whole.
router.get("/:id", async (req: Request, res: Response) => {
  try {
    if (req.user!.role === "member") return res.status(403).json({ success: false, message: "Access denied" });
    const resolved = await resolveTarget(req, {});
    if (!resolved.ok) return res.status(resolved.status).json({ success: false, message: resolved.message });
    const params: unknown[] = [req.params.id];
    const where = targetClause(resolved.target, "a.cooperative_id", params);
    const r = await query(
      `SELECT a.id, a.result, a.run_at, u.name AS run_by_name
         FROM ai_audits a LEFT JOIN users u ON u.id = a.run_by WHERE a.id = $1${where}`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: "Audit not found" });
    res.json({ success: true, data: { id: r.rows[0].id, runByName: r.rows[0].run_by_name, ...r.rows[0].result } });
  } catch (err) {
    console.error("GET /ai-audit/:id error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
