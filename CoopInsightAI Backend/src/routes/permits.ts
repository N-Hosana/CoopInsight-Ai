import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate } from "../middleware/auth";
import { FORMATION_THRESHOLDS } from "../services/eligibility";
import {
  PERMIT_TERMS,
  MATURITY_AUDIT_CRITERIA,
  MATURITY_PASS_MARK,
  DISSOLUTION_AUDIT_CRITERIA,
  DISSOLUTION_TARGET_DAYS,
  assessMaturity,
  permanentTerm,
  expiryFor,
  daysUntil,
  MaturityFacts,
} from "../services/permits";
import { BOARD, ORDINARY_ASSEMBLY_MONTHS } from "../services/governance";

const router = Router();
router.use(authenticate);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OPERATING PERMITS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Registration does not hand a cooperative a licence for life. The RCA issues a
 * one-year temporary permit; before it lapses the cooperative is audited, and a
 * pass converts it into a permanent permit of 30 years — or 50 for industrial
 * and rice-growing cooperatives, whose capital cannot pay back any faster.
 *
 * The terms, the audit checklist and the pass mark all live in
 * services/permits.ts. Nothing in this file hardcodes a number.
 */

const OVERSIGHT_ROLES = ["admin", "generalManager", "government"];

/** Only the RCA level (and administrators) issues, converts or revokes permits. */
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

function isRca(actor: { role: string; oversightLevel: string | null }) {
  return ["admin", "generalManager"].includes(actor.role) || actor.oversightLevel === "rca";
}

function isOversight(actor: { role: string }) {
  return OVERSIGHT_ROLES.includes(actor.role);
}

const SELECT_PERMIT = `
  SELECT p.*,
         c.name AS cooperative_name,
         c.type AS cooperative_type,
         c.sector AS cooperative_sector,
         c.registration_number,
         iu.name AS issued_by_name
    FROM cooperative_permits p
    JOIN cooperatives c ON c.id = p.cooperative_id
    LEFT JOIN users iu  ON iu.id = p.issued_by
`;

const SELECT_AUDIT = `
  SELECT a.*,
         c.name AS cooperative_name,
         c.type AS cooperative_type,
         c.sector AS cooperative_sector,
         p.permit_number, p.permit_type, p.expires_on AS permit_expires_on,
         ou.name AS opened_by_name,
         cu.name AS concluded_by_name,
         r.reference AS request_reference
    FROM rca_audits a
    JOIN cooperatives c ON c.id = a.cooperative_id
    LEFT JOIN cooperative_permits p ON p.id = a.permit_id
    LEFT JOIN users ou ON ou.id = a.opened_by
    LEFT JOIN users cu ON cu.id = a.concluded_by
    LEFT JOIN cooperative_requests r ON r.id = a.request_id
`;

async function nextSequence(table: string, column: string, prefix: string) {
  const year = new Date().getFullYear();
  const res = await query(
    `SELECT COUNT(*) AS n FROM ${table} WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [year]
  );
  void column;
  const n = parseInt(res.rows[0].n, 10) + 1;
  return `${prefix}/${year}/${String(n).padStart(4, "0")}`;
}

async function notifyRca(title: string, message: string, link = "/permits") {
  const officers = await query(
    `SELECT id FROM users
      WHERE status = 'active' AND (oversight_level = 'rca' OR role IN ('admin','generalManager'))`
  );
  for (const o of officers.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'alert',$4)`,
      [o.id, title, message, link]
    );
  }
  return officers.rowCount ?? 0;
}

