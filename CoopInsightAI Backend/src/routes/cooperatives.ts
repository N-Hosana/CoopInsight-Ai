import { Router, Request, Response } from "express";
import { query } from "../config/db";
import { authenticate, authorize } from "../middleware/auth";
import path from "path";
import fs from "fs";
import { uploadDocument, buildFileUrl, UPLOAD_ROOT } from "../middleware/upload";
import { writableCooperative } from "../services/cooperativeAccess";

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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGISTER, IN FIVE CATEGORIES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The register used to be sliced nine ways, and several of the slices were the
 * same answer to the officer's real question — "can this cooperative operate?" —
 * given for different reasons. They are now five categories that do not overlap,
 * and the "not active" one carries the reason for each cooperative in it:
 *
 *   active        on the register, operating on a permanent permit, nothing
 *                 holding it back and not flagged by the monthly audit
 *   not_active    on the register but not operating normally — see the reasons
 *   at_risk       otherwise active, but banded at risk or critical by the
 *                 latest monthly audit
 *   applications  formation requests: groups not on the register yet
 *   dissolved     struck off; kept because the history matters
 *
 * Every cooperative still on the register falls in exactly one of active,
 * not_active and at_risk. A cooperative can have several reasons for being not
 * active (suspended AND without a permit); its primary reason is the first one
 * in the list below, and all of them are returned on the row.
 */
interface RegistryView {
  id: string;
  label: string;
  description: string;
  /** Selects cooperative rows; empty for views that are not cooperatives at all. */
  condition: string | null;
  /** True for views that list REQUESTS rather than registered cooperatives. */
  requestsOnly?: "formation" | "dissolution";
}

interface InactiveReason {
  id: string;
  label: string;
  description: string;
  condition: string;
}

const ACTIVE_PERMIT = `
  EXISTS (SELECT 1 FROM cooperative_permits p
           WHERE p.cooperative_id = c.id AND p.status = 'active'
             AND p.expires_on >= CURRENT_DATE)`;

/** Why a cooperative on the register is not active, most decisive first. */
export const INACTIVE_REASONS: InactiveReason[] = [
  {
    id: "under_final_audit",
    label: "Under final RCA audit",
    description:
      "An RCA audit (dissolution, permit maturity or compliance) is open and its outcome decides " +
      "whether the cooperative continues.",
    condition: `EXISTS (SELECT 1 FROM rca_audits ra
                         WHERE ra.cooperative_id = c.id AND ra.status IN ('scheduled','in_progress'))`,
  },
  {
    id: "dissolving",
    label: "Dissolution in progress",
    description:
      "The members have voted to dissolve and the request is in the sector → district → RCA chain. " +
      "It stays on the register until the RCA strikes it off.",
    condition: `EXISTS (SELECT 1 FROM cooperative_requests dr
                         WHERE dr.cooperative_id = c.id AND dr.request_type = 'dissolution'
                           AND dr.status LIKE 'pending%')`,
  },
  {
    id: "suspended",
    label: "Suspended",
    description: "Suspended from operating by the supervising authority.",
    condition: `c.status = 'suspended'`,
  },
  {
    id: "marked_inactive",
    label: "Marked inactive",
    description: "Recorded on the register as inactive — no longer operating.",
    condition: `c.status = 'inactive'`,
  },
  {
    id: "no_permit",
    label: "No permit in force",
    description:
      "No operating permit in force — expired, revoked or never issued. Trading without a licence.",
    condition: `NOT ${ACTIVE_PERMIT}`,
  },
  {
    id: "temporary_permit",
    label: "No permanent permit",
    description:
      "Only the one-year temporary permit issued at registration. Needs an RCA maturity audit " +
      "before it receives a permanent permit.",
    condition: `
      EXISTS (SELECT 1 FROM cooperative_permits p
               WHERE p.cooperative_id = c.id AND p.status = 'active'
                 AND p.permit_type = 'temporary' AND p.expires_on >= CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM cooperative_permits p
               WHERE p.cooperative_id = c.id AND p.status = 'active'
                 AND p.permit_type = 'permanent' AND p.expires_on >= CURRENT_DATE)`,
  },
];

const ANY_INACTIVE = `(${INACTIVE_REASONS.map((r) => `(${r.condition})`).join(" OR ")})`;

const AUDIT_FLAGGED = `
  EXISTS (
    SELECT 1 FROM cooperative_monthly_audits a
     WHERE a.cooperative_id = c.id
       AND a.band IN ('at_risk','critical')
       AND a.period = (SELECT MAX(period) FROM cooperative_monthly_audits))`;

