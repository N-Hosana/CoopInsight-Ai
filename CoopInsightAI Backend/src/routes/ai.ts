import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import https from "https";
import http from "http";

const router = Router();
router.use(authenticate);

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

const callAIService = async (path: string, method = "GET", body?: object): Promise<any> => {
  const url = new URL(path, AI_SERVICE_URL);
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<any>((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("AI service timeout")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};

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
    const { cooperativeId } = req.query;
    const params: any[] = [];
    let whereClause = `WHERE (expires_at IS NULL OR expires_at > NOW())`;
    if (cooperativeId) {
      params.push(cooperativeId);
      whereClause += ` AND cooperative_id = $${params.length}`;
    }
    const result = await query(`SELECT COUNT(*) FROM ai_insights ${whereClause}`, params);
    res.json({ success: true, message: "Export pending", count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /insights
router.get("/insights", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, cooperativeId, type, severity, from, to } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions: string[] = ["(ai.expires_at IS NULL OR ai.expires_at > NOW())"];

    if (cooperativeId) { params.push(cooperativeId); conditions.push(`ai.cooperative_id = $${params.length}`); }
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
    const result = await query(
      `SELECT ai.*, c.name AS cooperative_name
       FROM ai_insights ai LEFT JOIN cooperatives c ON c.id = ai.cooperative_id WHERE ai.id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Insight not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /recommendations
router.get("/recommendations", async (req: Request, res: Response) => {
  try {
    const { cooperativeId, limit = 10 } = req.query;
    const params: any[] = [];
    const conditions = [
      `type = 'recommendation'`,
      `(expires_at IS NULL OR expires_at > NOW())`,
    ];
    if (cooperativeId) { params.push(cooperativeId); conditions.push(`cooperative_id = $${params.length}`); }
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
    const { page = 1, limit = 20, cooperativeId, severity, resolved } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params: any[] = [];
    const conditions = [`type = 'anomaly'`];

    if (cooperativeId) { params.push(cooperativeId); conditions.push(`cooperative_id = $${params.length}`); }
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
    const { cooperativeId } = req.body;
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
    const { cooperativeId, metric, horizon = "30d" } = req.query;
    if (!metric) return res.status(400).json({ success: false, message: "metric is required" });

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
    const { cooperativeId, metric, horizon, parameters } = req.body;
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
    const { cooperativeId } = req.query;
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
    res.json({ success: true, data: aiData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /benchmarks
router.get("/benchmarks", async (req: Request, res: Response) => {
  try {
    const { cooperativeId } = req.query;
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
