import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { callAIService } from "../services/aiClient";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MONTHLY AUDIT, AND THE VISIT LIST IT PRODUCES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cooperatives seldom announce that they have stopped working. They go quiet,
 * and are found out a year later when the members have already lost their
 * savings. Every month the AI service scores every cooperative in the district on
 * whether it is still functioning and whether its members are still engaged; this
 * route persists that assessment and turns the bottom of the list into **field
 * visits** assigned to sector cooperative officers.
 *
 * The visit is the product. The score is only how the list gets ordered.
 *
 * The AI service owns no tables and issues no writes — it returns the assessment
 * and everything below is written from here, which is also why a run is
 * reproducible: the same period re-audited overwrites its own row rather than
 * stacking a second one.
 */

const OVERSIGHT_ROLES = ["admin", "generalManager", "government"];

/** Who may commission a run: the RCA and district levels, and administrators. */
function canRunAudit(actor: { role: string; oversightLevel: string | null }) {
  return (
    ["admin", "generalManager"].includes(actor.role) ||
    (actor.role === "government" && ["rca", "district"].includes(actor.oversightLevel ?? ""))
  );
}

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

const SELECT_AUDIT_ROW = `
  SELECT a.*, c.name AS cooperative_name, c.type AS cooperative_type,
         c.sector AS cooperative_sector, c.status AS cooperative_status,
         (SELECT COUNT(*) FROM members m
           WHERE m.cooperative_id = a.cooperative_id AND m.deleted_at IS NULL) AS member_count
    FROM cooperative_monthly_audits a
    JOIN cooperatives c ON c.id = a.cooperative_id
`;

const SELECT_VISIT = `
  SELECT v.*, c.name AS cooperative_name, c.sector AS cooperative_sector,
         c.type AS cooperative_type, c.phone AS cooperative_phone,
         u.name AS assigned_to_name, u.phone AS assigned_to_phone,
         a.band, a.composite_score, a.functionality_score, a.engagement_score,
         a.reasons, a.recommended_actions
    FROM cooperative_field_visits v
    JOIN cooperatives c ON c.id = v.cooperative_id
    LEFT JOIN users u ON u.id = v.assigned_to
    LEFT JOIN cooperative_monthly_audits a ON a.id = v.audit_id
`;

/** The sector officer who supervises a cooperative, when one is on the system. */
async function sectorOfficerFor(sector: string | null): Promise<string | null> {
  if (!sector) return null;
  const res = await query(
    `SELECT id FROM users
      WHERE status = 'active' AND oversight_level = 'sector' AND sector = $1
      ORDER BY created_at LIMIT 1`,
    [sector]
  );
  return res.rows[0]?.id ?? null;
}