/** Every reason that applies to a row, in priority order, as a text[]. */
const INACTIVE_REASONS_SQL = `ARRAY_REMOVE(ARRAY[${INACTIVE_REASONS.map(
  (r) => `CASE WHEN ${r.condition} THEN '${r.id}' END`
).join(", ")}]::text[], NULL)`;

export const REGISTRY_VIEWS: RegistryView[] = [
  {
    id: "active",
    label: "Active",
    description:
      "Operating on a permanent permit, with no suspension, audit or dissolution holding it back, " +
      "and not flagged by the latest monthly audit.",
    condition: `c.deleted_at IS NULL AND NOT ${ANY_INACTIVE} AND NOT ${AUDIT_FLAGGED}`,
  },
  {
    id: "not_active",
    label: "Not active",
    description:
      "On the register but not operating normally. Each cooperative shows why: suspended, no " +
      "permit in force, no permanent permit, dissolution in progress, under final RCA audit, or " +
      "marked inactive.",
    condition: `c.deleted_at IS NULL AND ${ANY_INACTIVE}`,
  },
  {
    id: "at_risk",
    label: "Active, at risk",
    description:
      "Otherwise active, but banded at risk or critical by the most recent monthly audit — they " +
      "look like they are going quiet.",
    condition: `c.deleted_at IS NULL AND NOT ${ANY_INACTIVE} AND ${AUDIT_FLAGGED}`,
  },
  {
    id: "applications",
    label: "Applications",
    description:
      "Groups applying to become cooperatives. They are not on the register yet — each is a " +
      "formation request somewhere in the sector, district or RCA chain.",
    condition: null,
    requestsOnly: "formation",
  },
  {
    id: "dissolved",
    label: "Dissolved",
    description:
      "Struck off the register. Kept because their history, their members and their accounts " +
      "still have to be answerable for.",
    condition: `c.deleted_at IS NOT NULL`,
  },
];

/** Not a category — the whole register, for callers that ask for it by id. */
const ALL_VIEW: RegistryView = {
  id: "all",
  label: "All on the register",
  description: "Every cooperative currently on the register.",
  condition: `c.deleted_at IS NULL`,
};

const viewById = (id: string) =>
  id === "all" ? ALL_VIEW : REGISTRY_VIEWS.find((v) => v.id === id);