async function notifyCooperative(cooperativeId: string, title: string, message: string, link = "/permits") {
  const users = await query(
    `SELECT id FROM users WHERE cooperative_id = $1 AND status = 'active'`,
    [cooperativeId]
  );
  for (const u of users.rows) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1,$2,$3,'alert',$4)`,
      [u.id, title, message, link]
    );
  }
  return users.rowCount ?? 0;
}

/**
 * Issues a permit, superseding whatever the cooperative held before. Exported so
 * the formation workflow can call it the moment the RCA approves a registration —
 * a cooperative should never exist on the register without a permit.
 */
export async function issuePermit(opts: {
  cooperativeId: string;
  permitType: "temporary" | "permanent";
  termYears: number;
  termRule: string;
  basis: string;
  issuedBy?: string | null;
  sourceRequestId?: string | null;
}): Promise<{ id: string; permitNumber: string; expiresOn: string }> {
  await query(
    `UPDATE cooperative_permits
        SET status = 'superseded', updated_at = NOW()
      WHERE cooperative_id = $1 AND status = 'active'`,
    [opts.cooperativeId]
  );

  const issuedOn = new Date();
  const expiresOn = expiryFor(issuedOn, opts.termYears);
  const permitNumber = await nextSequence(
    "cooperative_permits",
    "permit_number",
    opts.permitType === "temporary" ? "PMT/T" : "PMT/P"
  );

  const inserted = await query(
    `INSERT INTO cooperative_permits
       (cooperative_id, permit_number, permit_type, term_years, issued_on, expires_on,
        status, term_rule, basis, source_request_id, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)
     RETURNING id, permit_number, expires_on`,
    [
      opts.cooperativeId,
      permitNumber,
      opts.permitType,
      opts.termYears,
      issuedOn.toISOString().slice(0, 10),
      expiresOn.toISOString().slice(0, 10),
      opts.termRule,
      opts.basis,
      opts.sourceRequestId ?? null,
      opts.issuedBy ?? null,
    ]
  );

  return {
    id: inserted.rows[0].id,
    permitNumber: inserted.rows[0].permit_number,
    expiresOn: inserted.rows[0].expires_on,
  };
}

/**
 * Everything the maturity audit scores against, gathered from the operational
 * tables. This is the only place the facts are assembled, so the automated
 * pre-assessment and the officer's checklist are looking at the same numbers.
 */
export async function gatherMaturityFacts(
  cooperativeId: string,
  since: string
): Promise<MaturityFacts & { since: string }> {
  const [income, members, assemblies, participation, balance, leadership, docs, txns] =
    await Promise.all([
      query(
        `SELECT COUNT(DISTINCT DATE_TRUNC('month', date)) AS n
           FROM transactions
          WHERE cooperative_id = $1 AND status = 'completed' AND type = 'income' AND date >= $2`,
        [cooperativeId, since]
      ),
      query(
        `SELECT COUNT(*) AS n FROM members
          WHERE cooperative_id = $1 AND deleted_at IS NULL`,
        [cooperativeId]
      ),
      // Every assembly, and separately those that fell in the months the RCA
      // sets aside for the ordinary general assembly.
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (
             WHERE EXTRACT(MONTH FROM date)::int = ANY($3::int[])
           ) AS ordinary
           FROM activities
          WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND type = 'meeting' AND status = 'completed' AND date >= $2`,
        [cooperativeId, since, [...ORDINARY_ASSEMBLY_MONTHS]]
      ),
      query(
        `SELECT
           (SELECT COUNT(*) FROM members m
             WHERE m.cooperative_id = $1 AND m.deleted_at IS NULL) AS total,
           (SELECT COUNT(DISTINCT m.id) FROM members m
             WHERE m.cooperative_id = $1 AND m.deleted_at IS NULL
               AND (
                 EXISTS (SELECT 1 FROM activity_participants ap
                          JOIN activities a ON a.id = ap.activity_id
                         WHERE ap.member_id = m.id AND ap.attended AND a.date >= $2)
                 OR EXISTS (SELECT 1 FROM member_contributions mc
                             WHERE mc.member_id = m.id AND mc.date >= $2)
               )) AS engaged`,
        [cooperativeId, since]
      ),
      query(`SELECT COUNT(*) AS n FROM balance_sheets WHERE cooperative_id = $1`, [cooperativeId]),
      // The RCA brochure puts five people on the Board: President, Vice
      // President, Secretary and two advisors. The sector cooperative officer
      // recorded alongside them is not a board seat and is excluded.
      query(
        `SELECT COUNT(*) AS n FROM cooperative_leadership
          WHERE cooperative_id = $1
            AND (end_date IS NULL OR end_date > CURRENT_DATE)
            AND role <> 'Sector Cooperative Officer'
            AND name IS NOT NULL AND name <> '(Name not recorded)'`,
        [cooperativeId]
      ),
      query(
        `SELECT COUNT(*) AS n FROM cooperative_documents
          WHERE cooperative_id = $1 AND type IN ('registration','policy','minutes')`,
        [cooperativeId]
      ),
      query(
        `SELECT COUNT(*) AS n FROM transactions
          WHERE cooperative_id = $1 AND status = 'completed' AND date >= $2`,
        [cooperativeId, since]
      ),
    ]);

  const total = parseInt(participation.rows[0].total, 10);
  const engaged = parseInt(participation.rows[0].engaged, 10);

  return {
    since,
    monthsWithIncome: parseInt(income.rows[0].n, 10),
    memberCount: parseInt(members.rows[0].n, 10),
    minMembers: FORMATION_THRESHOLDS.minMembers,
    generalAssemblies: parseInt(assemblies.rows[0].total, 10),
    ordinaryAssemblies: parseInt(assemblies.rows[0].ordinary, 10),
    participationRate: total > 0 ? engaged / total : null,
    hasTransactions: parseInt(txns.rows[0].n, 10) > 0,
    hasBalanceSheet: parseInt(balance.rows[0].n, 10) > 0,
    boardSeatsFilled: parseInt(leadership.rows[0].n, 10),
    leadershipComplete: parseInt(leadership.rows[0].n, 10) >= BOARD.standardSize,
    governanceDocuments: parseInt(docs.rows[0].n, 10),
  };
}