// ─── POST /monthly/run ────────────────────────────────────────────────────────
// Run the audit for a month, persist it, and raise the visit list.
router.post("/monthly/run", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !canRunAudit(actor)) {
      return res.status(403).json({
        success: false,
        message: "Only the RCA, the district office or an administrator may run the monthly audit.",
      });
    }

    const period = req.body.period as string | undefined;
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ success: false, message: "period must be YYYY-MM." });
    }

    let aiData: any = null;
    try {
      aiData = await callAIService(`/monthly-audit${period ? `?period=${period}` : ""}`, "GET", undefined, 30000);
    } catch {
      return res.status(503).json({
        success: false,
        message:
          "The AI service is not reachable, so the monthly audit could not be computed. " +
          "Start it and try again — no partial results have been written.",
        reachable: false,
      });
    }

    const results: any[] = Array.isArray(aiData?.results) ? aiData.results : [];
    if (results.length === 0) {
      return res.json({
        success: true,
        message: aiData?.note ?? "The audit returned no cooperatives.",
        data: { period: aiData?.period ?? period ?? null, persisted: 0, visitsRaised: 0 },
      });
    }

    const periodDate = `${aiData.period}-01`;
    let persisted = 0;
    let visitsRaised = 0;
    const notifiedOfficers = new Set<string>();

    for (const r of results) {
      // Re-running a month overwrites its own row rather than stacking another.
      const saved = await query(
        `INSERT INTO cooperative_monthly_audits
           (period, cooperative_id, functionality_score, engagement_score, composite_score,
            band, visit_recommended, visit_priority, signals, reasons, recommended_actions,
            unmeasured, model_name, model_version, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (period, cooperative_id) DO UPDATE SET
           functionality_score = EXCLUDED.functionality_score,
           engagement_score    = EXCLUDED.engagement_score,
           composite_score     = EXCLUDED.composite_score,
           band                = EXCLUDED.band,
           visit_recommended   = EXCLUDED.visit_recommended,
           visit_priority      = EXCLUDED.visit_priority,
           signals             = EXCLUDED.signals,
           reasons             = EXCLUDED.reasons,
           recommended_actions = EXCLUDED.recommended_actions,
           unmeasured          = EXCLUDED.unmeasured,
           model_name          = EXCLUDED.model_name,
           model_version       = EXCLUDED.model_version,
           generated_at        = NOW()
         RETURNING id`,
        [
          periodDate,
          r.cooperativeId,
          r.functionalityScore,
          r.engagementScore,
          r.compositeScore,
          r.band,
          r.visitRecommended === true,
          r.visitPriority ?? null,
          JSON.stringify({
            components: r.components,
            engagementDetail: r.engagementDetail,
            dormant: r.dormant,
            monthsSinceLastTransaction: r.monthsSinceLastTransaction,
            evidenceQuality: r.evidenceQuality,
            flaggedOnSilenceAlone: r.flaggedOnSilenceAlone,
            permitType: r.permitType,
            permitExpiresOn: r.permitExpiresOn,
            openFundingRequests: r.openFundingRequests,
          }),
          JSON.stringify(r.reasons ?? []),
          JSON.stringify(r.recommendedActions ?? []),
          JSON.stringify(r.unmeasured ?? []),
          aiData.model_name ?? null,
          aiData.model_version ?? null,
        ]
      );
      persisted += 1;

      if (!r.visitRecommended) continue;

      // The partial unique index means an already-open visit for this month is
      // left alone rather than duplicated.
      const assignee = await sectorOfficerFor(r.sector);
      const visit = await query(
        `INSERT INTO cooperative_field_visits
           (cooperative_id, audit_id, period, priority, reason, status, assigned_to)
         VALUES ($1,$2,$3,$4,$5,'pending',$6)
         ON CONFLICT (cooperative_id, period) WHERE status IN ('pending','scheduled')
         DO NOTHING
         RETURNING id`,
        [
          r.cooperativeId,
          saved.rows[0].id,
          periodDate,
          r.visitPriority ?? 3,
          (r.reasons ?? []).slice(0, 3).join(" ") ||
            `Assessed as ${r.band} in the ${aiData.period} monthly audit.`,
          assignee,
        ]
      );
      if (visit.rowCount) {
        visitsRaised += 1;
        if (assignee) notifiedOfficers.add(assignee);
      }
    }

    for (const officerId of notifiedOfficers) {
      const mine = await query(
        `SELECT COUNT(*) AS n FROM cooperative_field_visits
          WHERE assigned_to = $1 AND period = $2 AND status = 'pending'`,
        [officerId, periodDate]
      );
      await query(
        `INSERT INTO notifications (user_id, title, message, type, link)
         VALUES ($1,'Cooperatives needing a visit',$2,'alert','/monthly-audit')`,
        [
          officerId,
          `The ${aiData.period} monthly audit flagged ${mine.rows[0].n} cooperative(s) in your ` +
            "sector as needing a field visit. Each one carries the reasons it was flagged.",
        ]
      );
    }

    // Cooperatives whose position is bad enough to belong in AI Insights too.
    for (const r of results.filter((x: any) => x.band === "critical" || x.dormant)) {
      await query(
        `INSERT INTO ai_insights
           (cooperative_id, type, severity, title, summary, detail, affected_metric,
            current_value, expected_value, recommendations, model_name, confidence,
            resolved, generated_at)
         VALUES ($1,'anomaly','critical',$2,$3,$4,'Functionality Score',$5,$6,$7,$8,$9,false,NOW())`,
        [
          r.cooperativeId,
          `Monthly audit — ${r.cooperativeName} may have stopped operating`,
          r.dormant
            ? `${r.cooperativeName} has recorded nothing for ` +
              `${r.monthsSinceLastTransaction ?? "an unknown number of"} months and scores ` +
              `${r.compositeScore}/100 on the ${aiData.period} functionality audit.`
            : `${r.cooperativeName} scores ${r.compositeScore}/100 on the ${aiData.period} ` +
              "functionality audit, the lowest band.",
          (r.reasons ?? []).join(" "),
          r.compositeScore,
          50,
          JSON.stringify(r.recommendedActions ?? []),
          aiData.model_name ?? null,
          r.flaggedOnSilenceAlone ? 0.5 : 0.85,
        ]
      );
    }

    res.json({
      success: true,
      message:
        `Monthly audit for ${aiData.period} complete: ${persisted} cooperative(s) assessed, ` +
        `${visitsRaised} field visit(s) raised.`,
      data: {
        period: aiData.period,
        persisted,
        visitsRaised,
        summary: aiData.summary,
        note: aiData.note,
        weights: aiData.weights,
        thresholds: aiData.thresholds,
      },
    });
  } catch (err) {
    console.error("POST /audits/monthly/run error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /monthly ─────────────────────────────────────────────────────────────
// A persisted month's standings. Oversight roles see the district; a cooperative
// sees only its own row.
router.get("/monthly", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const periods = await query(
      `SELECT DISTINCT TO_CHAR(period, 'YYYY-MM') AS period FROM cooperative_monthly_audits
        ORDER BY period DESC`
    );
    const requested = req.query.period as string | undefined;
    const period = requested ?? periods.rows[0]?.period ?? null;

    if (!period) {
      return res.json({
        success: true,
        data: [],
        availablePeriods: [],
        period: null,
        note: "No monthly audit has been run yet.",
      });
    }

    const conditions = [`TO_CHAR(a.period, 'YYYY-MM') = $1`];
    const params: unknown[] = [period];

    if (!OVERSIGHT_ROLES.includes(actor.role)) {
      if (!actor.cooperativeId) {
        return res.json({ success: true, data: [], availablePeriods: periods.rows.map((p) => p.period), period });
      }
      params.push(actor.cooperativeId);
      conditions.push(`a.cooperative_id = $${params.length}`);
    }
    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`c.sector = $${params.length}`);
    }
    if (req.query.band) {
      params.push(req.query.band);
      conditions.push(`a.band = $${params.length}`);
    }

    const result = await query(
      `${SELECT_AUDIT_ROW} WHERE ${conditions.join(" AND ")}
       ORDER BY a.composite_score ASC`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      period,
      availablePeriods: periods.rows.map((p) => p.period),
      summary: {
        total: result.rowCount ?? 0,
        healthy: result.rows.filter((r) => r.band === "healthy").length,
        monitor: result.rows.filter((r) => r.band === "monitor").length,
        atRisk: result.rows.filter((r) => r.band === "at_risk").length,
        critical: result.rows.filter((r) => r.band === "critical").length,
        visitsRecommended: result.rows.filter((r) => r.visit_recommended).length,
      },
    });
  } catch (err) {
    console.error("GET /audits/monthly error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /monthly/cooperative/:cooperativeId ──────────────────────────────────
// One cooperative's audit history — the trend matters more than any single month.
router.get("/monthly/cooperative/:cooperativeId", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (
      !OVERSIGHT_ROLES.includes(actor.role) &&
      actor.cooperativeId !== req.params.cooperativeId
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const result = await query(
      `${SELECT_AUDIT_ROW} WHERE a.cooperative_id = $1 ORDER BY a.period DESC LIMIT 24`,
      [req.params.cooperativeId]
    );
    const visits = await query(
      `${SELECT_VISIT} WHERE v.cooperative_id = $1 ORDER BY v.created_at DESC`,
      [req.params.cooperativeId]
    );

    res.json({
      success: true,
      data: result.rows,
      latest: result.rows[0] ?? null,
      visits: visits.rows,
    });
  } catch (err) {
    console.error("GET /audits/monthly/cooperative/:cooperativeId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /visits ──────────────────────────────────────────────────────────────
// The list of cooperatives somebody needs to go and see. A sector officer sees
// their own sector; the RCA sees the district.
router.get("/visits", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: "The field-visit list is for cooperative oversight officers.",
      });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`c.sector = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`v.status = $${params.length}`);
    }
    if (req.query.period) {
      params.push(req.query.period);
      conditions.push(`TO_CHAR(v.period, 'YYYY-MM') = $${params.length}`);
    }
    if (req.query.mine === "true") {
      params.push(actor.id);
      conditions.push(`v.assigned_to = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_VISIT} ${where}
       ORDER BY CASE WHEN v.status IN ('pending','scheduled') THEN 0 ELSE 1 END,
                v.priority ASC, v.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      summary: {
        pending: result.rows.filter((v) => v.status === "pending").length,
        scheduled: result.rows.filter((v) => v.status === "scheduled").length,
        completed: result.rows.filter((v) => v.status === "completed").length,
      },
    });
  } catch (err) {
    console.error("GET /audits/visits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /visits ─────────────────────────────────────────────────────────────
// Raise a visit by hand. The audit raises most of them, but an officer who hears
// something in the sector should not have to wait for a month-end run.
router.post("/visits", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { cooperativeId, reason, priority, scheduledFor, assignedTo } = req.body;
    if (!cooperativeId || !reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: "cooperativeId and a reason for the visit are required.",
      });
    }

    const coop = await query(
      `SELECT id, name, sector FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`,
      [cooperativeId]
    );
    if (coop.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }

    const assignee = assignedTo || (await sectorOfficerFor(coop.rows[0].sector)) || actor.id;
    const period = new Date();
    period.setDate(1);

    const inserted = await query(
      `INSERT INTO cooperative_field_visits
         (cooperative_id, period, priority, reason, status, assigned_to, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (cooperative_id, period) WHERE status IN ('pending','scheduled')
       DO NOTHING
       RETURNING id`,
      [
        cooperativeId,
        period.toISOString().slice(0, 10),
        priority != null ? Number(priority) : 3,
        String(reason).trim(),
        scheduledFor ? "scheduled" : "pending",
        assignee,
        scheduledFor || null,
      ]
    );
    if (inserted.rowCount === 0) {
      return res.status(409).json({
        success: false,
        message: `A visit to ${coop.rows[0].name} is already open this month.`,
      });
    }

    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,'Field visit assigned',$2,'alert','/monthly-audit')`,
      [assignee, `A visit to ${coop.rows[0].name} has been assigned to you: ${String(reason).trim()}`]
    );

    const created = await query(`${SELECT_VISIT} WHERE v.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message: `Visit to ${coop.rows[0].name} raised.`,
      data: created.rows[0],
    });
  } catch (err) {
    console.error("POST /audits/visits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /visits/:id ────────────────────────────────────────────────────────
// Schedule a visit, reassign it, or close it with what was found.
//
// Recording the outcome is the point of the whole exercise: the next month's
// dissolution audit reads these rows to answer "was anything tried before this
// cooperative was allowed to close?".
router.patch("/visits/:id", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !OVERSIGHT_ROLES.includes(actor.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const found = await query(
      `SELECT v.*, c.name AS cooperative_name, c.sector
         FROM cooperative_field_visits v JOIN cooperatives c ON c.id = v.cooperative_id
        WHERE v.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Visit not found" });
    }
    const visit = found.rows[0];

    if (
      actor.role === "government" &&
      actor.oversightLevel === "sector" &&
      actor.sector &&
      visit.sector !== actor.sector
    ) {
      return res.status(403).json({
        success: false,
        message: `${visit.cooperative_name} is not in your sector.`,
      });
    }

    const { status, scheduledFor, assignedTo, findings, supportNeeded, outcome } = req.body;
    const allowedStatuses = ["pending", "scheduled", "completed", "cancelled"];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${allowedStatuses.join(", ")}`,
      });
    }
    const allowedOutcomes = [
      "operating_normally",
      "needs_support",
      "referred_for_funding",
      "recommended_for_dissolution",
      "unreachable",
    ];
    if (outcome && !allowedOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: `outcome must be one of: ${allowedOutcomes.join(", ")}`,
      });
    }
    if (status === "completed") {
      if (!findings || String(findings).trim().length < 20) {
        return res.status(400).json({
          success: false,
          message:
            "Record what you found, in at least 20 characters. A visit with no findings tells " +
            "the next officer nothing.",
        });
      }
      if (!outcome) {
        return res.status(400).json({
          success: false,
          message: `An outcome is required to close a visit. One of: ${allowedOutcomes.join(", ")}`,
        });
      }
    }

    const updated = await query(
      `UPDATE cooperative_field_visits
          SET status         = COALESCE($1, status),
              scheduled_for  = COALESCE($2::date, scheduled_for),
              assigned_to    = COALESCE($3, assigned_to),
              findings       = COALESCE($4, findings),
              support_needed = COALESCE($5, support_needed),
              outcome        = COALESCE($6, outcome),
              visited_at     = CASE WHEN $1 = 'completed' THEN NOW() ELSE visited_at END,
              updated_at     = NOW()
        WHERE id = $7
        RETURNING id`,
      [
        status || null,
        scheduledFor || null,
        assignedTo || null,
        findings ? String(findings).trim() : null,
        supportNeeded ? String(supportNeeded).trim() : null,
        outcome || null,
        visit.id,
      ]
    );

    // A visit that ends in a funding referral should not stop at a note in a
    // field report — tell the cooperative so they can act on it.
    if (status === "completed" && outcome === "referred_for_funding") {
      const managers = await query(
        `SELECT id FROM users
          WHERE cooperative_id = $1 AND status = 'active' AND role IN ('manager','cooperative')`,
        [visit.cooperative_id]
      );
      for (const m of managers.rows) {
        await query(
          `INSERT INTO notifications (user_id, title, message, type, link)
           VALUES ($1,'Referred for external support',$2,'alert','/funding')`,
          [
            m.id,
            `Following a field visit, ${visit.cooperative_name} has been referred for external ` +
              "support. Open the funding page to see which organisations match your cooperative.",
          ]
        );
      }
    }

    const result = await query(`${SELECT_VISIT} WHERE v.id = $1`, [updated.rows[0].id]);
    res.json({
      success: true,
      message:
        status === "completed"
          ? `Visit to ${visit.cooperative_name} closed as "${String(outcome).replace(/_/g, " ")}".`
          : "Visit updated.",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("PATCH /audits/visits/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