// ─── GET /registry ─────────────────────────────────────────────────────────
// The tab strip: every view, what it means, and how many are in it. One query
// per view rather than one clever query, because each view answers a different
// question and a union of them would be unreadable for no measurable gain on a
// district-sized register.
router.get("/registry", async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    const restrictToOwn = ["manager", "cooperative", "member"].includes(role);
    const userCoopId = req.user!.cooperativeId;

    // Sector officers see their own sector; everyone above sees the district.
    const actor = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [
      req.user!.userId,
    ]);
    const sectorScope =
      actor.rows[0]?.oversight_level === "sector" ? (actor.rows[0].sector as string | null) : null;

    const counts: Record<string, number> = {};
    for (const view of REGISTRY_VIEWS) {
      if (view.requestsOnly) {
        const params: unknown[] = [view.requestsOnly];
        let clause = "";
        if (sectorScope) {
          params.push(sectorScope);
          clause = ` AND r.sector = $${params.length}`;
        }
        if (restrictToOwn && userCoopId) {
          params.push(userCoopId);
          clause += ` AND r.cooperative_id = $${params.length}`;
        }
        const result = await query(
          `SELECT COUNT(*) AS n FROM cooperative_requests r
            WHERE r.request_type = $1 AND r.status LIKE 'pending%'${clause}`,
          params
        );
        counts[view.id] = parseInt(result.rows[0].n, 10);
        continue;
      }

      const params: unknown[] = [];
      let clause = "";
      if (sectorScope) {
        params.push(sectorScope);
        clause += ` AND c.sector = $${params.length}`;
      }
      if (restrictToOwn && userCoopId) {
        params.push(userCoopId);
        clause += ` AND c.id = $${params.length}`;
      }
      const result = await query(
        `SELECT COUNT(*) AS n FROM cooperatives c WHERE ${view.condition}${clause}`,
        params
      );
      counts[view.id] = parseInt(result.rows[0].n, 10);
    }

    // The breakdown of "not active". A cooperative with two reasons is counted
    // under both, so these can add up to more than the category's total.
    const scopeParams: unknown[] = [];
    let scopeClause = "";
    if (sectorScope) {
      scopeParams.push(sectorScope);
      scopeClause += ` AND c.sector = $${scopeParams.length}`;
    }
    if (restrictToOwn && userCoopId) {
      scopeParams.push(userCoopId);
      scopeClause += ` AND c.id = $${scopeParams.length}`;
    }
    const reasonCounts = await query(
      `SELECT ${INACTIVE_REASONS.map(
        (r) => `COUNT(*) FILTER (WHERE ${r.condition}) AS "${r.id}"`
      ).join(", ")},
              COUNT(*) AS total
         FROM cooperatives c WHERE c.deleted_at IS NULL${scopeClause}`,
      scopeParams
    );
    const rc = reasonCounts.rows[0];

    res.json({
      success: true,
      data: REGISTRY_VIEWS.map((view) => ({
        id: view.id,
        label: view.label,
        description: view.description,
        kind: view.requestsOnly ? "requests" : "cooperatives",
        count: counts[view.id] ?? 0,
        reasons:
          view.id === "not_active"
            ? INACTIVE_REASONS.map((r) => ({
                id: r.id,
                label: r.label,
                description: r.description,
                count: parseInt(rc[r.id], 10),
              }))
            : undefined,
      })),
      onRegister: parseInt(rc.total, 10),
      scope: sectorScope ? { sector: sectorScope } : { district: "Gasabo" },
    });
  } catch (err) {
    console.error("GET /cooperatives/registry error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /registry/breakdown ───────────────────────────────────────────────
// The five categories counted per sector or per district, for the level that
// supervises them: the district office reads its sectors, the RCA reads its
// districts (each with its sectors underneath). A sector officer gets their own
// sector only. `by` overrides the default grouping.
router.get("/registry/breakdown", async (req: Request, res: Response) => {
  try {
    const actorRes = await query(`SELECT role, sector, oversight_level FROM users WHERE id = $1`, [
      req.user!.userId,
    ]);
    const actor = actorRes.rows[0];
    if (!actor || !["government", "admin", "generalManager"].includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: "The sector and district breakdown is for oversight officers.",
      });
    }
    const sectorScope = actor.oversight_level === "sector" ? (actor.sector as string | null) : null;
    const defaultBy = actor.oversight_level === "district" || sectorScope ? "sector" : "district";
    const by = sectorScope ? "sector" : req.query.by === "sector" || req.query.by === "district"
      ? (req.query.by as "sector" | "district")
      : defaultBy;

    const params: unknown[] = [];
    let scope = "";
    if (sectorScope) {
      params.push(sectorScope);
      scope = `WHERE c.sector = $1`;
    }

    const categoryViews = REGISTRY_VIEWS.filter((v) => v.condition);
    const cells = await query(
      `SELECT c.district, c.sector,
              ${categoryViews.map((v) => `COUNT(*) FILTER (WHERE ${v.condition}) AS "${v.id}"`).join(",\n              ")},
              ${INACTIVE_REASONS.map(
                (r) => `COUNT(*) FILTER (WHERE c.deleted_at IS NULL AND ${r.condition}) AS "reason_${r.id}"`
              ).join(",\n              ")}
         FROM cooperatives c ${scope}
        GROUP BY c.district, c.sector`,
      params
    );
    const applications = await query(
      `SELECT r.district, r.sector, COUNT(*) AS n FROM cooperative_requests r
        WHERE r.request_type = 'formation' AND r.status LIKE 'pending%'
          ${sectorScope ? "AND r.sector = $1" : ""}
        GROUP BY r.district, r.sector`,
      params
    );

    type Counts = Record<string, number>;
    type Group = {
      key: string;
      name: string;
      level: "district" | "sector";
      district: string;
      counts: Counts;
      onRegister: number;
      reasons: Counts;
      children?: Group[];
    };
    const emptyCounts = (): Counts =>
      Object.fromEntries(REGISTRY_VIEWS.map((v) => [v.id, 0]));
    const emptyReasons = (): Counts =>
      Object.fromEntries(INACTIVE_REASONS.map((r) => [r.id, 0]));

    // One cell per (district, sector).
    const cellMap = new Map<string, Group>();
    const cell = (district: string, sector: string) => {
      const key = `${district}::${sector}`;
      let g = cellMap.get(key);
      if (!g) {
        g = { key: sector, name: sector, level: "sector", district, counts: emptyCounts(), onRegister: 0, reasons: emptyReasons() };
        cellMap.set(key, g);
      }
      return g;
    };
    for (const row of cells.rows) {
      const g = cell(row.district, row.sector);
      for (const v of categoryViews) g.counts[v.id] += parseInt(row[v.id], 10);
      for (const r of INACTIVE_REASONS) g.reasons[r.id] += parseInt(row[`reason_${r.id}`], 10);
    }
    for (const row of applications.rows) {
      cell(row.district, row.sector).counts.applications += parseInt(row.n, 10);
    }
    for (const g of cellMap.values()) {
      g.onRegister = g.counts.active + g.counts.not_active + g.counts.at_risk;
    }

    const add = (into: Group, from: Group) => {
      for (const k of Object.keys(into.counts)) into.counts[k] += from.counts[k];
      for (const k of Object.keys(into.reasons)) into.reasons[k] += from.reasons[k];
      into.onRegister += from.onRegister;
    };
    const byName = (a: Group, b: Group) => a.name.localeCompare(b.name);

    let groups: Group[];
    if (by === "district") {
      const districts = new Map<string, Group>();
      for (const c of cellMap.values()) {
        let d = districts.get(c.district);
        if (!d) {
          d = { key: c.district, name: c.district, level: "district", district: c.district, counts: emptyCounts(), onRegister: 0, reasons: emptyReasons(), children: [] };
          districts.set(c.district, d);
        }
        add(d, c);
        d.children!.push(c);
      }
      groups = [...districts.values()].sort(byName);
      groups.forEach((d) => d.children!.sort(byName));
    } else {
      // Sectors are named uniquely within a district; across districts the
      // same name is a different sector, so it keeps its own row.
      groups = [...cellMap.values()].sort(byName);
    }

    const total = { key: "total", name: "Total", level: by, district: "", counts: emptyCounts(), onRegister: 0, reasons: emptyReasons() } as Group;
    for (const c of cellMap.values()) add(total, c);

    res.json({
      success: true,
      data: {
        by,
        groups,
        total,
        categories: REGISTRY_VIEWS.map((v) => ({ id: v.id, label: v.label })),
        reasons: INACTIVE_REASONS.map((r) => ({ id: r.id, label: r.label })),
        scope: sectorScope ? { sector: sectorScope } : null,
      },
    });
  } catch (err) {
    console.error("GET /cooperatives/registry/breakdown error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DOCUMENT CATEGORIES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `cooperative_documents.type` stores six raw values. Six is too many to scan
 * and the wrong six to think in — nobody looks for "a policy", they look for
 * "the governing documents" or "the books". These are the groupings an officer
 * actually asks for, each mapping to the raw types that belong in it.
 */
export const DOCUMENT_CATEGORIES = [
  {
    id: "registration",
    label: "Registration & legal",
    description:
      "What makes the cooperative a legal person: the certificate, bylaws, constitution, " +
      "licences and operating permits.",
    types: ["registration", "policy"],
  },
  {
    id: "financial",
    label: "Financial records",
    description:
      "The books — accounts, balance sheets, audit files and anything showing where the money went.",
    types: ["financial"],
  },
  {
    id: "governance",
    label: "Meetings & governance",
    description:
      "Minutes of general assemblies and committee meetings, elections, and resolutions.",
    types: ["minutes"],
  },
  {
    id: "reports",
    label: "Reports & returns",
    description: "Reports filed to the sector, the district or the RCA.",
    types: ["report"],
  },
  {
    id: "other",
    label: "Other",
    description: "Anything that does not belong to the categories above.",
    types: ["other"],
  },
];

// ─── GET /documents/all ────────────────────────────────────────────────────
// Every document in the caller's scope, grouped by category.
//
// The Documents page was bound to `user.cooperativeId`, so it showed an officer
// nothing at all: sector, district and RCA officers are not attached to a
// cooperative, which is exactly why they need a view across several. Scope
// follows the same rule as everything else — a sector officer sees their own
// sector, the district office and the RCA see the district, a manager or member
// sees their own cooperative.
router.get("/documents/all", async (req: Request, res: Response) => {
  try {
    const actor = await query(
      `SELECT role, sector, oversight_level, cooperative_id FROM users WHERE id = $1`,
      [req.user!.userId]
    );
    const me = actor.rows[0];
    if (!me) return res.status(401).json({ success: false, message: "Not authenticated" });

    const params: unknown[] = [];
    let scope = "";

    if (["manager", "cooperative", "member"].includes(me.role)) {
      if (!me.cooperative_id) {
        return res.json({ success: true, data: [], categories: DOCUMENT_CATEGORIES, scope: "none" });
      }
      params.push(me.cooperative_id);
      scope = `AND c.id = $${params.length}`;
    } else if (me.role === "government" && me.oversight_level === "sector" && me.sector) {
      params.push(me.sector);
      scope = `AND c.sector = $${params.length}`;
    }
    // District, RCA, admin and generalManager see the whole district.

    const { category, cooperativeId, search } = req.query;

    if (cooperativeId) {
      params.push(cooperativeId);
      scope += ` AND c.id = $${params.length}`;
    }
    if (category) {
      const spec = DOCUMENT_CATEGORIES.find((c) => c.id === category);
      if (spec) {
        params.push(spec.types);
        scope += ` AND d.type = ANY($${params.length}::text[])`;
      }
    }
    if (search) {
      params.push(`%${search}%`);
      scope += ` AND (d.name ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
    }

    const result = await query(
      `SELECT d.id, d.name, d.type, d.description, d.url, (d.url IS NOT NULL) AS has_file, d.size_bytes, d.uploaded_at,
              c.id AS cooperative_id, c.name AS cooperative_name, c.sector,
              u.name AS uploaded_by_name
         FROM cooperative_documents d
         JOIN cooperatives c ON c.id = d.cooperative_id
         LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE c.deleted_at IS NULL ${scope}
        ORDER BY d.uploaded_at DESC
        LIMIT 500`,
      params
    );

    // Counts per category, so the filter chips carry their own evidence and
    // an empty category is visibly empty rather than simply absent.
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      const spec = DOCUMENT_CATEGORIES.find((c) => c.types.includes(row.type));
      const id = spec?.id ?? "other";
      counts[id] = (counts[id] ?? 0) + 1;
    }

    res.json({
      success: true,
      data: result.rows,
      categories: DOCUMENT_CATEGORIES.map((c) => ({ ...c, count: counts[c.id] ?? 0 })),
      scope:
        ["manager", "cooperative", "member"].includes(me.role)
          ? "cooperative"
          : me.oversight_level === "sector"
            ? "sector"
            : "district",
      sector: me.oversight_level === "sector" ? me.sector : null,
      total: result.rowCount,
    });
  } catch (err) {
    console.error("GET /cooperatives/documents/all error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET / ─────────────────────────────────────────────────────────────────
// The register itself. `view` picks one of the slices above; `status`, `sector`,
// `type` and `search` narrow it further.
//
// Every row now carries its permit and whether a request is open against it,
// because "which of these is unlicensed" is a question the list is supposed to
// answer at a glance rather than one row at a time.
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sector, district, type, status, search, view = "all", reason, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const role = req.user!.role;
    const userCoopId = req.user!.cooperativeId;

    const selected = viewById(String(view)) ?? viewById("all")!;
    if (selected.requestsOnly) {
      return res.status(400).json({
        success: false,
        message:
          `"${selected.label}" lists requests, not registered cooperatives. Read it from ` +
          `GET /api/cooperative-requests?type=${selected.requestsOnly}.`,
        redirectTo: `/api/cooperative-requests?type=${selected.requestsOnly}`,
      });
    }

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

    // A sector officer sees their own sector, as the category counts already
    // assume. The list ignored it, so a count of 3 could open onto 12 rows.
    const actorRow = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [
      req.user!.userId,
    ]);
    const officerSector =
      actorRow.rows[0]?.oversight_level === "sector" ? (actorRow.rows[0].sector as string | null) : null;
    const extraFilters: Array<[string, unknown]> = [];
    if (officerSector) extraFilters.push(["c.sector", officerSector]);
    if (district) extraFilters.push(["c.district", district]);
    for (const [column, value] of extraFilters) {
      params.push(value);
      scopeClause += ` AND ${column} = $${params.length}`;
    }

    // Narrow "not active" to one reason. The condition is our own SQL, chosen
    // by id, so nothing from the query string reaches the statement.
    const reasonSpec = reason ? INACTIVE_REASONS.find((r) => r.id === reason) : undefined;
    if (reason && !reasonSpec) {
      return res.status(400).json({
        success: false,
        message: `reason must be one of: ${INACTIVE_REASONS.map((r) => r.id).join(", ")}`,
      });
    }
    const reasonClause = reasonSpec ? `AND (${reasonSpec.condition})` : "";

    // Permit and open-request facts, as scalar sub-selects rather than joins:
    // the row is already grouped over members and leadership, and adding two
    // more join fan-outs to that GROUP BY is how the member count silently
    // multiplies.
    const dataQuery = `
      SELECT c.*,
        COUNT(DISTINCT m.id) AS member_count,
        -- A scalar subquery, NOT a FILTER over the join above: archiving a
        -- member sets deleted_at, and the join already excludes those rows, so
        -- a FILTER here would count them as zero forever.
        (SELECT COUNT(*) FROM members am
          WHERE am.cooperative_id = c.id AND am.archived_at IS NOT NULL) AS archived_member_count,
        COALESCE(json_agg(DISTINCT cl.*) FILTER (WHERE cl.id IS NOT NULL), '[]') AS leadership,
        (SELECT row_to_json(p) FROM (
           SELECT cp.permit_number, cp.permit_type, cp.status, cp.issued_on, cp.expires_on
             FROM cooperative_permits cp
            WHERE cp.cooperative_id = c.id
            ORDER BY CASE WHEN cp.status = 'active' THEN 0 ELSE 1 END, cp.expires_on DESC
            LIMIT 1) p) AS permit,
        (SELECT row_to_json(q) FROM (
           SELECT cr.id, cr.reference, cr.request_type, cr.status, cr.current_stage
             FROM cooperative_requests cr
            WHERE cr.cooperative_id = c.id AND cr.status LIKE 'pending%'
            ORDER BY cr.created_at DESC LIMIT 1) q) AS open_request,
        (SELECT a.band FROM cooperative_monthly_audits a
          WHERE a.cooperative_id = c.id ORDER BY a.period DESC LIMIT 1) AS audit_band,
        (SELECT row_to_json(oa) FROM (
           SELECT ra.reference, ra.audit_type, ra.status, ra.due_on
             FROM rca_audits ra
            WHERE ra.cooperative_id = c.id AND ra.status IN ('scheduled','in_progress')
            ORDER BY ra.opened_at DESC LIMIT 1) oa) AS open_audit,
        ${INACTIVE_REASONS_SQL} AS inactive_reasons
      FROM cooperatives c
      LEFT JOIN members m ON m.cooperative_id = c.id AND m.deleted_at IS NULL
      LEFT JOIN cooperative_leadership cl ON cl.cooperative_id = c.id
      WHERE ${selected.condition}
        AND ($1::text IS NULL OR c.sector = $1)
        AND ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.registration_number ILIKE '%' || $4 || '%')
        ${scopeClause}
        ${reasonClause}
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
    for (const [column, value] of extraFilters) {
      countParams.push(value);
      countScopeClause += ` AND ${column} = $${countParams.length}`;
    }

    const countQuery = `
      SELECT COUNT(DISTINCT c.id) AS total
      FROM cooperatives c
      WHERE ${selected.condition}
        AND ($1::text IS NULL OR c.sector = $1)
        AND ($2::text IS NULL OR c.type = $2)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.registration_number ILIKE '%' || $4 || '%')
        ${countScopeClause}
        ${reasonClause}
    `;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, params),
      query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      success: true,
      data: dataResult.rows,
      view: { id: selected.id, label: selected.label, description: selected.description },
      reason: reasonSpec ? { id: reasonSpec.id, label: reasonSpec.label } : null,
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

    if (!(await canReadCooperative(req, id))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const result = await query(
      `SELECT *, (url IS NOT NULL) AS has_file FROM cooperative_documents
        WHERE cooperative_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET /cooperatives/:id/documents error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/** Whether the caller may read a cooperative's records: its own people, its sector officer, everyone above. */
async function canReadCooperative(req: Request, cooperativeId: string): Promise<boolean> {
  const role = req.user!.role;
  if (["manager", "cooperative", "member"].includes(role)) return req.user!.cooperativeId === cooperativeId;
  if (role === "government") {
    const me = await query(`SELECT sector, oversight_level FROM users WHERE id = $1`, [req.user!.userId]);
    if (me.rows[0]?.oversight_level === "sector") {
      const c = await query(`SELECT 1 FROM cooperatives WHERE id = $1 AND sector = $2`, [cooperativeId, me.rows[0].sector]);
      return (c.rowCount ?? 0) > 0;
    }
  }
  return true;
}

/** The file on disk behind a stored document URL, or null if it is not one of ours. */
function localFileFor(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf("/uploads/");
  if (at < 0) return null;
  const relative = decodeURIComponent(url.slice(at + "/uploads/".length));
  const full = path.resolve(UPLOAD_ROOT, relative);
  // Never serve anything outside the upload directory.
  return full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep) && fs.existsSync(full) ? full : null;
}

// ─── GET /:id/documents/:docId/file ──────────────────────────────────────────
// The document itself, opened in the browser.
//
// The seeded register pointed every document at a placeholder address that
// does not exist, so "View" opened a "can't reach this page" screen. A document
// whose original has not been uploaded now says so instead of linking nowhere,
// and an uploaded one is served from here, behind the same access rule as the
// list — a member reads their own cooperative's file and nobody else's.
router.get("/:id/documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const { id, docId } = req.params;
    if (!(await canReadCooperative(req, id))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const found = await query(
      `SELECT name, url FROM cooperative_documents WHERE id = $1 AND cooperative_id = $2`,
      [docId, id]
    );
    if (found.rowCount === 0) return res.status(404).json({ success: false, message: "Document not found" });
    const doc = found.rows[0];
    if (!doc.url) {
      return res.status(404).json({
        success: false,
        message: `The original of "${doc.name}" has not been uploaded yet. The cooperative's manager can attach it.`,
        fileMissing: true,
      });
    }
    const local = localFileFor(doc.url);
    if (local) {
      const ext = path.extname(local);
      const safeName = String(doc.name).replace(/[^\w\s.-]/g, "").trim() || "document";
      res.setHeader(
        "Content-Disposition",
        `${req.query.download === "1" ? "attachment" : "inline"}; filename="${safeName}${ext}"`
      );
      return res.sendFile(local);
    }
    if (/^https?:\/\//.test(doc.url) && !doc.url.includes("/uploads/")) {
      return res.redirect(doc.url);
    }
    return res.status(404).json({
      success: false,
      message: `The file for "${doc.name}" is no longer on the server. The cooperative's manager can attach it again.`,
      fileMissing: true,
    });
  } catch (err) {
    console.error("GET /cooperatives/:id/documents/:docId/file error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── PUT /:id/documents/:docId/file ──────────────────────────────────────────
// Attach (or replace) the file behind an existing document entry — how a
// register entry whose original was never uploaded gets its file.
router.put("/:id/documents/:docId/file", uploadDocument.single("file"), async (req: Request, res: Response) => {
  try {
    const { id, docId } = req.params;
    const access = writableCooperative(req, id);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required" });

    const updated = await query(
      `UPDATE cooperative_documents
          SET url = $1, size_bytes = $2, uploaded_by = $3, uploaded_at = NOW()
        WHERE id = $4 AND cooperative_id = $5
        RETURNING *, (url IS NOT NULL) AS has_file`,
      [buildFileUrl(req, "documents", req.file.filename), req.file.size, req.user!.userId, docId, id]
    );
    if (updated.rowCount === 0) return res.status(404).json({ success: false, message: "Document not found" });
    res.json({ success: true, message: `File attached to "${updated.rows[0].name}".`, data: updated.rows[0] });
  } catch (err) {
    console.error("PUT /cooperatives/:id/documents/:docId/file error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── POST /:id/documents ──────────────────────────────────────────────────────
router.post("/:id/documents", uploadDocument.single("file"), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, description } = req.body;

    // Only the cooperative's own manager (or an administrator) files to it.
    const access = writableCooperative(req, id);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });

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
    const access = writableCooperative(req, id);
    if (!access.ok) return res.status(access.status).json({ success: false, message: access.message });

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

// ─── GET /:id/record-status ─────────────────────────────────────────────────
// What the cooperative has recorded, and when it last did, for each kind of
// record the monthly audit and the oversight officers read. The manager keeps
// these books; this is the checklist that tells them which are going stale
// before the audit says so.
router.get("/:id/record-status", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = req.user!.role;
    if (["manager", "cooperative", "member"].includes(role) && req.user!.cooperativeId !== id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const r = await query(
      `SELECT
         (SELECT MAX(date) FROM transactions WHERE cooperative_id = $1 AND status = 'completed') AS last_transaction,
         (SELECT COUNT(*) FROM transactions WHERE cooperative_id = $1 AND status = 'completed'
            AND date >= CURRENT_DATE - INTERVAL '30 days') AS transactions_30d,
         (SELECT MAX(mc.date) FROM member_contributions mc JOIN members m ON m.id = mc.member_id
           WHERE m.cooperative_id = $1) AS last_contribution,
         (SELECT COUNT(DISTINCT mc.member_id) FROM member_contributions mc JOIN members m ON m.id = mc.member_id
           WHERE m.cooperative_id = $1 AND m.deleted_at IS NULL
             AND mc.date >= CURRENT_DATE - INTERVAL '3 months') AS contributors_quarter,
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL) AS members,
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active') AS active_members,
         (SELECT MAX(date) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'completed') AS last_activity,
         (SELECT COUNT(*) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND status = 'planned' AND date >= CURRENT_DATE) AS upcoming_activities,
         (SELECT COUNT(*) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND status = 'planned' AND date < CURRENT_DATE) AS overdue_activities,
         (SELECT COUNT(*) FROM activities a WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL
            AND a.status = 'completed' AND a.date >= CURRENT_DATE - INTERVAL '6 months'
            AND NOT EXISTS (SELECT 1 FROM activity_participants ap WHERE ap.activity_id = a.id AND ap.attended)
         ) AS completed_without_attendance,
         (SELECT COUNT(*) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND type = 'meeting' AND status = 'completed'
            AND EXTRACT(MONTH FROM date)::int IN (3, 10)
            AND date >= CURRENT_DATE - INTERVAL '12 months') AS ordinary_assemblies,
         (SELECT MAX(period_end) FROM balance_sheets WHERE cooperative_id = $1) AS last_balance_sheet,
         (SELECT COUNT(*) FROM cooperative_documents WHERE cooperative_id = $1) AS documents,
         (SELECT COUNT(*) FROM cooperative_leadership l
           WHERE l.cooperative_id = $1 AND (l.end_date IS NULL OR l.end_date > CURRENT_DATE)
             AND l.role <> 'Sector Cooperative Officer'
             AND l.name IS NOT NULL AND l.name <> '(Name not recorded)') AS board_seats`,
      [id]
    );
    const s = r.rows[0];
    const n = (v: unknown) => parseInt(String(v ?? 0), 10);
    const days = (d: string | Date | null) =>
      d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;
    const fmt = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

    type Status = "ok" | "due" | "missing";
    const item = (
      key: string,
      label: string,
      status: Status,
      detail: string,
      action: { label: string; path: string },
      last: string | null = null
    ) => ({ key, label, status, detail, last, action });

    const txDays = days(s.last_transaction);
    const coDays = days(s.last_contribution);
    const actDays = days(s.last_activity);
    const bsDays = days(s.last_balance_sheet);
    const board = n(s.board_seats);
    const assemblies = n(s.ordinary_assemblies);
    const overdue = n(s.overdue_activities);
    const unmarked = n(s.completed_without_attendance);

    const items = [
      item(
        "transactions", "Income and expenses",
        txDays == null ? "missing" : txDays > 30 ? "due" : "ok",
        txDays == null
          ? "Nothing has ever been recorded. The audit reads this as a cooperative that does not trade."
          : `${n(s.transactions_30d)} recorded in the last 30 days; the latest ${txDays} day(s) ago.`,
        { label: "Record a transaction", path: "/transactions/new" },
        fmt(s.last_transaction)
      ),
      item(
        "contributions", "Member contributions",
        coDays == null ? "missing" : coDays > 31 ? "due" : "ok",
        coDays == null
          ? "No contribution has ever been recorded."
          : `${n(s.contributors_quarter)} of ${n(s.members)} members contributed in the last 3 months.`,
        { label: "Record contributions", path: "/contributions/new" },
        fmt(s.last_contribution)
      ),
      item(
        "activities", "Activities",
        actDays == null ? "missing" : overdue > 0 || actDays > 60 ? "due" : "ok",
        overdue > 0
          ? `${overdue} planned activities have passed their date without being marked done or cancelled.`
          : `${n(s.upcoming_activities)} planned ahead` +
            (actDays != null ? `; the last one was done ${actDays} day(s) ago.` : "."),
        { label: "Plan an activity", path: "/activities/new" },
        fmt(s.last_activity)
      ),
      item(
        "attendance", "Attendance at activities",
        unmarked > 0 ? "due" : "ok",
        unmarked > 0
          ? `${unmarked} activities done in the last 6 months have no attendance marked.`
          : "Every activity done in the last 6 months has its attendance marked.",
        { label: "Open activities", path: "/activities" }
      ),
      item(
        "assemblies", "Ordinary general assemblies",
        assemblies >= 2 ? "ok" : assemblies === 1 ? "due" : "missing",
        `${assemblies} recorded in the last 12 months; 2 are required, in March and October. ` +
          "Record each as a meeting activity and mark it done.",
        { label: "Plan an assembly", path: "/activities/new" }
      ),
      item(
        "balance_sheet", "Balance sheet",
        bsDays == null ? "missing" : bsDays > 365 ? "due" : "ok",
        bsDays == null
          ? "No balance sheet has ever been filed. One is expected every year."
          : `Last filed for the period ending ${fmt(s.last_balance_sheet)}.`,
        { label: "File a balance sheet", path: "/balance-sheets/new" },
        fmt(s.last_balance_sheet)
      ),
      item(
        "members", "Member register",
        n(s.members) === 0 ? "missing" : "ok",
        `${n(s.members)} on the register, ${n(s.active_members)} active.`,
        { label: "Add a member", path: "/members/new" }
      ),
      item(
        "leadership", "Board of Directors",
        board >= 5 ? "ok" : "due",
        `${board} of the 5 board seats are recorded by name.`,
        { label: "Update the board", path: "/cooperative-profile" }
      ),
      item(
        "documents", "Documents on file",
        n(s.documents) >= 2 ? "ok" : n(s.documents) === 0 ? "missing" : "due",
        `${n(s.documents)} document(s) on file: bylaws, minutes, certificates, reports.`,
        { label: "Upload a document", path: "/cooperative-documents" }
      ),
    ];

    res.json({
      success: true,
      data: items,
      summary: {
        ok: items.filter((i) => i.status === "ok").length,
        due: items.filter((i) => i.status === "due").length,
        missing: items.filter((i) => i.status === "missing").length,
      },
    });
  } catch (err) {
    console.error("GET /cooperatives/:id/record-status error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