// ─── GET /policy ──────────────────────────────────────────────────────────────
// The published rulebook: terms, the audit checklist, and the dissolution SLA.
router.get("/policy", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      terms: PERMIT_TERMS,
      maturityCriteria: MATURITY_AUDIT_CRITERIA,
      maturityPassMark: MATURITY_PASS_MARK,
      dissolutionCriteria: DISSOLUTION_AUDIT_CRITERIA,
      dissolutionTargetDays: DISSOLUTION_TARGET_DAYS,
      explanation:
        `A newly registered cooperative receives a temporary permit valid for ` +
        `${PERMIT_TERMS.temporaryYears} year. Before it expires the RCA audits the cooperative; ` +
        `a pass converts it to a permanent permit of ${PERMIT_TERMS.standardPermanentYears} years, ` +
        `or ${PERMIT_TERMS.extendedPermanentYears} years for industrial and rice-growing ` +
        `cooperatives whose investment runs longer than a standard term.`,
    },
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────
// Oversight roles see every permit; a cooperative sees its own.
router.get("/", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!isOversight(actor)) {
      if (!actor.cooperativeId) {
        return res.json({ success: true, data: [], terms: PERMIT_TERMS });
      }
      params.push(actor.cooperativeId);
      conditions.push(`p.cooperative_id = $${params.length}`);
    } else if (req.query.cooperativeId) {
      params.push(req.query.cooperativeId);
      conditions.push(`p.cooperative_id = $${params.length}`);
    }
    // A sector officer only supervises their own sector.
    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`c.sector = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`p.status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`p.permit_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_PERMIT} ${where}
       ORDER BY CASE WHEN p.status = 'active' THEN 0 ELSE 1 END, p.expires_on ASC`,
      params
    );

    const data = result.rows.map((p) => ({
      ...p,
      days_until_expiry: daysUntil(p.expires_on),
      audit_due: p.permit_type === "temporary" && daysUntil(p.expires_on) <= PERMIT_TERMS.auditLeadDays,
    }));

    res.json({ success: true, data, terms: PERMIT_TERMS });
  } catch (err) {
    console.error("GET /permits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /due ─────────────────────────────────────────────────────────────────
// The RCA's conversion queue: temporary permits close enough to expiry that the
// maturity audit should be opened, and permits already lapsed.
router.get("/due", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !isOversight(actor)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const params: unknown[] = [PERMIT_TERMS.auditLeadDays];
    let sectorFilter = "";
    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      sectorFilter = ` AND c.sector = $${params.length}`;
    }

    const result = await query(
      `${SELECT_PERMIT}
        WHERE p.status = 'active'
          AND p.permit_type = 'temporary'
          AND p.expires_on <= CURRENT_DATE + ($1 || ' days')::interval
          ${sectorFilter}
        ORDER BY p.expires_on ASC`,
      params
    );

    const data = [];
    for (const permit of result.rows) {
      const openAudit = await query(
        `SELECT id, reference, status FROM rca_audits
          WHERE permit_id = $1 AND status IN ('scheduled','in_progress')
          ORDER BY created_at DESC LIMIT 1`,
        [permit.id]
      );
      data.push({
        ...permit,
        days_until_expiry: daysUntil(permit.expires_on),
        expired: daysUntil(permit.expires_on) < 0,
        open_audit: openAudit.rows[0] ?? null,
      });
    }

    res.json({
      success: true,
      data,
      leadDays: PERMIT_TERMS.auditLeadDays,
      note:
        `Temporary permits expiring within ${PERMIT_TERMS.auditLeadDays} days. ` +
        "Open the maturity audit before expiry — a cooperative left to lapse has to re-register.",
    });
  } catch (err) {
    console.error("GET /permits/due error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /audits ──────────────────────────────────────────────────────────────
router.get("/audits", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!isOversight(actor)) {
      if (!actor.cooperativeId) return res.json({ success: true, data: [] });
      params.push(actor.cooperativeId);
      conditions.push(`a.cooperative_id = $${params.length}`);
    } else if (req.query.cooperativeId) {
      params.push(req.query.cooperativeId);
      conditions.push(`a.cooperative_id = $${params.length}`);
    }
    if (actor.role === "government" && actor.oversightLevel === "sector" && actor.sector) {
      params.push(actor.sector);
      conditions.push(`c.sector = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`a.status = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`a.audit_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `${SELECT_AUDIT} ${where}
       ORDER BY CASE WHEN a.status IN ('scheduled','in_progress') THEN 0 ELSE 1 END,
                a.due_on ASC`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((a) => ({ ...a, days_until_due: daysUntil(a.due_on) })),
    });
  } catch (err) {
    console.error("GET /permits/audits error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /audits/:id ──────────────────────────────────────────────────────────
// One audit, with the criteria checklist and a freshly computed assessment so an
// officer sees the current position rather than whatever was true when it opened.
router.get("/audits/:id", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const result = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Audit not found" });
    }
    const audit = result.rows[0];
    if (!isOversight(actor) && audit.cooperative_id !== actor.cooperativeId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    let live = null;
    if (audit.audit_type === "permit_maturity") {
      const permit = await query(
        `SELECT issued_on FROM cooperative_permits WHERE id = $1`,
        [audit.permit_id]
      );
      const since =
        permit.rows[0]?.issued_on
          ? new Date(permit.rows[0].issued_on).toISOString().slice(0, 10)
          : new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const facts = await gatherMaturityFacts(audit.cooperative_id, since);
      live = { facts, assessment: assessMaturity(facts) };
    }

    res.json({
      success: true,
      data: audit,
      criteria:
        audit.audit_type === "dissolution" ? DISSOLUTION_AUDIT_CRITERIA : MATURITY_AUDIT_CRITERIA,
      passMark: MATURITY_PASS_MARK,
      live,
    });
  } catch (err) {
    console.error("GET /permits/audits/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /cooperative/:cooperativeId ──────────────────────────────────────────
// A cooperative's permit history, its audits, and how ready it looks right now.
router.get("/cooperative/:cooperativeId", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!isOversight(actor) && actor.cooperativeId !== req.params.cooperativeId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const coopRes = await query(
      `SELECT id, name, type, description, sector, registration_number, registration_date, status
         FROM cooperatives WHERE id = $1`,
      [req.params.cooperativeId]
    );
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const coop = coopRes.rows[0];

    const [permits, audits] = await Promise.all([
      query(`${SELECT_PERMIT} WHERE p.cooperative_id = $1 ORDER BY p.issued_on DESC`, [coop.id]),
      query(`${SELECT_AUDIT} WHERE a.cooperative_id = $1 ORDER BY a.opened_at DESC`, [coop.id]),
    ]);

    const current = permits.rows.find((p) => p.status === "active") ?? null;
    const term = permanentTerm(coop);

    // Readiness only means something while a temporary permit is running.
    let readiness = null;
    if (current?.permit_type === "temporary") {
      const facts = await gatherMaturityFacts(
        coop.id,
        new Date(current.issued_on).toISOString().slice(0, 10)
      );
      readiness = { facts, assessment: assessMaturity(facts) };
    }

    res.json({
      success: true,
      data: {
        cooperative: coop,
        current: current
          ? { ...current, days_until_expiry: daysUntil(current.expires_on) }
          : null,
        history: permits.rows,
        audits: audits.rows.map((a) => ({ ...a, days_until_due: daysUntil(a.due_on) })),
        permanentTermIfConverted: term,
        readiness,
        terms: PERMIT_TERMS,
      },
    });
  } catch (err) {
    console.error("GET /permits/cooperative/:cooperativeId error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /cooperative/:cooperativeId/temporary ───────────────────────────────
// Issue a temporary permit by hand. Formation approval does this automatically;
// this covers cooperatives that were already on the register before the system
// existed and have never had a permit recorded.
router.post("/cooperative/:cooperativeId/temporary", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !isRca(actor)) {
      return res.status(403).json({
        success: false,
        message: "Only the RCA issues operating permits.",
      });
    }

    const coopRes = await query(
      `SELECT id, name, type, description FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.cooperativeId]
    );
    if (coopRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Cooperative not found" });
    }
    const coop = coopRes.rows[0];

    const existing = await query(
      `SELECT permit_number, permit_type FROM cooperative_permits
        WHERE cooperative_id = $1 AND status = 'active'`,
      [coop.id]
    );
    if ((existing.rowCount ?? 0) > 0 && req.body.supersede !== true) {
      return res.status(409).json({
        success: false,
        message:
          `${coop.name} already holds an active ${existing.rows[0].permit_type} permit ` +
          `(${existing.rows[0].permit_number}). Pass supersede: true to replace it.`,
      });
    }

    const permit = await issuePermit({
      cooperativeId: coop.id,
      permitType: "temporary",
      termYears: PERMIT_TERMS.temporaryYears,
      termRule: "temporary_first_year",
      basis:
        req.body.basis ||
        `Temporary operating permit issued for ${PERMIT_TERMS.temporaryYears} year. ` +
          "A maturity audit before expiry decides whether it converts to a permanent permit.",
      issuedBy: actor.id,
    });

    await notifyCooperative(
      coop.id,
      "Temporary operating permit issued",
      `${coop.name} holds temporary permit ${permit.permitNumber}, valid until ` +
        `${new Date(permit.expiresOn).toLocaleDateString()}. The RCA will audit the cooperative ` +
        "before that date to decide on a permanent permit."
    );

    res.status(201).json({
      success: true,
      message: `Temporary permit ${permit.permitNumber} issued to ${coop.name}.`,
      data: permit,
    });
  } catch (err) {
    console.error("POST /permits/cooperative/:cooperativeId/temporary error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:permitId/request-audit ────────────────────────────────────────────
// The cooperative asks for its maturity audit rather than waiting to be chased.
router.post("/:permitId/request-audit", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated" });

    const permitRes = await query(
      `SELECT p.*, c.name AS cooperative_name
         FROM cooperative_permits p JOIN cooperatives c ON c.id = p.cooperative_id
        WHERE p.id = $1`,
      [req.params.permitId]
    );
    if (permitRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Permit not found" });
    }
    const permit = permitRes.rows[0];

    if (!isOversight(actor) && actor.cooperativeId !== permit.cooperative_id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (permit.permit_type !== "temporary" || permit.status !== "active") {
      return res.status(409).json({
        success: false,
        message: "Only an active temporary permit can be put forward for a maturity audit.",
      });
    }

    const open = await query(
      `SELECT reference FROM rca_audits
        WHERE cooperative_id = $1 AND audit_type = 'permit_maturity'
          AND status IN ('scheduled','in_progress')`,
      [permit.cooperative_id]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `A maturity audit (${open.rows[0].reference}) is already open for this cooperative.`,
      });
    }

    const facts = await gatherMaturityFacts(
      permit.cooperative_id,
      new Date(permit.issued_on).toISOString().slice(0, 10)
    );
    const assessment = assessMaturity(facts);

    const notified = await notifyRca(
      "Maturity audit requested",
      `${permit.cooperative_name} has asked for the maturity audit on temporary permit ` +
        `${permit.permit_number}, which expires ${new Date(permit.expires_on).toLocaleDateString()}. ` +
        `Automated pre-assessment: ${Math.round(assessment.score * 100)}% — recommends ` +
        `${assessment.recommended.replace(/_/g, " ")}.`
    );

    res.json({
      success: true,
      message:
        "The RCA has been notified. An officer will open the audit and may ask for documents " +
        "before it concludes.",
      data: { permit, facts, assessment },
      notifiedOfficers: notified,
    });
  } catch (err) {
    console.error("POST /permits/:permitId/request-audit error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:permitId/audit ────────────────────────────────────────────────────
// The RCA opens the maturity audit. The automated assessment is computed and
// stored on the audit so the officer starts from a position, not a blank page.
router.post("/:permitId/audit", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !isRca(actor)) {
      return res.status(403).json({
        success: false,
        message: "Only the RCA opens a maturity audit.",
      });
    }

    const permitRes = await query(
      `SELECT p.*, c.name AS cooperative_name FROM cooperative_permits p
         JOIN cooperatives c ON c.id = p.cooperative_id WHERE p.id = $1`,
      [req.params.permitId]
    );
    if (permitRes.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Permit not found" });
    }
    const permit = permitRes.rows[0];
    if (permit.permit_type !== "temporary" || permit.status !== "active") {
      return res.status(409).json({
        success: false,
        message: "Only an active temporary permit is audited for conversion.",
      });
    }

    const open = await query(
      `SELECT reference FROM rca_audits
        WHERE cooperative_id = $1 AND audit_type = 'permit_maturity'
          AND status IN ('scheduled','in_progress')`,
      [permit.cooperative_id]
    );
    if ((open.rowCount ?? 0) > 0) {
      return res.status(409).json({
        success: false,
        message: `Audit ${open.rows[0].reference} is already open for this cooperative.`,
      });
    }

    const facts = await gatherMaturityFacts(
      permit.cooperative_id,
      new Date(permit.issued_on).toISOString().slice(0, 10)
    );
    const assessment = assessMaturity(facts);

    // The audit is due either at the permit's expiry or at the standard turnaround
    // from today, whichever comes first — an audit that concludes after the permit
    // lapses is worthless.
    const standardDue = new Date(Date.now() + PERMIT_TERMS.auditTargetDays * 86_400_000);
    const permitExpiry = new Date(permit.expires_on);
    const dueOn = standardDue < permitExpiry ? standardDue : permitExpiry;

    const reference = await nextSequence("rca_audits", "reference", "AUD");
    const inserted = await query(
      `INSERT INTO rca_audits
         (reference, audit_type, cooperative_id, permit_id, status, due_on,
          scheduled_for, opened_by, ai_assessment, score)
       VALUES ($1,'permit_maturity',$2,$3,'in_progress',$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        reference,
        permit.cooperative_id,
        permit.id,
        dueOn.toISOString().slice(0, 10),
        req.body.scheduledFor || null,
        actor.id,
        JSON.stringify({ facts, assessment }),
        assessment.score,
      ]
    );

    await notifyCooperative(
      permit.cooperative_id,
      "Maturity audit opened",
      `The RCA has opened audit ${reference} on your temporary permit ${permit.permit_number}. ` +
        "Make sure your books, member register and assembly minutes are up to date on the system."
    );

    const created = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({
      success: true,
      message: `Maturity audit ${reference} opened for ${permit.cooperative_name}.`,
      data: created.rows[0],
      assessment,
      facts,
    });
  } catch (err) {
    console.error("POST /permits/:permitId/audit error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PATCH /audits/:id ────────────────────────────────────────────────────────
// Conclude a maturity audit. Passing it issues the permanent permit at the term
// the cooperative's trade earns — 30 years, or 50 for industry and rice.
router.patch("/audits/:id", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !isRca(actor)) {
      return res.status(403).json({
        success: false,
        message: "Only the RCA concludes an audit.",
      });
    }

    const found = await query(
      `SELECT a.*, c.name AS cooperative_name, c.type AS cooperative_type,
              c.description AS cooperative_description
         FROM rca_audits a JOIN cooperatives c ON c.id = a.cooperative_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Audit not found" });
    }
    const audit = found.rows[0];
    if (!["scheduled", "in_progress"].includes(audit.status)) {
      return res.status(409).json({
        success: false,
        message: `This audit is already ${audit.status}.`,
      });
    }
    if (audit.audit_type !== "permit_maturity") {
      return res.status(400).json({
        success: false,
        message:
          "This endpoint concludes maturity audits. A dissolution audit is concluded through " +
          "the cooperative request it belongs to.",
      });
    }

    const { recommendation, findings, outcomeNote } = req.body;
    const allowed = ["issue_permanent", "extend_temporary", "revoke", "deferred"];
    if (!recommendation || !allowed.includes(recommendation)) {
      return res.status(400).json({
        success: false,
        message: `recommendation must be one of: ${allowed.join(", ")}`,
      });
    }
    if (!findings || String(findings).trim().length < 20) {
      return res.status(400).json({
        success: false,
        message:
          "Record what the audit found, in at least 20 characters. The cooperative is entitled " +
          "to the reasons behind the outcome.",
      });
    }

    let resultingPermitId: string | null = null;
    let status: string;
    let message: string;

    if (recommendation === "issue_permanent") {
      const term = permanentTerm({
        type: audit.cooperative_type,
        name: audit.cooperative_name,
        description: audit.cooperative_description,
      });
      const permit = await issuePermit({
        cooperativeId: audit.cooperative_id,
        permitType: "permanent",
        termYears: term.years,
        termRule: term.rule,
        basis: `${term.basis} Converted on audit ${audit.reference}.`,
        issuedBy: actor.id,
      });
      resultingPermitId = permit.id;
      status = "passed";
      message =
        `${audit.cooperative_name} passed its maturity audit. Permanent permit ` +
        `${permit.permitNumber} issued for ${term.years} years, expiring ` +
        `${new Date(permit.expiresOn).toLocaleDateString()}.`;
      await notifyCooperative(
        audit.cooperative_id,
        "Permanent operating permit issued",
        `${audit.cooperative_name} has passed the RCA maturity audit. Permanent permit ` +
          `${permit.permitNumber} runs for ${term.years} years, to ` +
          `${new Date(permit.expiresOn).toLocaleDateString()}. ${term.basis}`
      );
    } else if (recommendation === "extend_temporary") {
      const permit = await issuePermit({
        cooperativeId: audit.cooperative_id,
        permitType: "temporary",
        termYears: PERMIT_TERMS.extensionYears,
        termRule: "extension_after_audit",
        basis:
          `Temporary permit extended by ${PERMIT_TERMS.extensionYears} year following audit ` +
          `${audit.reference}: the cooperative is operating but did not yet meet every ` +
          "conversion criterion.",
        issuedBy: actor.id,
      });
      resultingPermitId = permit.id;
      status = "deferred";
      message =
        `${audit.cooperative_name} did not yet qualify for conversion. Its temporary permit is ` +
        `extended to ${new Date(permit.expiresOn).toLocaleDateString()} and will be audited again.`;
      await notifyCooperative(
        audit.cooperative_id,
        "Temporary permit extended",
        `${audit.cooperative_name} has not yet met every conversion criterion. The temporary ` +
          `permit is extended to ${new Date(permit.expiresOn).toLocaleDateString()}. ` +
          `Findings: ${String(findings).trim()}`
      );
    } else if (recommendation === "revoke") {
      await query(
        `UPDATE cooperative_permits
            SET status = 'revoked', revoked_at = NOW(), revocation_reason = $1, updated_at = NOW()
          WHERE id = $2`,
        [String(findings).trim(), audit.permit_id]
      );
      await query(
        `UPDATE cooperatives SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
        [audit.cooperative_id]
      );
      status = "failed";
      message =
        `${audit.cooperative_name} failed its maturity audit. The temporary permit is revoked and ` +
        "the cooperative is suspended on the register.";
      await notifyCooperative(
        audit.cooperative_id,
        "Operating permit revoked",
        `Following RCA audit ${audit.reference}, the temporary permit held by ` +
          `${audit.cooperative_name} has been revoked and the cooperative suspended. ` +
          `Findings: ${String(findings).trim()}`
      );
    } else {
      status = "deferred";
      message = `Audit ${audit.reference} deferred. The permit is unchanged.`;
    }

    await query(
      `UPDATE rca_audits
          SET status = $1, recommendation = $2, findings = $3, outcome_note = $4,
              concluded_by = $5, concluded_at = NOW(), resulting_permit_id = $6, updated_at = NOW()
        WHERE id = $7`,
      [
        status,
        recommendation === "deferred" ? "none" : recommendation,
        String(findings).trim(),
        outcomeNote ? String(outcomeNote).trim() : null,
        actor.id,
        resultingPermitId,
        audit.id,
      ]
    );

    // Keep the outcome alongside the other model output so it surfaces in AI Insights.
    await query(
      `INSERT INTO ai_insights
         (cooperative_id, type, severity, title, summary, detail, affected_metric,
          model_name, confidence, resolved, generated_at)
       VALUES ($1,'insight',$2,$3,$4,$5,'Permit Status','MaturityAuditRules v1.0',0.9,true,NOW())`,
      [
        audit.cooperative_id,
        status === "failed" ? "critical" : status === "passed" ? "info" : "warning",
        `Maturity audit ${audit.reference} — ${audit.cooperative_name}`,
        message,
        String(findings).trim(),
      ]
    );

    const updated = await query(`${SELECT_AUDIT} WHERE a.id = $1`, [audit.id]);
    res.json({ success: true, message, data: updated.rows[0] });
  } catch (err) {
    console.error("PATCH /permits/audits/:id error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /expire-lapsed ──────────────────────────────────────────────────────
// Marks permits whose expiry has passed. Called from the monthly audit run so the
// register does not quietly carry permits that ran out months ago.
router.post("/expire-lapsed", async (req: Request, res: Response) => {
  try {
    const actor = await loadActor(req.user!.userId);
    if (!actor || !isRca(actor)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const expired = await query(
      `UPDATE cooperative_permits
          SET status = 'expired', updated_at = NOW()
        WHERE status = 'active' AND expires_on < CURRENT_DATE
        RETURNING id, cooperative_id, permit_number`
    );
    for (const p of expired.rows) {
      await notifyCooperative(
        p.cooperative_id,
        "Operating permit expired",
        `Permit ${p.permit_number} has passed its expiry date without conversion or renewal. ` +
          "Contact your sector cooperative officer immediately."
      );
    }

    res.json({
      success: true,
      message: `${expired.rowCount ?? 0} permit(s) marked expired.`,
      data: expired.rows,
    });
  } catch (err) {
    console.error("POST /permits/expire-lapsed error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
