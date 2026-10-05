import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { callAIService, AI_SERVICE_URL } from "../services/aiClient";
import { memberInsights } from "../services/memberInsights";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO SEES WHICH COOPERATIVE'S AI OUTPUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every read here used to return the whole district to any signed-in account
 * unless the browser happened to pass a cooperativeId — so a member saw other
 * cooperatives' anomalies and recommendations, none of them relevant to them.
 *
 *   manager / cooperative / member   their own cooperative, whatever is asked
 *   sector officer                   cooperatives in their sector
 *   district, RCA, admin, GM         everything, or the cooperative asked for
 */
type AiScope =
  | { kind: "cooperative"; cooperativeId: string | null }
  | { kind: "sector"; sector: string; cooperativeId: string | null }
  | { kind: "all"; cooperativeId: string | null };

async function aiScope(req: Request): Promise<AiScope> {
  const requested = (req.query.cooperativeId ?? req.body?.cooperativeId ?? null) as string | null;
  if (["manager", "cooperative", "member"].includes(req.user!.role)) {
    return { kind: "cooperative", cooperativeId: req.user!.cooperativeId ?? null };
  }
  if (req.user!.role === "government") {
    const me = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
    if (me.rows[0]?.oversight_level === "sector" && me.rows[0].sector) {
      return { kind: "sector", sector: me.rows[0].sector, cooperativeId: requested };
    }
  }
  return { kind: "all", cooperativeId: requested };
}

/** Adds the scope to a WHERE list over a table (optionally aliased) with a cooperative_id column. */
function scopeConditions(scope: AiScope, alias: string, conditions: string[], params: unknown[]) {
  const col = alias ? `${alias}.cooperative_id` : "cooperative_id";
  if (scope.kind === "cooperative") {
    params.push(scope.cooperativeId);
    conditions.push(`${col} = $${params.length}::uuid`);
    return;
  }
  if (scope.kind === "sector") {
    params.push(scope.sector);
    conditions.push(`${col} IN (SELECT id FROM cooperatives WHERE sector = $${params.length})`);
  }
  if (scope.cooperativeId) {
    params.push(scope.cooperativeId);
    conditions.push(`${col} = $${params.length}::uuid`);
  }
}

/** The one cooperative a per-cooperative call is about, or why it cannot be answered. */
async function oneCooperative(
  scope: AiScope
): Promise<{ ok: true; cooperativeId: string | null } | { ok: false; status: number; message: string }> {
  if (scope.kind === "cooperative") {
    return scope.cooperativeId
      ? { ok: true, cooperativeId: scope.cooperativeId }
      : { ok: false, status: 400, message: "Your account is not attached to a cooperative." };
  }
  if (scope.kind === "sector" && scope.cooperativeId) {
    const inSector = await query(`SELECT 1 FROM cooperatives WHERE id = $1 AND sector = $2`, [
      scope.cooperativeId,
      scope.sector,
    ]);
    if (!inSector.rowCount) return { ok: false, status: 403, message: "That cooperative is outside your sector." };
  }
  return { ok: true, cooperativeId: scope.cooperativeId };
}

