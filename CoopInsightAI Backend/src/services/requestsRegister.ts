import { query } from "../config/db";
import type { Target, Viewer } from "./reportScope";
import { isDistrictWide, isSectorOfficer } from "./reportScope";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY REQUEST MADE TO THE AGENCY, IN ONE LIST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Requests live in five tables because each runs its own procedure:
 *
 *   cooperative_requests       formation, dissolution, certificate changes, issue reports
 *   membership_exit_requests   a member asking to leave (decided by the assembly)
 *   audit_requests             an audit asked for by a cooperative or an officer
 *   rca_audits                 audits the RCA opens (permit maturity, dissolution, compliance)
 *   funding_requests           applications for external support
 *
 * An officer asking "who has asked us for what, and where is it stuck?" should
 * not have to visit five pages. This flattens them into one register — who
 * asked, for which cooperative, at which level it now sits, and its state —
 * under the same scope rule as the reports.
 */

export interface RegisterRow {
  source: string;
  id: string;
  reference: string;
  kind: string;
  kindLabel: string;
  group: "requests" | "issues" | "exits" | "audits" | "funding";
  requester: string;
  requesterRole: string | null;
  cooperative: string | null;
  sector: string | null;
  stage: string;
  status: string;
  statusLabel: string;
  state: "open" | "approved" | "rejected" | "closed";
  submittedAt: string;
  updatedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
}

const KIND_LABELS: Record<string, string> = {
  formation: "Formation of a cooperative",
  dissolution: "Dissolution",
  change_objective: "Change of objective",
  add_activity: "Additional activities",
  change_name: "Change of name",
  duplicate_certificate: "Replacement certificate",
  issue_report: "Issue reported",
  membership_exit: "Leaving the cooperative",
  audit_financial: "Financial audit request",
  audit_general: "General audit request",
  rca_permit_maturity: "Permit maturity audit",
  rca_dissolution: "Dissolution audit",
  rca_compliance: "Compliance audit",
  funding: "External support",
};

const GROUP_OF = (kind: string): RegisterRow["group"] =>
  kind === "issue_report" ? "issues"
    : kind === "membership_exit" ? "exits"
    : kind.startsWith("audit_") || kind.startsWith("rca_") ? "audits"
    : kind === "funding" ? "funding"
    : "requests";

const APPROVED = new Set(["approved", "passed", "completed", "disbursed"]);
const REJECTED = new Set(["rejected", "failed"]);
const CLOSED = new Set(["withdrawn", "reversed", "cancelled"]);

const stateOf = (status: string): RegisterRow["state"] =>
  APPROVED.has(status) ? "approved" : REJECTED.has(status) ? "rejected" : CLOSED.has(status) ? "closed" : "open";

const words = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : v);

const STATUS_LABELS: Record<string, string> = {
  pending_sector: "With the sector officer",
  pending_district: "With the district office",
  pending_rca: "With the RCA",
  pending: "Received",
  under_review: "Under review",
  meeting_scheduled: "Assembly called",
  meeting_held: "Assembly held",
  submitted: "Submitted",
  relay_sector: "Passed to the sector",
  relay_district: "Passed to the district",
  awaiting_confirmation: "Awaiting confirmation",
  reschedule_requested: "New date asked for",
};

function stageLabel(source: string, stage: string | null, status: string): string {
  if (stateOf(status) !== "open") return "Closed";
  if (source === "exit") return "General assembly";
  if (source === "funding") return "Support partner";
  const s = (stage ?? status ?? "").toLowerCase();
  if (s.includes("sector")) return "Sector officer";
  if (s.includes("district")) return "District office";
  if (s.includes("rca")) return "RCA";
  return words(stage ?? "") || "—";
}

export interface RegisterFilters {
  from: string;
  to: string;
  group?: string | null;
  state?: string | null;
}

/**
 * The WHERE fragment that keeps one source inside the caller's reach.
 * `coop` / `sector` / `requester` are that source's column expressions.
 */
function reach(
  viewer: Viewer,
  target: Target,
  cols: { coop: string; sector: string; requester: string; member?: string },
  p: (v: unknown) => string
): string {
  if (viewer.role === "member") {
    return `(${cols.requester} = ${p(viewer.userId)}${cols.member && viewer.memberId ? ` OR ${cols.member} = ${p(viewer.memberId)}` : ""})`;
  }
  if (!isSectorOfficer(viewer) && !isDistrictWide(viewer)) {
    // Manager / cooperative account: their cooperative, and anything they filed themselves.
    return `(${cols.coop} = ${p(viewer.cooperativeId)} OR ${cols.requester} = ${p(viewer.userId)})`;
  }
  if (target.cooperativeId) return `${cols.coop} = ${p(target.cooperativeId)}`;
  if (target.sector) return `LOWER(${cols.sector}) = LOWER(${p(target.sector)})`;
  return "TRUE";
}

