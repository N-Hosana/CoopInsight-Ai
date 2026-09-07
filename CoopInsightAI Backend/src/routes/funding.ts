import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import {
  MATCH_WEIGHTS,
  MATCH_THRESHOLD,
  SUPPORT_TYPES,
  ORGANIZATION_TYPES,
  COOPERATIVE_BANDS,
  rankMatches,
  CooperativeBand,
  MatchInput,
} from "../services/funding";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EXTERNAL SUPPORT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Almost none of the money that reaches a Gasabo cooperative comes from the RCA.
 * It comes from NGOs, development partners, government programmes, unions and
 * banks. Which cooperative gets it turns on what the cooperative does, what
 * state it is in, and whether anyone there already knows the programme officer.
 *
 * This route keeps a register of those organisations and what they fund, matches
 * cooperatives to open opportunities against exactly those three factors, and
 * carries an application from request through decision to disbursement — where
 * the money lands in the cooperative's own books rather than in a spreadsheet
 * nobody reconciles.
 *
 * The scoring lives in services/funding.ts, with its weights stated openly.
 */

const OVERSIGHT_ROLES = ["admin", "generalManager", "government"];
const REGISTRY_EDITORS = ["admin", "generalManager"];

async function loadActor(userId: string) {
  const res = await query(
    `SELECT id, name, role, sector, cooperative_id, oversight_level FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  return row
    ? {
        id: row.id as string,
        name: row.name as string,
        role: row.role as string,
        sector: row.sector as string | null,
        cooperativeId: row.cooperative_id as string | null,
        oversightLevel: row.oversight_level as string | null,
      }
    : null;
}

/** Officers and administrators may act for any cooperative; everyone else for their own. */
function resolveCooperativeId(
  actor: { role: string; cooperativeId: string | null },
  requested: unknown
): string | null {
  if (requested && OVERSIGHT_ROLES.includes(actor.role)) return String(requested);
  if (requested && String(requested) === actor.cooperativeId) return String(requested);
  return actor.cooperativeId;
}

const SELECT_ORG = `
  SELECT o.*,
         (SELECT COUNT(*) FROM funding_opportunities f
           WHERE f.organization_id = o.id AND f.status = 'open') AS open_opportunities,
         (SELECT COUNT(*) FROM cooperative_partnerships p
           WHERE p.organization_id = o.id AND p.status IN ('introduced','active')) AS partnerships
    FROM support_organizations o
`;

const SELECT_OPPORTUNITY = `
  SELECT f.*, o.name AS organization_name, o.type AS organization_type,
         o.contact_name, o.contact_role, o.phone AS organization_phone,
         o.email AS organization_email, o.website
    FROM funding_opportunities f
    JOIN support_organizations o ON o.id = f.organization_id
`;

const SELECT_REQUEST = `
  SELECT r.*, c.name AS cooperative_name, c.sector AS cooperative_sector,
         o.name AS organization_name, o.type AS organization_type,
         f.title AS opportunity_title,
         u.name AS submitted_by_name, d.name AS decided_by_name,
         COALESCE(
           (SELECT SUM(x.amount) FROM funding_disbursements x
             WHERE x.funding_request_id = r.id), 0) AS disbursed_total,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'id', x.id, 'amount', x.amount, 'disbursedOn', x.disbursed_on,
              'reference', x.reference, 'notes', x.notes,
              'transactionId', x.transaction_id) ORDER BY x.disbursed_on)
              FROM funding_disbursements x WHERE x.funding_request_id = r.id), '[]') AS disbursements
    FROM funding_requests r
    JOIN cooperatives c ON c.id = r.cooperative_id
    JOIN support_organizations o ON o.id = r.organization_id
    LEFT JOIN funding_opportunities f ON f.id = r.opportunity_id
    LEFT JOIN users u ON u.id = r.submitted_by
    LEFT JOIN users d ON d.id = r.decided_by