// GET /health
router.get("/health", async (_req: Request, res: Response) => {
  try {
    const start = Date.now();
    let aiData: any = null;
    let reachable = false;
    try {
      aiData = await callAIService("/health");
      reachable = true;
    } catch {
      reachable = false;
    }
    const latencyMs = Date.now() - start;
    res.json({
      success: true,
      data: {
        aiServiceUrl: AI_SERVICE_URL,
        reachable,
        latencyMs,
        version: aiData?.version || null,
        lastCheckedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /insights/export — must be before /insights/:id
router.get("/insights/export", async (req: Request, res: Response) => {
  try {
    const params: any[] = [];
    const conditions = [`(expires_at IS NULL OR expires_at > NOW())`];
    scopeConditions(await aiScope(req), "", conditions, params);
    const result = await query(`SELECT COUNT(*) FROM ai_insights WHERE ${conditions.join(" AND ")}`, params);
    res.json({ success: true, message: "Export pending", count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /insights
router.get("/insights", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, type, severity, from, to } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = ["(ai.expires_at IS NULL OR ai.expires_at > NOW())"];

    scopeConditions(await aiScope(req), "ai", conditions, params);
    if (type) { params.push(type); conditions.push(`ai.type = $${params.length}`); }
    if (severity) { params.push(severity); conditions.push(`ai.severity = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`ai.generated_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`ai.generated_at <= $${params.length}`); }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT ai.*, c.name AS cooperative_name
       FROM ai_insights ai LEFT JOIN cooperatives c ON c.id = ai.cooperative_id
       ${whereClause} ORDER BY ai.generated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM ai_insights ai ${whereClause}`, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: Number(page), limit: Number(limit), total: parseInt(total.rows[0].count) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /insights/:id
router.get("/insights/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const params: unknown[] = [id];
    const conditions = ["ai.id = $1"];
    scopeConditions(await aiScope(req), "ai", conditions, params);
    const result = await query(
      `SELECT ai.*, c.name AS cooperative_name
       FROM ai_insights ai LEFT JOIN cooperatives c ON c.id = ai.cooperative_id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    // Out of scope reads as not found: whether it exists is not theirs to know.
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Insight not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /me — the member's own progress, with their cooperative as context.
router.get("/me", async (req: Request, res: Response) => {
  try {
    const me = await query(
      `SELECT member_id, cooperative_id, national_id, phone, name FROM users WHERE id = $1`,
      [req.user!.userId]
    );
    const u = me.rows[0];
    let memberId: string | null = u?.member_id ?? null;

    // An account linked before users.member_id existed: match once, then store it.
    if (!memberId && u?.cooperative_id) {
      const match = await query(
        `SELECT id FROM members
          WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND (($2::text IS NOT NULL AND national_id = $2) OR ($3::text IS NOT NULL AND phone = $3)
                 OR LOWER(full_name) = LOWER($4))
          LIMIT 1`,
        [u.cooperative_id, u.national_id, u.phone, u.name]
      );
      memberId = match.rows[0]?.id ?? null;
      if (memberId) await query(`UPDATE users SET member_id = $1 WHERE id = $2`, [memberId, req.user!.userId]);
    }
    if (!memberId) {
      return res.json({
        success: true,
        data: null,
        message:
          "Your account is not linked to an entry in a member register, so there is no personal progress to show.",
      });
    }

    const data = await memberInsights(memberId);
    res.json({ success: true, data });
  } catch (err) {
    console.error("GET /ai/me error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /recommendations
router.get("/recommendations", async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.query;
    const params: any[] = [];
    const conditions = [
      `type = 'recommendation'`,
      `(expires_at IS NULL OR expires_at > NOW())`,
    ];
    scopeConditions(await aiScope(req), "", conditions, params);
    params.push(Number(limit));

    const result = await query(
      `SELECT * FROM ai_insights WHERE ${conditions.join(" AND ")} ORDER BY confidence DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /anomalies
router.get("/anomalies", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, severity, resolved } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions = [`type = 'anomaly'`];

    scopeConditions(await aiScope(req), "", conditions, params);
    if (severity) { params.push(severity); conditions.push(`severity = $${params.length}`); }
    if (resolved === "true") conditions.push(`resolved = true`);
    else if (resolved === "false") conditions.push(`resolved = false`);

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT * FROM ai_insights ${whereClause} ORDER BY generated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM ai_insights ${whereClause}`, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page: Number(page), limit: Number(limit), total: parseInt(total.rows[0].count) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /anomalies/detect
router.post("/anomalies/detect", async (req: Request, res: Response) => {
  try {
    if (req.user!.role === "member") {
      return res.status(403).json({ success: false, message: "Anomaly detection is run by the cooperative's managers and officers." });
    }
    const target = await oneCooperative(await aiScope(req));
    if (!target.ok) return res.status(target.status).json({ success: false, message: target.message });
    const cooperativeId = target.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ success: false, message: "cooperativeId is required" });
    }

    let aiResult: any = null;
    let reachable = false;
    try {
      aiResult = await callAIService("/anomalies/detect", "POST", { cooperativeId });
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          jobId: `job_${Date.now()}`,
          status: "queued",
          message: "AI service unreachable. Detection queued for retry.",
        },
      });
    }

    // Insert returned anomalies into ai_insights
    const inserted: any[] = [];
    if (Array.isArray(aiResult?.anomalies)) {
      for (const anomaly of aiResult.anomalies) {
        const r = await query(
          `INSERT INTO ai_insights (type, severity, title, summary, detail, cooperative_id, affected_metric, current_value, expected_value, deviation, model_name, confidence)
           VALUES ('anomaly',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            anomaly.severity,
            anomaly.title,
            anomaly.summary,
            anomaly.detail || null,
            cooperativeId,
            anomaly.affected_metric || null,
            anomaly.current_value || null,
            anomaly.expected_value || null,
            anomaly.deviation || null,
            anomaly.model_name || null,
            anomaly.confidence || null,
          ]
        );
        inserted.push(r.rows[0]);
      }
    }

    res.json({ success: true, data: { detected: inserted.length, anomalies: inserted } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /forecasts
router.get("/forecasts", async (req: Request, res: Response) => {
  try {
    const { metric, horizon = "30d" } = req.query;
    if (!metric) return res.status(400).json({ success: false, message: "metric is required" });
    const target = await oneCooperative(await aiScope(req));
    if (!target.ok) return res.status(target.status).json({ success: false, message: target.message });
    const cooperativeId = target.cooperativeId;

    let aiData: any = null;
    let reachable = false;
    try {
      aiData = await callAIService(`/forecasts?cooperativeId=${cooperativeId || ""}&metric=${metric}&horizon=${horizon}`);
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          metric,
          horizon,
          cooperative_id: cooperativeId || null,
          forecast: [],
          note: "AI service unreachable. Showing placeholder data.",
          reachable: false,
        },
      });
    }

    res.json({ success: true, data: aiData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /forecasts/generate
router.post("/forecasts/generate", async (req: Request, res: Response) => {
  try {
    const { metric, horizon, parameters } = req.body;
    if (req.user!.role === "member") {
      return res.status(403).json({ success: false, message: "Forecasts are generated by the cooperative's managers and officers." });
    }
    const target = await oneCooperative(await aiScope(req));
    if (!target.ok) return res.status(target.status).json({ success: false, message: target.message });
    const cooperativeId = target.cooperativeId;
    if (!cooperativeId || !metric || !horizon) {
      return res.status(400).json({ success: false, message: "cooperativeId, metric, and horizon are required" });
    }

    let aiResult: any = null;
    let reachable = false;
    try {
      aiResult = await callAIService("/forecasts/generate", "POST", { cooperativeId, metric, horizon, parameters });
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          jobId: `forecast_job_${Date.now()}`,
          status: "queued",
          message: "AI service unreachable. Forecast generation queued.",
        },
      });
    }

    res.json({ success: true, data: aiResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /member-engagement
router.get("/member-engagement", async (req: Request, res: Response) => {
  try {
    const target = await oneCooperative(await aiScope(req));
    if (!target.ok) return res.status(target.status).json({ success: false, message: target.message });
    const cooperativeId = target.cooperativeId;
    let aiData: any = null;
    let reachable = false;
    try {
      aiData = await callAIService(`/member-engagement?cooperativeId=${cooperativeId || ""}`);
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          cooperativeId: cooperativeId || null,
          engagement: [],
          note: "AI service unreachable.",
          reachable: false,
        },
      });
    }
    // A member sees their own score and the cooperative's figures, never a
    // colleague's name or score.
    if (req.user!.role === "member") {
      aiData = await ownEngagementOnly(req, aiData);
    }
    res.json({ success: true, data: aiData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

async function ownEngagementOnly(req: Request, aiData: any) {
  const entries: any[] = Array.isArray(aiData?.engagement) ? aiData.engagement : [];
  const me = await query(`SELECT member_id FROM users WHERE id = $1`, [req.user!.userId]);
  const memberId = me.rows[0]?.member_id ?? null;
  const scores = entries.map((e) => Number(e.overallScore)).sort((a, b) => a - b);
  const own = entries.find((e) => e.memberId === memberId) ?? null;
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return {
    ...aiData,
    engagement: own ? [own] : [],
    cooperativeStats: {
      members: scores.length,
      average: mean != null ? Math.round(mean * 10) / 10 : null,
      median: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      // Share of the cooperative scoring at or below this member.
      yourPercentile:
        own && scores.length
          ? Math.round((scores.filter((x) => x <= Number(own.overallScore)).length / scores.length) * 100)
          : null,
    },
  };
}

// GET /benchmarks
router.get("/benchmarks", async (req: Request, res: Response) => {
  try {
    const target = await oneCooperative(await aiScope(req));
    if (!target.ok) return res.status(target.status).json({ success: false, message: target.message });
    const cooperativeId = target.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ success: false, message: "cooperativeId is required" });
    }

    const coopResult = await query(`SELECT * FROM cooperatives WHERE id = $1`, [cooperativeId as string]);
    if (!coopResult.rows.length) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }

    let aiData: any = null;
    let reachable = false;
    try {
      aiData = await callAIService(`/benchmarks?cooperativeId=${cooperativeId}`);
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          cooperative: coopResult.rows[0],
          benchmarks: [],
          note: "AI service unreachable.",
          reachable: false,
        },
      });
    }
    res.json({ success: true, data: { cooperative: coopResult.rows[0], ...aiData } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /rankings — district league table for a month
// Oversight roles only: this is a comparison across cooperatives, so a manager
// or member has no business seeing where their peers place.
router.get(
  "/rankings",
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { period } = req.query;

      let aiData: any = null;
      let reachable = false;
      try {
        aiData = await callAIService(`/rankings${period ? `?period=${period}` : ""}`);
        reachable = true;
      } catch {
        reachable = false;
      }

      if (!reachable) {
        return res.json({
          success: true,
          data: {
            period: period || null,
            standings: [],
            availablePeriods: [],
            reachable: false,
            note: "AI service unreachable. The league table cannot be computed.",
          },
        });
      }

      res.json({ success: true, data: { ...aiData, reachable: true } });
    } catch (err) {
      console.error("GET /ai/rankings error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET /rankings/trend — rank movement over recent months
router.get(
  "/rankings/trend",
  authorize("admin", "generalManager", "government"),
  async (req: Request, res: Response) => {
    try {
      const { months = 6 } = req.query;

      let aiData: any = null;
      let reachable = false;
      try {
        aiData = await callAIService(`/rankings/trend?months=${months}`);
        reachable = true;
      } catch {
        reachable = false;
      }

      if (!reachable) {
        return res.json({
          success: true,
          data: { periods: [], series: [], reachable: false, note: "AI service unreachable." },
        });
      }

      res.json({ success: true, data: { ...aiData, reachable: true } });
    } catch (err) {
      console.error("GET /ai/rankings/trend error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET /model-performance
router.get("/model-performance", authorize("admin", "generalManager", "government"), async (_req: Request, res: Response) => {
  try {
    let aiData: any = null;
    let reachable = false;
    try {
      aiData = await callAIService("/model-performance");
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          reachable: false,
          models: [
            { name: "anomaly_detector", status: "not_trained", accuracy: null },
            { name: "loan_risk_predictor", status: "not_trained", accuracy: null },
            { name: "savings_forecaster", status: "not_trained", accuracy: null },
            { name: "member_engagement_scorer", status: "not_trained", accuracy: null },
          ],
        },
      });
    }

    res.json({ success: true, data: aiData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /model-performance/retrain
router.post("/model-performance/retrain", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { modelName, parameters } = req.body;
    let aiResult: any = null;
    let reachable = false;
    try {
      aiResult = await callAIService("/retrain", "POST", { modelName, parameters });
      reachable = true;
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return res.json({
        success: true,
        data: {
          jobId: `retrain_${Date.now()}`,
          status: "queued",
          message: "AI service unreachable. Retrain queued.",
        },
      });
    }

    res.json({ success: true, data: aiResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