export async function listRegister(viewer: Viewer, target: Target, filters: RegisterFilters): Promise<RegisterRow[]> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const from = p(filters.from);
  const to = p(filters.to);
  const inPeriod = (col: string) => `${col}::date BETWEEN ${from} AND ${to}`;

  const sql = `
    SELECT 'cooperative_request' AS source, cr.id, cr.reference, cr.request_type AS kind,
           COALESCE(u.name, cr.contact_name, 'Unknown') AS requester, COALESCE(cr.filed_as_role, u.role) AS requester_role,
           COALESCE(c.name, cr.proposed_name) AS cooperative, COALESCE(c.sector, cr.sector) AS sector,
           cr.current_stage AS stage, cr.status, cr.created_at AS submitted_at, cr.updated_at, cr.response_due_at AS due_at
      FROM cooperative_requests cr
      LEFT JOIN users u ON u.id = cr.submitted_by
      LEFT JOIN cooperatives c ON c.id = cr.cooperative_id
     WHERE ${inPeriod("cr.created_at")}
       AND ${reach(viewer, target, { coop: "cr.cooperative_id", sector: "COALESCE(c.sector, cr.sector)", requester: "cr.submitted_by" }, p)}

    UNION ALL
    SELECT 'exit', e.id, 'EXIT-' || UPPER(LEFT(e.id::text, 8)), 'membership_exit',
           COALESCE(m.full_name, u.name, 'Unknown'), 'member',
           c.name, c.sector, 'assembly', e.status, e.created_at, e.updated_at, e.response_due_at
      FROM membership_exit_requests e
      JOIN cooperatives c ON c.id = e.cooperative_id
      LEFT JOIN users u ON u.id = e.requested_by
      LEFT JOIN members m ON m.id = e.member_id
     WHERE ${inPeriod("e.created_at")}
       AND ${reach(viewer, target, { coop: "e.cooperative_id", sector: "c.sector", requester: "e.requested_by", member: "e.member_id" }, p)}

    UNION ALL
    SELECT 'audit_request', ar.id, ar.reference, 'audit_' || ar.audit_kind,
           COALESCE(u.name, 'Unknown'), ar.requester_level,
           c.name, COALESCE(c.sector, ar.sector), ar.current_step, ar.status, ar.created_at, ar.updated_at, ar.step_due_at
      FROM audit_requests ar
      LEFT JOIN cooperatives c ON c.id = ar.cooperative_id
      LEFT JOIN users u ON u.id = ar.requested_by
     WHERE ${inPeriod("ar.created_at")}
       AND ${reach(viewer, target, { coop: "ar.cooperative_id", sector: "COALESCE(c.sector, ar.sector)", requester: "ar.requested_by" }, p)}

    UNION ALL
    SELECT 'rca_audit', ra.id, ra.reference, 'rca_' || ra.audit_type,
           COALESCE(u.name, 'RCA'), 'rca',
           c.name, c.sector, 'rca', ra.status, ra.created_at, ra.updated_at, ra.due_on::timestamptz
      FROM rca_audits ra
      LEFT JOIN cooperatives c ON c.id = ra.cooperative_id
      LEFT JOIN users u ON u.id = ra.opened_by
     WHERE ${inPeriod("ra.created_at")}
       AND ${reach(viewer, target, { coop: "ra.cooperative_id", sector: "c.sector", requester: "ra.opened_by" }, p)}

    UNION ALL
    SELECT 'funding', fr.id, fr.reference, 'funding',
           COALESCE(u.name, 'Unknown'), u.role,
           c.name, c.sector, 'partner', fr.status, fr.created_at, fr.updated_at, NULL::timestamptz
      FROM funding_requests fr
      LEFT JOIN cooperatives c ON c.id = fr.cooperative_id
      LEFT JOIN users u ON u.id = fr.submitted_by
     WHERE ${inPeriod("fr.created_at")}
       AND ${reach(viewer, target, { coop: "fr.cooperative_id", sector: "c.sector", requester: "fr.submitted_by" }, p)}

    ORDER BY submitted_at DESC`;

  const res = await query(sql, params);
  const now = Date.now();

  return res.rows
    .map((r: any): RegisterRow => {
      const state = stateOf(r.status);
      return {
        source: r.source,
        id: r.id,
        reference: r.reference ?? "—",
        kind: r.kind,
        kindLabel: KIND_LABELS[r.kind] ?? words(r.kind),
        group: GROUP_OF(r.kind),
        requester: r.requester,
        requesterRole: r.requester_role ? words(String(r.requester_role)) : null,
        cooperative: r.cooperative,
        sector: r.sector,
        stage: stageLabel(r.source, r.stage, r.status),
        status: r.status,
        statusLabel: STATUS_LABELS[r.status] ?? words(r.status),
        state,
        submittedAt: new Date(r.submitted_at).toISOString(),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        overdue: state === "open" && !!r.due_at && new Date(r.due_at).getTime() < now,
      };
    })
    .filter((r) => (!filters.group || filters.group === "all" || r.group === filters.group))
    .filter((r) => (!filters.state || filters.state === "all" || r.state === filters.state));
}

export function summarise(rows: RegisterRow[]) {
  const count = (f: (r: RegisterRow) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    open: count((r) => r.state === "open"),
    approved: count((r) => r.state === "approved"),
    rejected: count((r) => r.state === "rejected"),
    closed: count((r) => r.state === "closed"),
    overdue: count((r) => r.overdue),
    atSector: count((r) => r.state === "open" && r.stage === "Sector officer"),
    atDistrict: count((r) => r.state === "open" && r.stage === "District office"),
    atRca: count((r) => r.state === "open" && r.stage === "RCA"),
  };
}
