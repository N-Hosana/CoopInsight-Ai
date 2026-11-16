import { Request } from "express";
import { query } from "../config/db";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A REPORT OR A REGISTER MAY BE ABOUT, FOR WHOM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One rule, used by every report and every downloadable list:
 *
 *   member                 themselves — their own statement, their own requests
 *   manager / cooperative  their own cooperative; nothing to choose
 *   sector officer         their sector; may narrow to one cooperative in it
 *   district, RCA, admin,
 *   general manager        any sector, any cooperative, or the whole district
 *
 * Everyone chooses the period. The server decides the rest — a cooperative or
 * sector named in the request that the caller may not see is refused, never
 * silently widened or narrowed.
 */

export interface Viewer {
  userId: string;
  name: string | null;
  role: string;
  level: "sector" | "district" | "rca" | null;
  sector: string | null;
  cooperativeId: string | null;
  memberId: string | null;
}

export interface Target {
  /** One cooperative, or null for a sector / the district. */
  cooperativeId: string | null;
  /** A sector, when the target is every cooperative in one. */
  sector: string | null;
  /** Set only for a member's own statement. */
  memberId: string | null;
  /** How the scope is printed: "TMC (Remera sector)", "Remera sector — all cooperatives". */
  label: string;
}

const DISTRICT = "Gasabo District";

const OWN_COOPERATIVE = ["manager", "cooperative"];
const DISTRICT_WIDE = ["admin", "generalManager"];

export async function viewerOf(req: Request): Promise<Viewer> {
  const res = await query(
    `SELECT name, role, oversight_level, sector, cooperative_id, member_id FROM users WHERE id = $1`,
    [req.user!.userId]
  );
  const u = res.rows[0] ?? {};
  return {
    userId: req.user!.userId,
    name: u.name ?? req.user!.name ?? null,
    role: u.role ?? req.user!.role,
    level: u.oversight_level ?? null,
    sector: u.sector ?? null,
    cooperativeId: u.cooperative_id ?? req.user!.cooperativeId ?? null,
    memberId: u.member_id ?? null,
  };
}

/** A sector officer is pinned to their sector; anyone else from `government` sees the district. */
export const isSectorOfficer = (v: Viewer) => v.role === "government" && v.level === "sector" && !!v.sector;
export const isDistrictWide = (v: Viewer) =>
  DISTRICT_WIDE.includes(v.role) || (v.role === "government" && !isSectorOfficer(v));