`;

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" && v ? [v] : [];

// ─── GET /policy ──────────────────────────────────────────────────────────────
router.get("/policy", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      matchWeights: MATCH_WEIGHTS,
      matchThreshold: MATCH_THRESHOLD,
      supportTypes: SUPPORT_TYPES,
      organizationTypes: ORGANIZATION_TYPES,
      cooperativeBands: COOPERATIVE_BANDS,
      explanation:
        "Opportunities are ranked on three factors, weighted as shown: whether the funder's " +
        "focus matches what the cooperative does, whether the cooperative's current condition " +
        "is who the programme is for, and whether a working relationship with the funder " +
        "already exists. Hard requirements — minimum members, minimum health score, a " +
        "permanent permit — are reported separately as blockers rather than folded into the " +
        "score, because a cooperative that can never win a programme should be told so plainly.",
    },
  });
});

// ─── GET /organizations ───────────────────────────────────────────────────────
router.get("/organizations", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.active !== "all") conditions.push("o.active = TRUE");
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`o.type = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(`(o.name ILIKE $${params.length} OR o.description ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(`${SELECT_ORG} ${where} ORDER BY o.name`, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /funding/organizations error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /organizations ──────────────────────────────────────────────────────
router.post("/organizations", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !REGISTRY_EDITORS.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: "Only an administrator maintains the register of support organisations.",
      });
    }

    const {
      name, type, country, description, focusAreas, supportTypes, targetBands,
      minAmount, maxAmount, eligibilityNotes, contactName, contactRole, phone, email, website,
    } = req.body;

    if (!name || !type) {
      return res.status(400).json({ success: false, message: "name and type are required." });
    }
    if (!(ORGANIZATION_TYPES as readonly string[]).includes(type)) {
      return res.status(400).json({
        success: false,
        message: `type must be one of: ${ORGANIZATION_TYPES.join(", ")}`,
      });
    }

    const inserted = await query(
      `INSERT INTO support_organizations
         (name, type, country, description, focus_areas, support_types, target_bands,
          min_amount, max_amount, eligibility_notes, contact_name, contact_role,
          phone, email, website, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (name) DO UPDATE SET
         type = EXCLUDED.type, country = EXCLUDED.country, description = EXCLUDED.description,
         focus_areas = EXCLUDED.focus_areas, support_types = EXCLUDED.support_types,
         target_bands = EXCLUDED.target_bands, min_amount = EXCLUDED.min_amount,
         max_amount = EXCLUDED.max_amount, eligibility_notes = EXCLUDED.eligibility_notes,
         contact_name = EXCLUDED.contact_name, contact_role = EXCLUDED.contact_role,
         phone = EXCLUDED.phone, email = EXCLUDED.email, website = EXCLUDED.website,
         updated_at = NOW()
       RETURNING id`,
      [
        String(name).trim(), type, country || "Rwanda", description || null,
        JSON.stringify(asArray(focusAreas)), JSON.stringify(asArray(supportTypes)),
        JSON.stringify(asArray(targetBands)),
        minAmount != null ? Number(minAmount) : null,
        maxAmount != null ? Number(maxAmount) : null,
        eligibilityNotes || null, contactName || null, contactRole || null,
        phone || null, email || null, website || null, actor.id,
      ]
    );

    const created = await query(`${SELECT_ORG} WHERE o.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({ success: true, message: `${name} saved.`, data: created.rows[0] });
  } catch (err) {
    console.error("POST /funding/organizations error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /opportunities ───────────────────────────────────────────────────────
router.get("/opportunities", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`f.status = $${params.length}`);
    } else {
      conditions.push("f.status = 'open'");
    }
    if (req.query.organizationId) {
      params.push(req.query.organizationId);
      conditions.push(`f.organization_id = $${params.length}`);
    }
    if (req.query.supportType) {
      params.push(req.query.supportType);
      conditions.push(`f.support_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_OPPORTUNITY} ${where} ORDER BY f.closes_on NULLS LAST, f.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /funding/opportunities error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /opportunities ──────────────────────────────────────────────────────
router.post("/opportunities", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: "Opportunities are published by cooperative oversight officers.",
      });
    }

    const {
      organizationId, title, description, supportType, amountAvailable, currency,
      targetTypes, targetSectors, targetBands, minMembers, minHealthScore,
      requiresPermanentPermit, opensOn, closesOn, status,
    } = req.body;

    if (!organizationId || !title || !description || !supportType) {
      return res.status(400).json({
        success: false,
        message: "organizationId, title, description and supportType are required.",
      });
    }
    if (!(SUPPORT_TYPES as readonly string[]).includes(supportType)) {
      return res.status(400).json({
        success: false,
        message: `supportType must be one of: ${SUPPORT_TYPES.join(", ")}`,
      });
    }
    const bands = asArray(targetBands);
    const badBand = bands.find((b) => !(COOPERATIVE_BANDS as readonly string[]).includes(b));
    if (badBand) {
      return res.status(400).json({
        success: false,
        message: `targetBands may only contain: ${COOPERATIVE_BANDS.join(", ")}`,
      });
    }

    const org = await query(`SELECT id, name FROM support_organizations WHERE id = $1`, [organizationId]);
    if (org.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Organisation not found" });
    }

    const inserted = await query(
      `INSERT INTO funding_opportunities
         (organization_id, title, description, support_type, amount_available, currency,
          target_types, target_sectors, target_bands, min_members, min_health_score,
          requires_permanent_permit, opens_on, closes_on, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        organizationId, String(title).trim(), String(description).trim(), supportType,
        amountAvailable != null ? Number(amountAvailable) : null, currency || "RWF",
        JSON.stringify(asArray(targetTypes)), JSON.stringify(asArray(targetSectors)),
        JSON.stringify(bands),
        minMembers != null ? Number(minMembers) : null,
        minHealthScore != null ? Number(minHealthScore) : null,
        requiresPermanentPermit === true,
        opensOn || null, closesOn || null, status || "open", actor.id,
      ]
    );

    const created = await query(`${SELECT_OPPORTUNITY} WHERE f.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message: `"${title}" published by ${org.rows[0].name}.`,
      data: created.rows[0],
    });
  } catch (err) {
    console.error("POST /funding/opportunities error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /matches ─────────────────────────────────────────────────────────────
// Which open opportunities suit this cooperative, ranked, with the reasoning.
router.get("/matches", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const cooperativeId = resolveCooperativeId(actor, req.query.cooperativeId);
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        message: "Your account is not linked to a cooperative, so there is nothing to match.",
      });
    }

    const coopRes = await query(
      `SELECT c.id, c.name, c.type, c.sector, c.health_score,
              (SELECT COUNT(*) FROM members m
                WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count,
              (SELECT a.band FROM cooperative_monthly_audits a
                WHERE a.cooperative_id = c.id ORDER BY a.period DESC LIMIT 1) AS band,
              EXISTS (SELECT 1 FROM cooperative_permits p
                       WHERE p.cooperative_id = c.id AND p.status = 'active'
                         AND p.permit_type = 'permanent') AS has_permanent_permit
         FROM cooperatives c WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [cooperativeId]
    );
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const c = coopRes.rows[0];

    const [oppsRes, partnersRes] = await Promise.all([
      query(
        `${SELECT_OPPORTUNITY}
          WHERE f.status = 'open'
            AND (f.opens_on IS NULL OR f.opens_on <= CURRENT_DATE)
            AND (f.closes_on IS NULL OR f.closes_on >= CURRENT_DATE)`
      ),
      query(
        `SELECT organization_id, status, relationship_strength, last_contact_on
           FROM cooperative_partnerships WHERE cooperative_id = $1`,
        [cooperativeId]
      ),
    ]);

    const partnerships = new Map<string, NonNullable<MatchInput["partnership"]>>();
    for (const p of partnersRes.rows) {
      partnerships.set(p.organization_id, {
        status: p.status,
        relationshipStrength: Number(p.relationship_strength),
        lastContactOn: p.last_contact_on ? new Date(p.last_contact_on).toISOString() : null,
      });
    }

    const cooperative = {
      id: c.id as string,
      name: c.name as string,
      type: c.type as string | null,
      sector: c.sector as string | null,
      healthScore: Number(c.health_score ?? 0),
      memberCount: parseInt(c.member_count, 10),
      band: (c.band ?? null) as CooperativeBand | null,
      hasPermanentPermit: c.has_permanent_permit === true,
    };

    const opportunities = oppsRes.rows.map((o) => ({
      id: o.id as string,
      title: o.title as string,
      organizationId: o.organization_id as string,
      organizationName: o.organization_name as string,
      supportType: o.support_type as string,
      targetTypes: asArray(o.target_types),
      targetSectors: asArray(o.target_sectors),
      targetBands: asArray(o.target_bands),
      minMembers: o.min_members != null ? Number(o.min_members) : null,
      minHealthScore: o.min_health_score != null ? Number(o.min_health_score) : null,
      requiresPermanentPermit: o.requires_permanent_permit === true,
      amountAvailable: o.amount_available != null ? Number(o.amount_available) : null,
    }));

    const ranked = rankMatches(cooperative, opportunities, partnerships);
    const byId = new Map(oppsRes.rows.map((o) => [o.id, o]));

    const applied = await query(
      `SELECT opportunity_id, status FROM funding_requests
        WHERE cooperative_id = $1 AND opportunity_id IS NOT NULL`,
      [cooperativeId]
    );
    const appliedFor = new Map(applied.rows.map((a) => [a.opportunity_id, a.status]));

    res.json({
      success: true,
      data: ranked.map((m) => ({
        ...m,
        recommended: m.eligible && m.score >= MATCH_THRESHOLD,
        alreadyApplied: appliedFor.get(m.opportunityId) ?? null,
        opportunity: byId.get(m.opportunityId),
      })),
      cooperative,
      weights: MATCH_WEIGHTS,
      threshold: MATCH_THRESHOLD,
      note:
        cooperative.band == null
          ? "This cooperative has not been through a monthly audit, so the condition factor " +
            "could not be scored against any programme's target. Run the monthly audit to " +
            "sharpen these matches."
          : null,
    });
  } catch (err) {
    console.error("GET /funding/matches error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /partnerships ────────────────────────────────────────────────────────
router.get("/partnerships", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const conditions: string[] = [];
    const params: unknown[] = [];
    const cooperativeId = resolveCooperativeId(actor, req.query.cooperativeId);

    if (!OVERSIGHT_ROLES.includes(actor.role) || req.query.cooperativeId) {
      if (!cooperativeId) return res.json({ success: true, data: [] });
      params.push(cooperativeId);
      conditions.push(`p.cooperative_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT p.*, o.name AS organization_name, o.type AS organization_type,
              o.focus_areas, o.support_types, c.name AS cooperative_name
         FROM cooperative_partnerships p
         JOIN support_organizations o ON o.id = p.organization_id
         JOIN cooperatives c ON c.id = p.cooperative_id
         ${where}
        ORDER BY p.relationship_strength DESC, o.name`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /funding/partnerships error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /partnerships ───────────────────────────────────────────────────────
// Record who the cooperative actually deals with at a funder. This is the factor
// everyone knows decides funding and nobody writes down, so it is written down.
router.post("/partnerships", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const {
      organizationId, status, liaisonName, liaisonRole, liaisonPhone,
      relationshipStrength, since, lastContactOn, notes,
    } = req.body;

    const cooperativeId = resolveCooperativeId(actor, req.body.cooperativeId);
    if (!cooperativeId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: "cooperativeId and organizationId are required.",
      });
    }
    if (relationshipStrength != null && (Number(relationshipStrength) < 0 || Number(relationshipStrength) > 100)) {
      return res.status(400).json({
        success: false,
        message: "relationshipStrength is a 0–100 judgement of how well the cooperative knows the funder.",
      });
    }

    const inserted = await query(
      `INSERT INTO cooperative_partnerships
         (organization_id, cooperative_id, status, liaison_name, liaison_role, liaison_phone,
          relationship_strength, since, last_contact_on, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (organization_id, cooperative_id) DO UPDATE SET
         status = EXCLUDED.status, liaison_name = EXCLUDED.liaison_name,
         liaison_role = EXCLUDED.liaison_role, liaison_phone = EXCLUDED.liaison_phone,
         relationship_strength = EXCLUDED.relationship_strength,
         since = EXCLUDED.since, last_contact_on = EXCLUDED.last_contact_on,
         notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING id`,
      [
        organizationId, cooperativeId, status || "introduced",
        liaisonName || null, liaisonRole || null, liaisonPhone || null,
        relationshipStrength != null ? Number(relationshipStrength) : 40,
        since || null, lastContactOn || null, notes || null, actor.id,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Relationship recorded. It now counts towards this cooperative's funding matches.",
      data: { id: inserted.rows[0].id },
    });
  } catch (err) {
    console.error("POST /funding/partnerships error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /requests ────────────────────────────────────────────────────────────
router.get("/requests", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!OVERSIGHT_ROLES.includes(actor.role)) {
      if (!actor.cooperativeId) return res.json({ success: true, data: [] });
      params.push(actor.cooperativeId);
      conditions.push(`r.cooperative_id = $${params.length}`);
    } else if (req.query.cooperativeId) {
      params.push(req.query.cooperativeId);
      conditions.push(`r.cooperative_id = $${params.length}`);
    }
    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`c.sector = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`r.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_REQUEST} ${where}
       ORDER BY CASE WHEN r.status IN ('submitted','under_review') THEN 0 ELSE 1 END,
                r.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /funding/requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /requests ───────────────────────────────────────────────────────────
// A cooperative applies. The match score at the moment of applying is frozen onto
// the row with its reasons, so a later decision can be read against what was
// known at the time rather than against today's data.
router.post("/requests", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const cooperativeId = resolveCooperativeId(actor, req.body.cooperativeId);
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        message: "Your account is not linked to a cooperative.",
      });
    }

    const { opportunityId, organizationId, supportType, requestedAmount, purpose, expectedBeneficiaries } =
      req.body;

    if (!purpose || String(purpose).trim().length < 40) {
      return res.status(400).json({
        success: false,
        message:
          "Explain in at least 40 characters what the support is for and what it will change. " +
          "Funders read this before anything else.",
      });
    }

    let orgId = organizationId;
    let type = supportType;
    let opportunity: any = null;

    if (opportunityId) {
      const oppRes = await query(`${SELECT_OPPORTUNITY} WHERE f.id = $1`, [opportunityId]);
      if (oppRes.rowCount === 0) {
        return res.status(404).json({ success: false, message: "Opportunity not found" });
      }
      opportunity = oppRes.rows[0];
      if (opportunity.status !== "open") {
        return res.status(409).json({
          success: false,
          message: `"${opportunity.title}" is ${opportunity.status} and no longer accepting applications.`,
        });
      }
      orgId = opportunity.organization_id;
      type = opportunity.support_type;
    }

    if (!orgId || !type) {
      return res.status(400).json({
        success: false,
        message: "Either opportunityId, or both organizationId and supportType, are required.",
      });
    }

    const existing = await query(
      `SELECT reference FROM funding_requests
        WHERE cooperative_id = $1 AND organization_id = $2
          AND ($3::uuid IS NULL OR opportunity_id = $3)
          AND status IN ('submitted','under_review','approved')`,
      [cooperativeId, orgId, opportunityId || null]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `Application ${existing.rows[0].reference} to this organisation is still open.`,
      });
    }

    // Score it now, and keep the reasoning.
    let match: any = null;
    if (opportunity) {
      const coopRes = await query(
        `SELECT c.id, c.name, c.type, c.sector, c.health_score,
                (SELECT COUNT(*) FROM members m
                  WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count,
                (SELECT a.band FROM cooperative_monthly_audits a
                  WHERE a.cooperative_id = c.id ORDER BY a.period DESC LIMIT 1) AS band,
                EXISTS (SELECT 1 FROM cooperative_permits p
                         WHERE p.cooperative_id = c.id AND p.status = 'active'
                           AND p.permit_type = 'permanent') AS has_permanent_permit
           FROM cooperatives c WHERE c.id = $1`,
        [cooperativeId]
      );
      const partner = await query(
        `SELECT status, relationship_strength, last_contact_on FROM cooperative_partnerships
          WHERE cooperative_id = $1 AND organization_id = $2`,
        [cooperativeId, orgId]
      );
      const c = coopRes.rows[0];
      const partnerships = new Map<string, NonNullable<MatchInput["partnership"]>>();
      if (partner.rowCount) {
        partnerships.set(orgId, {
          status: partner.rows[0].status,
          relationshipStrength: Number(partner.rows[0].relationship_strength),
          lastContactOn: partner.rows[0].last_contact_on
            ? new Date(partner.rows[0].last_contact_on).toISOString()
            : null,
        });
      }
      [match] = rankMatches(
        {
          id: c.id,
          name: c.name,
          type: c.type,
          sector: c.sector,
          healthScore: Number(c.health_score ?? 0),
          memberCount: parseInt(c.member_count, 10),
          band: (c.band ?? null) as CooperativeBand | null,
          hasPermanentPermit: c.has_permanent_permit === true,
        },
        [
          {
            id: opportunity.id,
            title: opportunity.title,
            organizationId: opportunity.organization_id,
            organizationName: opportunity.organization_name,
            supportType: opportunity.support_type,
            targetTypes: asArray(opportunity.target_types),
            targetSectors: asArray(opportunity.target_sectors),
            targetBands: asArray(opportunity.target_bands),
            minMembers: opportunity.min_members != null ? Number(opportunity.min_members) : null,
            minHealthScore:
              opportunity.min_health_score != null ? Number(opportunity.min_health_score) : null,
            requiresPermanentPermit: opportunity.requires_permanent_permit === true,
            amountAvailable:
              opportunity.amount_available != null ? Number(opportunity.amount_available) : null,
          },
        ],
        partnerships
      );

      // Blockers are hard rules, so the application is refused rather than filed
      // to be rejected later — that only wastes the cooperative's time.
      if (match && !match.eligible) {
        return res.status(409).json({
          success: false,
          message: `This cooperative is not eligible for "${opportunity.title}".`,
          blockers: match.blockers,
        });
      }
    }

    const year = new Date().getFullYear();
    const seq = await query(
      `SELECT COUNT(*) AS n FROM funding_requests WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const reference = `FND/${year}/${String(parseInt(seq.rows[0].n, 10) + 1).padStart(4, "0")}`;

    const inserted = await query(
      `INSERT INTO funding_requests
         (reference, cooperative_id, organization_id, opportunity_id, support_type,
          requested_amount, purpose, expected_beneficiaries, status,
          match_score, match_explanation, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,$10,$11)
       RETURNING id`,
      [
        reference, cooperativeId, orgId, opportunityId || null, type,
        requestedAmount != null ? Number(requestedAmount) : null,
        String(purpose).trim(),
        expectedBeneficiaries != null ? Number(expectedBeneficiaries) : null,
        match ? match.score : null,
        match ? JSON.stringify({ components: match.components, reasons: match.reasons }) : null,
        actor.id,
      ]
    );

    // The RCA and the sector officer broker these relationships, so they are told.
    const officers = await query(
      `SELECT u.id FROM users u
        WHERE u.status = 'active'
          AND (u.oversight_level = 'rca'
               OR (u.oversight_level = 'sector'
                   AND u.sector = (SELECT sector FROM cooperatives WHERE id = $1)))`,
      [cooperativeId]
    );
    for (const o of officers.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'Funding application filed',$2,'alert','/funding')`,
        [
          o.id,
          `A cooperative in your portfolio has applied for external support (${reference}). ` +
            "An introduction to the funder may help it land.",
        ]
      );
    }

    const created = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message: `Application ${reference} filed.`,
      data: created.rows[0],
      match,
    });
  } catch (err) {
    console.error("POST /funding/requests error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /requests/:id/decision ─────────────────────────────────────────────
router.patch("/requests/:id/decision", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message:
          "A funder's decision is recorded by the cooperative oversight officer who is " +
          "brokering it.",
      });
    }

    const { decision, note } = req.body;
    const allowed = ["under_review", "approved", "rejected"];
    if (!allowed.includes(decision)) {
      return res.status(400).json({
        success: false,
        message: `decision must be one of: ${allowed.join(", ")}`,
      });
    }
    if (decision === "rejected" && !String(note ?? "").trim()) {
      return res.status(400).json({
        success: false,
        message: "A rejected application must carry the funder's reason.",
      });
    }

    const found = await query(
      `SELECT r.*, c.name AS cooperative_name, o.name AS organization_name
         FROM funding_requests r
         JOIN cooperatives c ON c.id = r.cooperative_id
         JOIN support_organizations o ON o.id = r.organization_id
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    const request = found.rows[0];
    if (!["submitted", "under_review"].includes(request.status)) {
      return res.status(409).json({
        success: false,
        message: `This application is already ${request.status}.`,
      });
    }

    const isFinal = decision !== "under_review";
    await query(
      `UPDATE funding_requests
          SET status = $1, decision_note = $2,
              decided_by = CASE WHEN $4::boolean THEN $3 ELSE decided_by END,
              decided_at = CASE WHEN $4::boolean THEN NOW() ELSE decided_at END,
              updated_at = NOW()
        WHERE id = $5`,
      [decision, note ? String(note).trim() : null, actor.id, isFinal, request.id]
    );

    // An approval is the start of a relationship, not just a payment, so it is
    // recorded as one — that is what will lift this cooperative's next match.
    if (decision === "approved") {
      await query(
        `INSERT INTO cooperative_partnerships
           (organization_id, cooperative_id, status, relationship_strength, since, last_contact_on, recorded_by)
         VALUES ($1,$2,'active',70,CURRENT_DATE,CURRENT_DATE,$3)
         ON CONFLICT (organization_id, cooperative_id) DO UPDATE SET
           status = 'active',
           relationship_strength = GREATEST(cooperative_partnerships.relationship_strength, 70),
           last_contact_on = CURRENT_DATE,
           updated_at = NOW()`,
        [request.organization_id, request.cooperative_id, actor.id]
      );
    }

    const managers = await query(
      `SELECT id FROM users WHERE cooperative_id = $1 AND status = 'active'`,
      [request.cooperative_id]
    );
    for (const m of managers.rows) {
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'Funding application update',$2,'alert','/funding')`,
        [
          m.id,
          `${request.organization_name} has marked application ${request.reference} as ` +
            `${decision.replace(/_/g, " ")}.${note ? ` Note: ${String(note).trim()}` : ""}`,
        ]
      );
    }

    const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
    res.json({
      success: true,
      message: `Application ${request.reference} marked ${decision.replace(/_/g, " ")}.`,
      data: updated.rows[0],
    });
  } catch (err) {
    console.error("PATCH /funding/requests/:id/decision error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /requests/:id/disbursements ─────────────────────────────────────────
// Money that lands is posted to the cooperative's own books at the same time, so
// the funding record and the financials can never disagree.
router.post("/requests/:id/disbursements", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { amount, disbursedOn, reference, notes, postToBooks } = req.body;
    if (amount == null || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A positive amount is required." });
    }

    const found = await query(
      `SELECT r.*, c.name AS cooperative_name, o.name AS organization_name
         FROM funding_requests r
         JOIN cooperatives c ON c.id = r.cooperative_id
         JOIN support_organizations o ON o.id = r.organization_id
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    const request = found.rows[0];
    if (!["approved", "disbursed"].includes(request.status)) {
      return res.status(409).json({
        success: false,
        message: "Only an approved application can be disbursed against.",
      });
    }

    let transactionId: string | null = null;
    if (postToBooks !== false) {
      const txn = await query(
        `INSERT INTO transactions
           (cooperative_id, type, category, amount, date, description, reference,
            payment_method, status, notes, recorded_by)
         VALUES ($1,'income','Grants & Donations',$2,COALESCE($3::date, CURRENT_DATE),$4,$5,
                 'bank_transfer','completed',$6,$7)
         RETURNING id`,
        [
          request.cooperative_id,
          Number(amount),
          `${request.organization_name} — ${request.support_type.replace(/_/g, " ")} (${request.reference})`,
          reference || request.reference,
          notes || null,
          actor.id,
        ]
      );
      transactionId = txn.rows[0].id;
    }

    await query(
      `INSERT INTO funding_disbursements
         (funding_request_id, amount, disbursed_on, reference, notes, transaction_id, recorded_by)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7)`,
      [
        request.id, Number(amount), disbursedOn || null,
        reference || null, notes || null, transactionId, actor.id,
      ]
    );
    await query(
      `UPDATE funding_requests SET status = 'disbursed', updated_at = NOW() WHERE id = $1`,
      [request.id]
    );

    const updated = await query(`${SELECT_REQUEST} WHERE r.id = $1`, [request.id]);
    res.status(201).json({
      success: true,
      message:
        `RWF ${Number(amount).toLocaleString()} recorded against ${request.reference}` +
        (transactionId ? " and posted to the cooperative's income." : "."),
      data: updated.rows[0],
    });
  } catch (err) {
    console.error("POST /funding/requests/:id/disbursements error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
