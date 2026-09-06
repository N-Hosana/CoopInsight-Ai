import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import { uploadDocument, buildFileUrl } from "../middleware/upload";

const DOCUMENT_TYPE_MAP: Record<string, string> = {
  registration: "registration",
  financial: "financial",
  "financial report": "financial",
  minutes: "minutes",
  policy: "policy",
  bylaws: "policy",
  constitution: "policy",
  license: "registration",
  permit: "registration",
  permits: "registration",
  report: "report",
  other: "other",
};

function normalizeDocumentType(raw: string | undefined): string | null {
  if (!raw) return null;
  return DOCUMENT_TYPE_MAP[raw.trim().toLowerCase()] ?? null;
}

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── GET / ─────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sector, type, status, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    // Role-based scoping
    const restrictToOwn = ["manager", "cooperative", "member"].includes(role);

    const params: unknown[] = [
      sector || null,
      type || null,
      status || null,
      search || null,
      limitNum,
      offset,
    ];

    let scopeClause = "";
    if (restrictToOwn && userCoopId) {
      params.push(userCoopId);
      scopeClause = `AND c.id = $${params.length}`;
    }

    const dataQuery = `
      SELECT c.*,
        COUNT(DISTINCT m.id) AS member_count,
        COALESCE(json_agg(DISTINCT cl.*) FILTER (WHERE cl.id IS NOT NULL), '[]') AS leadership
      FROM cooperatives c
      LEFT JOIN members m ON m.cooperative_id = c.id AND m.deleted_at IS NULL
      LEFT JOIN cooperative_leadership cl ON cl.cooperative_id = c.id
      WHERE c.deleted_at IS NULL
        AND ($1::text IS NULL OR c.sector = $1)
        AND ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.registration_number ILIKE '%' || $4 || '%')
        ${scopeClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $5 OFFSET $6
    `;

    const countParams: unknown[] = [
      sector || null,
      type || null,
      status || null,
      search || null,
    ];
    let countScopeClause = "";
    if (restrictToOwn && userCoopId) {
      countParams.push(userCoopId);
      countScopeClause = `AND c.id = $${countParams.length}`;
    }

    const countQuery = `
      SELECT COUNT(DISTINCT c.id) AS total
      FROM cooperatives c
      WHERE c.deleted_at IS NULL
        AND ($1::text IS NULL OR c.sector = $1)
        AND ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.registration_number ILIKE '%' || $4 || '%')
        ${countScopeClause}
    `;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, params),
      query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("GET /cooperatives error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /export/all ────────────────────────────────────────────────────────
router.get("/export/all", async (req: Request, res: Response) => {
  try {
    const { sector, type, status, search, format = "csv" } = req.query;
    if (!["csv", "pdf"].includes(format as string)) {
      return res.status(400).json({ message: "Format must be csv or pdf" });
    }

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;
    const restrictToOwn = ["manager", "cooperative", "member"].includes(role);

    const params: unknown[] = [
      sector || null,
      type || null,
      status || null,
      search || null,
    ];

    let scopeClause = "";
    if (restrictToOwn && userCoopId) {
      params.push(userCoopId);
      scopeClause = `AND c.id = $${params.length}`;
    }

    const result = await query(
      `
      SELECT c.*, COUNT(m.id) AS member_count
      FROM cooperatives c
      LEFT JOIN members m ON m.cooperative_id = c.id AND m.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
        AND ($1::text IS NULL OR c.sector = $1)
        AND ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.registration_number ILIKE '%' || $4 || '%')
        ${scopeClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      `,
      params
    );

    // TODO: File generation (CSV/PDF) and streaming is deferred — return count for now
    res.json({
      success: true,
      message: `Bulk export as ${format} — file generation pending`,
      count: result.rowCount,
    });
  } catch (err) {
    console.error("GET /cooperatives/export/all error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id ───────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    // Restrict non-admin roles to their own cooperative
    if (["manager", "cooperative", "member"].includes(role) && userCoopId !== id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const result = await query(
      `
      SELECT c.*,
        COUNT(DISTINCT m.id) AS member_count,
        COALESCE(json_agg(DISTINCT cl.*) FILTER (WHERE cl.id IS NOT NULL), '[]') AS leadership
      FROM cooperatives c
      LEFT JOIN members m ON m.cooperative_id = c.id AND m.deleted_at IS NULL
      LEFT JOIN cooperative_leadership cl ON cl.cooperative_id = c.id
      WHERE c.id = $1 AND c.deleted_at IS NULL
      GROUP BY c.id
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("GET /cooperatives/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST / ─────────────────────────────────────────────────────────────────
router.post("/", authorize("admin", "generalManager", "government"), async (req: Request, res: Response) => {
  try {
    const {
      name, type, sector, cell, village,
      registration_number, registration_date,
      description, phone, email, address,
    } = req.body;

    if (!name || !type || !sector || !registration_number) {
      return res.status(400).json({ message: "name, type, sector, and registration_number are required" });
    }

    const validTypes = [
      "Agriculture", "Livestock", "Handicrafts", "Services",
      "Trading", "Dairy", "Coffee", "Tea", "Honey Production", "Poultry",
      "Transport", "Construction", "Carpentry",
    ];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid cooperative type" });
    }

    // Check duplicate registration_number
    const dupCheck = await query(
      "SELECT id FROM cooperatives WHERE registration_number = $1 AND deleted_at IS NULL",
      [registration_number]
    );
    if (dupCheck.rowCount! > 0) {
      return res.status(409).json({ message: "Registration number already exists" });
    }

    const result = await query(
      `
      INSERT INTO cooperatives
        (name, type, sector, cell, village, registration_number, registration_date,
         description, phone, email, address, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',NOW(),NOW())
      RETURNING *
      `,
      [
        name, type, sector, cell || null, village || null,
        registration_number, registration_date || null,
        description || null, phone || null, email || null, address || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Cooperative registered successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /cooperatives error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PUT /:id ────────────────────────────────────────────────────────────────
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    // manager/cooperative can only update their own coop
    if (role === "manager" || role === "cooperative") {
      if (userCoopId !== id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    } else if (!["admin", "generalManager"].includes(role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const allowedFields = [
      "name", "type", "sector", "cell", "village",
      "description", "phone", "email", "address", "status",
    ];

    const updates = req.body;
    const invalidFields = Object.keys(updates).filter((k) => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Fields not updatable: ${invalidFields.join(", ")}` });
    }

    const keys = Object.keys(updates).filter((k) => allowedFields.includes(k));
    if (keys.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    setClauses.push(`updated_at = NOW()`);
    const values = keys.map((k) => updates[k]);
    values.push(id);

    const result = await query(
      `UPDATE cooperatives SET ${setClauses.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }

    res.json({ success: true, message: "Cooperative updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("PUT /cooperatives/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete("/:id", authorize("admin", "generalManager"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE cooperatives SET status = 'inactive', deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }

    res.json({ success: true, message: "Cooperative deactivated successfully" });
  } catch (err) {
    console.error("DELETE /cooperatives/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/leadership ──────────────────────────────────────────────────────
router.get("/:id/leadership", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM cooperative_leadership WHERE cooperative_id = $1 ORDER BY created_at`,
      [id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /cooperatives/:id/leadership error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/leadership ─────────────────────────────────────────────────────
router.post("/:id/leadership", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, role, phone, email, start_date, end_date } = req.body;

    if (!name || !role) {
      return res.status(400).json({ message: "name and role are required" });
    }

    const result = await query(
      `
      INSERT INTO cooperative_leadership
        (cooperative_id, name, role, phone, email, start_date, end_date, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
      `,
      [id, name, role, phone || null, email || null, start_date || null, end_date || null]
    );

    res.status(201).json({ success: true, message: "Leadership member added", data: result.rows[0] });
  } catch (err) {
    console.error("POST /cooperatives/:id/leadership error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PUT /:id/leadership/:leadId ──────────────────────────────────────────────
router.put("/:id/leadership/:leadId", async (req: Request, res: Response) => {
  try {
    const { id, leadId } = req.params;
    const allowedFields = ["name", "role", "phone", "email", "start_date", "end_date"];
    const updates = req.body;

    const keys = Object.keys(updates).filter((k) => allowedFields.includes(k));
    if (keys.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    setClauses.push(`updated_at = NOW()`);
    const values = keys.map((k) => updates[k]);
    values.push(leadId, id);

    const result = await query(
      `UPDATE cooperative_leadership SET ${setClauses.join(", ")} WHERE id = $${values.length - 1} AND cooperative_id = $${values.length} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Leadership record not found" });
    }

    res.json({ success: true, message: "Leadership member updated", data: result.rows[0] });
  } catch (err) {
    console.error("PUT /cooperatives/:id/leadership/:leadId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE /:id/leadership/:leadId ───────────────────────────────────────────
router.delete("/:id/leadership/:leadId", async (req: Request, res: Response) => {
  try {
    const { id, leadId } = req.params;

    const result = await query(
      `DELETE FROM cooperative_leadership WHERE id = $1 AND cooperative_id = $2 RETURNING id`,
      [leadId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Leadership record not found" });
    }

    res.json({ success: true, message: "Leadership member removed" });
  } catch (err) {
    console.error("DELETE /cooperatives/:id/leadership/:leadId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/documents ───────────────────────────────────────────────────────
router.get("/:id/documents", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM cooperative_documents WHERE cooperative_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /cooperatives/:id/documents error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/documents ──────────────────────────────────────────────────────
router.post("/:id/documents", uploadDocument.single("file"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, description } = req.body;

    const normalizedType = normalizeDocumentType(type);
    if (!normalizedType) {
      return res.status(400).json({ message: "Document type is required and must be one of: registration, financial, minutes, policy, bylaws, constitution, license, permit, report, other" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "A file is required" });
    }

    const docUrl = buildFileUrl(req, "documents", req.file.filename);

    const result = await query(
      `
      INSERT INTO cooperative_documents
        (cooperative_id, name, type, description, url, size_bytes, uploaded_by, uploaded_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      RETURNING *
      `,
      [
        id,
        name || req.file.originalname,
        normalizedType,
        description || null,
        docUrl,
        req.file.size,
        req.user!.userId,
      ]
    );

    res.status(201).json({ success: true, message: "Document uploaded successfully", data: result.rows[0] });
  } catch (err) {
    console.error("POST /cooperatives/:id/documents error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── DELETE /:id/documents/:docId ─────────────────────────────────────────────
router.delete("/:id/documents/:docId", async (req: Request, res: Response) => {
  try {
    const { id, docId } = req.params;

    const result = await query(
      `DELETE FROM cooperative_documents WHERE id = $1 AND cooperative_id = $2 RETURNING id`,
      [docId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    res.json({ success: true, message: "Document deleted successfully" });
  } catch (err) {
    console.error("DELETE /cooperatives/:id/documents/:docId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/health-score ────────────────────────────────────────────────────
router.get("/:id/health-score", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM cooperative_health_scores WHERE cooperative_id = $1 ORDER BY computed_at DESC LIMIT 1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "No health score found for this cooperative" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("GET /cooperatives/:id/health-score error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/health-score/recompute ─────────────────────────────────────────
router.post("/:id/health-score/recompute", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // TODO: Call Python AI microservice to compute real health scores
    // For now, insert a placeholder score record
    const placeholderScore = {
      overall_score: 0,
      financial_health: 0,
      member_engagement: 0,
      activity_compliance: 0,
      document_completeness: 0,
      trend: "stable",
      recommendations: JSON.stringify([]),
    };

    const result = await query(
      `
      INSERT INTO cooperative_health_scores
        (cooperative_id, overall_score, financial_health, member_engagement,
         activity_compliance, document_completeness, trend, recommendations, computed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING *
      `,
      [
        id,
        placeholderScore.overall_score,
        placeholderScore.financial_health,
        placeholderScore.member_engagement,
        placeholderScore.activity_compliance,
        placeholderScore.document_completeness,
        placeholderScore.trend,
        placeholderScore.recommendations,
      ]
    );

    res.json({
      success: true,
      message: "Health score recomputed (placeholder — Python AI service integration pending)",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("POST /cooperatives/:id/health-score/recompute error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /:id/export ──────────────────────────────────────────────────────────
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { format = "pdf" } = req.query;

    if (!["pdf", "csv"].includes(format as string)) {
      return res.status(400).json({ message: "Format must be pdf or csv" });
    }

    // TODO: Fetch cooperative data → generate file → stream to client
    res.json({ success: true, message: `Export as ${format} — implementation pending`, cooperativeId: id });
  } catch (err) {
    console.error("GET /cooperatives/:id/export error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