async function cooperativeLabel(id: string): Promise<{ name: string; sector: string | null } | null> {
  const r = await query(`SELECT name, sector FROM cooperatives WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return r.rows[0] ?? null;
}

const coopText = (c: { name: string; sector: string | null }) => (c.sector ? `${c.name} (${c.sector} sector)` : c.name);
const sectorText = (s: string) => `${s} sector — all cooperatives`;

export type Resolved = { ok: true; target: Target; viewer: Viewer } | { ok: false; status: number; message: string };

export async function resolveTarget(
  req: Request,
  requested: { cooperativeId?: unknown; sector?: unknown }
): Promise<Resolved> {
  const viewer = await viewerOf(req);
  const wantCoop = typeof requested.cooperativeId === "string" && requested.cooperativeId ? requested.cooperativeId : null;
  const wantSector = typeof requested.sector === "string" && requested.sector ? requested.sector : null;

  if (viewer.role === "member") {
    if (!viewer.cooperativeId) return { ok: false, status: 400, message: "Your account is not linked to a cooperative." };
    const c = await cooperativeLabel(viewer.cooperativeId);
    return {
      ok: true,
      viewer,
      target: {
        cooperativeId: viewer.cooperativeId,
        sector: null,
        memberId: viewer.memberId,
        label: `${viewer.name ?? "Member"} — member of ${c?.name ?? "the cooperative"}`,
      },
    };
  }

  if (OWN_COOPERATIVE.includes(viewer.role)) {
    if (!viewer.cooperativeId) return { ok: false, status: 400, message: "Your account is not attached to a cooperative." };
    const c = await cooperativeLabel(viewer.cooperativeId);
    return { ok: true, viewer, target: { cooperativeId: viewer.cooperativeId, sector: null, memberId: null, label: c ? coopText(c) : "Your cooperative" } };
  }

  if (isSectorOfficer(viewer)) {
    if (wantSector && wantSector.toLowerCase() !== viewer.sector!.toLowerCase()) {
      return { ok: false, status: 403, message: `You oversee ${viewer.sector} sector only.` };
    }
    if (wantCoop) {
      const c = await cooperativeLabel(wantCoop);
      if (!c) return { ok: false, status: 404, message: "That cooperative does not exist." };
      if ((c.sector ?? "").toLowerCase() !== viewer.sector!.toLowerCase()) {
        return { ok: false, status: 403, message: "That cooperative is outside your sector." };
      }
      return { ok: true, viewer, target: { cooperativeId: wantCoop, sector: null, memberId: null, label: coopText(c) } };
    }
    return { ok: true, viewer, target: { cooperativeId: null, sector: viewer.sector, memberId: null, label: sectorText(viewer.sector!) } };
  }

  if (isDistrictWide(viewer)) {
    if (wantCoop) {
      const c = await cooperativeLabel(wantCoop);
      if (!c) return { ok: false, status: 404, message: "That cooperative does not exist." };
      if (wantSector && (c.sector ?? "").toLowerCase() !== wantSector.toLowerCase()) {
        return { ok: false, status: 400, message: `${c.name} is in ${c.sector} sector, not ${wantSector}.` };
      }
      return { ok: true, viewer, target: { cooperativeId: wantCoop, sector: null, memberId: null, label: coopText(c) } };
    }
    if (wantSector) {
      return { ok: true, viewer, target: { cooperativeId: null, sector: wantSector, memberId: null, label: sectorText(wantSector) } };
    }
    return { ok: true, viewer, target: { cooperativeId: null, sector: null, memberId: null, label: `${DISTRICT} — all cooperatives` } };
  }

  return { ok: false, status: 403, message: "Your account cannot produce reports." };
}

/** What the scope picker on the page should offer this account. */
export async function scopeOptions(req: Request) {
  const viewer = await viewerOf(req);
  const sectorOfficer = isSectorOfficer(viewer);
  const districtWide = isDistrictWide(viewer);

  const params: unknown[] = [];
  let where = "c.deleted_at IS NULL";
  if (sectorOfficer) { params.push(viewer.sector); where += ` AND LOWER(c.sector) = LOWER($1)`; }
  else if (!districtWide) { params.push(viewer.cooperativeId); where += ` AND c.id = $1`; }

  const coops = await query(`SELECT c.id, c.name, c.sector FROM cooperatives c WHERE ${where} ORDER BY c.sector, c.name`, params);
  const sectors = [...new Set(coops.rows.map((c: any) => c.sector).filter(Boolean))].sort();
  const own = !districtWide && !sectorOfficer ? coops.rows[0] ?? null : null;

  return {
    role: viewer.role,
    level: viewer.level,
    /** "member" | "cooperative" | "sector" | "district" — which picker to draw. */
    mode: viewer.role === "member" ? "member" : own ? "cooperative" : sectorOfficer ? "sector" : "district",
    fixedCooperative: own ? { id: own.id, name: own.name, sector: own.sector } : null,
    fixedSector: sectorOfficer ? viewer.sector : null,
    canChooseSector: districtWide,
    canChooseCooperative: districtWide || sectorOfficer,
    sectors: districtWide ? sectors : sectorOfficer ? [viewer.sector] : [],
    cooperatives: districtWide || sectorOfficer ? coops.rows : [],
  };
}

/**
 * `AND <column> …` restricting a query to a target: one cooperative, every
 * cooperative in a sector, or nothing for the district. Pushes its parameter.
 */
export function targetClause(target: Pick<Target, "cooperativeId" | "sector">, column: string, params: unknown[]): string {
  if (target.cooperativeId) {
    params.push(target.cooperativeId);
    return ` AND ${column} = $${params.length}`;
  }
  if (target.sector) {
    params.push(target.sector);
    return ` AND ${column} IN (SELECT id FROM cooperatives WHERE LOWER(sector) = LOWER($${params.length}))`;
  }
  return "";
}
