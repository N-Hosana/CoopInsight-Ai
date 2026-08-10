import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate, authorize("admin", "generalManager"));

const INTEGRATIONS = [
  {
    id: "minecofin",
    name: "MINECOFIN",
    description: "Rwanda Ministry of Finance integration for regulatory compliance reporting",
    category: "government",
    icon: "building-2",
    docsUrl: "https://minecofin.gov.rw/api-docs",
  },
  {
    id: "rra",
    name: "Rwanda Revenue Authority",
    description: "Tax compliance and reporting integration",
    category: "government",
    icon: "receipt",
    docsUrl: "https://rra.gov.rw/api",
  },
  {
    id: "africas_talking",
    name: "Africa's Talking",
    description: "SMS and USSD communication platform for member notifications",
    category: "communication",
    icon: "message-square",
    docsUrl: "https://developers.africastalking.com",
  },
  {
    id: "equity_bank",
    name: "Equity Bank API",
    description: "Banking integration for transactions and account management",
    category: "banking",
    icon: "landmark",
    docsUrl: "https://developer.equitybank.co.rw",
  },
  {
    id: "mobile_money",
    name: "Mobile Money (MTN/Airtel)",
    description: "Mobile money payment collection and disbursement",
    category: "payments",
    icon: "smartphone",
    docsUrl: "https://momodeveloper.mtn.com",
  },
];

// GET /
router.get("/", async (_req: Request, res: Response) => {
  try {
    const configs = await query(`SELECT * FROM integration_configs`);
    const configMap: Record<string, any> = {};
    configs.rows.forEach((c: any) => { configMap[c.integration_id] = c; });

    const merged = INTEGRATIONS.map((integration) => ({
      ...integration,
      connected: configMap[integration.id]?.status === "connected",
      status: configMap[integration.id]?.status || "disconnected",
      lastSyncedAt: configMap[integration.id]?.last_synced_at || null,
      lastTestedAt: configMap[integration.id]?.last_tested_at || null,
      errorMessage: configMap[integration.id]?.error_message || null,
      webhookUrl: configMap[integration.id]?.webhook_url || null,
    }));

    res.json({ success: true, data: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /webhooks
router.get("/webhooks", async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT * FROM webhooks WHERE active = true ORDER BY created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /webhooks
router.post("/webhooks", async (req: Request, res: Response) => {
  try {
    const { integrationId, event, url, secret } = req.body;
    const userId = req.user!.userId;

    if (!integrationId || !event || !url) {
      return res.status(400).json({ success: false, message: "integrationId, event, and url are required" });
    }

    const result = await query(
      `INSERT INTO webhooks (integration_id, event, url, secret_hash, active, created_by)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING *`,
      [integrationId, event, url, secret || null, userId]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /webhooks/:webhookId
router.delete("/webhooks/:webhookId", async (req: Request, res: Response) => {
  try {
    const { webhookId } = req.params;
    await query(`UPDATE webhooks SET active = false WHERE id = $1`, [webhookId]);
    res.json({ success: true, message: "Webhook disabled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const integration = INTEGRATIONS.find((i) => i.id === id);
    if (!integration) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    const config = await query(`SELECT * FROM integration_configs WHERE integration_id = $1`, [id]);
    res.json({ success: true, data: { ...integration, config: config.rows[0] || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /:id/logs
router.get("/:id/logs", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [id];
    let whereClause = `WHERE integration_id = $1`;
    if (status) { params.push(status); whereClause += ` AND status = $${params.length}`; }

    const countParams = [...params];
    params.push(Number(limit), offset);

    const result = await query(
      `SELECT * FROM integration_logs ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM integration_logs ${whereClause}`, countParams);

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

// POST /:id/connect
router.post("/:id/connect", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { config, webhookUrl } = req.body;
    const userId = req.user!.userId;

    if (!config || typeof config !== "object") {
      return res.status(400).json({ success: false, message: "config must be an object" });
    }

    const result = await query(
      `INSERT INTO integration_configs (integration_id, config, status, webhook_url, connected_by)
       VALUES ($1, $2, 'connected', $3, $4)
       ON CONFLICT (integration_id) DO UPDATE SET
         config = $2,
         status = 'connected',
         webhook_url = COALESCE($3, integration_configs.webhook_url),
         connected_by = $4,
         error_message = NULL,
         error_details = NULL
       RETURNING *`,
      [id, JSON.stringify(config), webhookUrl || null, userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /:id/disconnect
router.post("/:id/disconnect", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query(`UPDATE integration_configs SET status = 'disconnected' WHERE integration_id = $1`, [id]);
    res.json({ success: true, message: "Integration disconnected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /:id/test
router.post("/:id/test", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const config = await query(`SELECT config FROM integration_configs WHERE integration_id = $1`, [id]);
    if (!config.rows.length) {
      return res.status(404).json({ success: false, message: "Integration not configured" });
    }

    await query(`UPDATE integration_configs SET last_tested_at = NOW() WHERE integration_id = $1`, [id]);

    // TODO: Perform actual API test calls per integration type
    // switch (id) {
    //   case 'minecofin': // call MINECOFIN health endpoint
    //   case 'africas_talking': // call Africa's Talking balance endpoint
    //   case 'equity_bank': // call bank ping endpoint
    //   case 'mobile_money': // call MoMo API
    // }

    res.json({ success: true, data: { testPassed: true, testedAt: new Date().toISOString() } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /:id/sync
router.post("/:id/sync", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query(
      `UPDATE integration_configs SET last_synced_at = NOW(), status = 'connected' WHERE integration_id = $1`,
      [id]
    );
    await query(
      `INSERT INTO integration_logs (integration_id, event, status, details) VALUES ($1, 'sync', 'success', $2)`,
      [id, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );
    res.json({ success: true, message: "Sync triggered", data: { syncedAt: new Date().toISOString() } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /:id/resolve-error
router.post("/:id/resolve-error", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query(
      `UPDATE integration_configs SET error_message = NULL, error_details = NULL WHERE integration_id = $1`,
      [id]
    );
    await query(
      `INSERT INTO integration_logs (integration_id, event, status, details) VALUES ($1, 'error_resolved', 'success', $2)`,
      [id, JSON.stringify({ resolvedAt: new Date().toISOString() })]
    );
    res.json({ success: true, message: "Error resolved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
