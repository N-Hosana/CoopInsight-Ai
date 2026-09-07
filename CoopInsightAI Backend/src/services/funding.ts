/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EXTERNAL SUPPORT — MATCHING COOPERATIVES TO NGOs AND OTHER FUNDERS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Almost none of the money that reaches a Gasabo cooperative comes from the RCA.
 * It comes from NGOs, development partners, government programmes, unions and
 * banks, and which cooperative gets it turns on three things that the people in
 * the sector will all tell you plainly:
 *
 *   1. SPECIALISATION — a rice programme funds rice growers, not taxi drivers.
 *   2. STATE          — some funders back winners and want a track record;
 *                       others exist precisely to rescue cooperatives in
 *                       trouble. Both are legitimate, and they are opposite
 *                       filters, so a funder declares which states it serves.
 *   3. RELATIONSHIP   — a cooperative that already knows the programme officer
 *                       gets the call. Pretending otherwise would make the
 *                       matching useless in practice, so it is recorded as a
 *                       first-class field rather than left implicit.
 *
 * The score below is a transparent weighted index over exactly those three
 * factors, and every match returns the reasons behind its number so a manager
 * can see why one opportunity ranked above another — and so an officer can
 * argue with the weighting rather than with a black box.
 *
 * WEIGHTS ARE CONFIGURATION. Change them here; the route, the UI and the
 * explanation text all read from this file.
 */

export const MATCH_WEIGHTS = {
  specialisation: 0.45,
  state: 0.35,
  relationship: 0.20,
};

/** A match at or above this is worth putting in front of a manager. */
export const MATCH_THRESHOLD = 0.45;

export const SUPPORT_TYPES = [
  "grant",
  "equipment",
  "training",
  "working_capital",
  "technical_assistance",
  "market_access",
  "infrastructure",
] as const;

export const ORGANIZATION_TYPES = [
  "ngo",
  "government_agency",
  "development_partner",
  "donor",
  "private_sector",
  "financial_institution",
  "faith_based",
  "cooperative_union",
] as const;

/**
 * The four states a cooperative can be in, as produced by the monthly AI audit.
 * A funder targets one or more of them; this is what lets a rescue fund and a
 * growth fund coexist in the same register without fighting each other.
 */
export const COOPERATIVE_BANDS = ["healthy", "monitor", "at_risk", "critical"] as const;
export type CooperativeBand = (typeof COOPERATIVE_BANDS)[number];

export interface MatchInput {
  cooperative: {
    id: string;
    name: string;
    type: string | null;
    sector: string | null;
    healthScore: number;
    memberCount: number;
    /** Latest monthly-audit band; null when the cooperative has never been audited. */
    band: CooperativeBand | null;
    hasPermanentPermit: boolean;
  };
  opportunity: {
    id: string;
    title: string;
    organizationId: string;
    organizationName: string;
    supportType: string;
    targetTypes: string[];
    targetSectors: string[];
    targetBands: string[];
    minMembers: number | null;
    minHealthScore: number | null;
    requiresPermanentPermit: boolean;
    amountAvailable: number | null;
  };
  /** Existing relationship with the funder, when one has been recorded. */
  partnership: {
    status: string;
    relationshipStrength: number;
    lastContactOn: string | null;
  } | null;
}

export interface MatchResult {
  opportunityId: string;
  score: number;
  eligible: boolean;
  /** Hard rules the cooperative fails outright, if any. */
  blockers: string[];
  components: {
    specialisation: number;
    state: number;
    relationship: number;
  };
  reasons: string[];
}

/** Loose containment so "Rice Growing" matches a target of "agriculture". */
function overlaps(value: string | null, targets: string[]): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return targets.some((t) => {
    const target = t.toLowerCase().trim();
    return target === "any" || v.includes(target) || target.includes(v);
  });
}

/**
 * Scores one cooperative against one funding opportunity.
 *
 * Blockers are separated from the score deliberately. A cooperative that is too
 * small for a programme is not a "weak match" — it is ineligible, and telling a
 * manager it scored 0.4 when they can never win it wastes their time.
 */
export function scoreMatch(input: MatchInput): MatchResult {
  const { cooperative: coop, opportunity: opp, partnership } = input;
  const reasons: string[] = [];
  const blockers: string[] = [];

  // ── Hard eligibility ──────────────────────────────────────────────────────
  if (opp.minMembers != null && coop.memberCount < opp.minMembers) {
    blockers.push(
      `${opp.title} requires at least ${opp.minMembers} members; ${coop.name} has ${coop.memberCount}.`
    );
  }
  if (opp.minHealthScore != null && coop.healthScore < opp.minHealthScore) {
    blockers.push(
      `${opp.title} requires a health score of at least ${opp.minHealthScore}; ` +
        `${coop.name} is at ${Math.round(coop.healthScore)}.`
    );
  }
  if (opp.requiresPermanentPermit && !coop.hasPermanentPermit) {
    blockers.push(
      `${opp.title} is open only to cooperatives holding a permanent permit. ` +
        `${coop.name} is still on a temporary permit.`
    );
  }

  // ── 1. Specialisation ─────────────────────────────────────────────────────
  //
  // An empty target list means the funder did not filter on that dimension at
  // all — it is not the same as the cooperative matching it. Treating "no
  // sectors declared" as a sector match is how an agriculture-only grant ends up
  // scoring partial credit for a taxi cooperative, so the two cases are kept
  // apart: only a dimension the funder actually declared can be scored on.
  const typeDeclared = opp.targetTypes.length > 0;
  const sectorDeclared = opp.targetSectors.length > 0;
  const typeHit = typeDeclared && overlaps(coop.type, opp.targetTypes);
  const sectorHit = sectorDeclared && overlaps(coop.sector, opp.targetSectors);

  let specialisation: number;
  if (!typeDeclared && !sectorDeclared) {
    specialisation = 1;
    reasons.push(`${opp.organizationName} funds cooperatives of any type or sector.`);
  } else if (typeDeclared && sectorDeclared) {
    if (typeHit && sectorHit) {
      specialisation = 1;
      reasons.push(
        `${coop.type} in ${coop.sector} matches the programme's focus on ` +
          `${opp.targetTypes.join(", ")} in ${opp.targetSectors.join(", ")}.`
      );
    } else if (typeHit) {
      // Right trade, wrong place. Worth showing — geography is often negotiable.
      specialisation = 0.6;
      reasons.push(
        `${coop.type} matches the programme's focus, but it targets ` +
          `${opp.targetSectors.join(", ")} and ${coop.name} is in ${coop.sector}.`
      );
    } else if (sectorHit) {
      specialisation = 0.25;
      reasons.push(
        `${coop.name} is in a targeted sector, but the programme funds ` +
          `${opp.targetTypes.join(", ")} cooperatives.`
      );
    } else {
      specialisation = 0;
      reasons.push(
        `Neither the cooperative's type (${coop.type}) nor its sector (${coop.sector}) is ` +
          "targeted by this programme."
      );
    }
  } else if (typeDeclared) {
    specialisation = typeHit ? 1 : 0;
    reasons.push(
      typeHit
        ? `${coop.type} matches the programme's focus on ${opp.targetTypes.join(", ")}.`
        : `The programme funds ${opp.targetTypes.join(", ")} cooperatives; ${coop.name} is ` +
          `${coop.type}.`
    );
  } else {
    specialisation = sectorHit ? 1 : 0;
    reasons.push(
      sectorHit
        ? `${coop.name} is in ${coop.sector}, which the programme covers.`
        : `The programme covers ${opp.targetSectors.join(", ")}; ${coop.name} is in ` +
          `${coop.sector}.`
    );
  }

  // ── 2. State of the cooperative ───────────────────────────────────────────
  let state: number;
  if (opp.targetBands.length === 0) {
    state = 0.6;
    reasons.push("The programme does not restrict itself by cooperative condition.");
  } else if (coop.band == null) {
    // Never audited. Neither reward nor punish it; say so instead.
    state = 0.5;
    reasons.push(
      `${coop.name} has not been through a monthly audit yet, so its condition could not be ` +
        "matched against the programme's target. Run the monthly audit to sharpen this."
    );
  } else if (opp.targetBands.includes(coop.band)) {
    state = 1;
    reasons.push(
      `${coop.name} is currently assessed as "${coop.band}", which is exactly who this ` +
        "programme is for."
    );
  } else {
    state = 0.15;
    reasons.push(
      `The programme targets cooperatives assessed as ${opp.targetBands.join(" or ")}; ` +
        `${coop.name} is currently "${coop.band}".`
    );
  }

  // ── 3. Relationship with the funder ───────────────────────────────────────
  let relationship: number;
  if (!partnership) {
    // No relationship is not a fault — it is the normal starting point, and the
    // whole point of surfacing the match is to create one.
    relationship = 0.2;
    reasons.push(
      `No existing relationship with ${opp.organizationName}. An introduction through the sector ` +
        "cooperative officer would materially improve the odds."
    );
  } else {
    const base = Math.max(0, Math.min(100, partnership.relationshipStrength)) / 100;
    const bonus = partnership.status === "active" ? 0.15 : partnership.status === "completed" ? 0.1 : 0;
    relationship = Math.min(1, base + bonus);
    reasons.push(
      `${coop.name} has an existing ${partnership.status} relationship with ` +
        `${opp.organizationName} (strength ${partnership.relationshipStrength}/100)` +
        (partnership.lastContactOn
          ? `, last contact ${new Date(partnership.lastContactOn).toISOString().slice(0, 10)}.`
          : ".")
    );
  }

  const score =
    specialisation * MATCH_WEIGHTS.specialisation +
    state * MATCH_WEIGHTS.state +
    relationship * MATCH_WEIGHTS.relationship;

  return {
    opportunityId: opp.id,
    score: Number(score.toFixed(4)),
    eligible: blockers.length === 0,
    blockers,
    components: {
      specialisation: Number(specialisation.toFixed(4)),
      state: Number(state.toFixed(4)),
      relationship: Number(relationship.toFixed(4)),
    },
    reasons,
  };
}

/**
 * Ranks every opportunity for one cooperative, best first. Ineligible ones are
 * kept in the list rather than hidden: a manager needs to know that a programme
 * exists and what would make them eligible for it.
 */
export function rankMatches(
  cooperative: MatchInput["cooperative"],
  opportunities: MatchInput["opportunity"][],
  partnerships: Map<string, NonNullable<MatchInput["partnership"]>>
): MatchResult[] {
  return opportunities
    .map((opportunity) =>
      scoreMatch({
        cooperative,
        opportunity,
        partnership: partnerships.get(opportunity.organizationId) ?? null,
      })
    )
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });
}
