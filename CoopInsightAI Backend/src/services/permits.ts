/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OPERATING PERMITS — TERMS AND THE MATURITY AUDIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A newly registered cooperative does not get a permanent licence. The RCA
 * issues a temporary permit valid for one year. Before that year is out the
 * cooperative is audited; if it passes, the temporary permit is superseded by a
 * permanent permit whose term depends on what the cooperative does.
 *
 *   - Most cooperatives          -> 30 years
 *   - Industrial cooperatives    -> 50 years
 *   - Rice-growing cooperatives  -> 50 years
 *
 * The long terms exist because those cooperatives sink capital into plant,
 * milling equipment and irrigated land that will not pay back inside 30 years,
 * and no lender will finance an asset with a life longer than the borrower's
 * licence.
 *
 * TERMS ARE CONFIGURATION, NOT LAW. Confirm the figures below against the RCA
 * guidance in force before relying on a decision, and change them here — this
 * file is the only place the terms are written down. The permits route, the
 * audit workflow and the UI all read from it.
 */

import {
  BOARD,
  ORDINARY_ASSEMBLY_MONTHS,
  ORDINARY_ASSEMBLY_MONTH_NAMES,
  voteCarries,
} from "./governance";

export const PERMIT_TERMS = {
  /** Length of the first permit every new cooperative receives, in years. */
  temporaryYears: 1,
  /** Default permanent term once the maturity audit is passed, in years. */
  standardPermanentYears: 30,
  /** Extended term for capital-intensive cooperatives, in years. */
  extendedPermanentYears: 50,
  /**
   * How long before a temporary permit expires the maturity audit should open.
   * The audit itself takes time, so it cannot start on the last day.
   */
  auditLeadDays: 60,
  /** Calendar days the RCA targets for concluding a maturity audit. */
  auditTargetDays: 21,
  /** How long a temporary permit is extended by when an audit is deferred. */
  extensionYears: 1,
};

/**
 * Cooperative types that qualify for the extended permanent term. Matched
 * case-insensitively as substrings against `cooperatives.type`, so "Rice
 * Growing", "Agro-processing Industry" and "Industry" all hit.
 */
export const EXTENDED_TERM_TYPES = [
  "industry",
  "industrial",
  "manufacturing",
  "processing",
  "rice",
  "milling",
];

/**
 * Words that mark a cooperative as rice-growing even when its `type` says only
 * "Agriculture". Rice cooperatives are recorded under the general agriculture
 * type in the RCA register, so the narrative fields have to be read too.
 */
export const RICE_KEYWORDS = ["rice", "umuceri", "paddy", "rice growing"];

export interface PermanentTerm {
  years: number;
  /** Machine-readable rule id, stored on the permit so the term is auditable. */
  rule: "extended_industry" | "extended_rice" | "standard";
  /** Plain-language justification shown to the officer and the cooperative. */
  basis: string;
}

/**
 * How long a permanent permit runs for this cooperative.
 *
 * `type` is the primary signal; `name` and `description` are read as a fallback
 * because a rice cooperative is usually registered under the general
 * "Agriculture" type and the crop only appears in its narrative.
 */
export function permanentTerm(input: {
  type?: string | null;
  name?: string | null;
  description?: string | null;
}): PermanentTerm {
  const type = (input.type ?? "").toLowerCase();
  const narrative = [input.name, input.description].filter(Boolean).join(" ").toLowerCase();

  const industrial = EXTENDED_TERM_TYPES.filter((t) => t !== "rice").find((t) => type.includes(t));
  if (industrial) {
    return {
      years: PERMIT_TERMS.extendedPermanentYears,
      rule: "extended_industry",
      basis:
        `Registered as "${input.type}", which the RCA treats as an industrial cooperative. ` +
        `Industrial cooperatives receive the extended ${PERMIT_TERMS.extendedPermanentYears}-year ` +
        `term because their plant and equipment do not pay back inside a standard term.`,
    };
  }

  const isRice =
    RICE_KEYWORDS.some((k) => type.includes(k)) || RICE_KEYWORDS.some((k) => narrative.includes(k));
  if (isRice) {
    return {
      years: PERMIT_TERMS.extendedPermanentYears,
      rule: "extended_rice",
      basis:
        "Identified as a rice-growing cooperative. Rice cooperatives receive the extended " +
        `${PERMIT_TERMS.extendedPermanentYears}-year term because paddy development, irrigation ` +
        "and milling investment run well beyond a standard term.",
    };
  }

  return {
    years: PERMIT_TERMS.standardPermanentYears,
    rule: "standard",
    basis:
      `Registered as "${input.type ?? "unspecified"}", which carries the standard ` +
      `${PERMIT_TERMS.standardPermanentYears}-year permanent term.`,
  };
}

/** The date a permit of `years` issued on `from` expires. */
export function expiryFor(from: Date, years: number): Date {
  const end = new Date(from);
  end.setFullYear(end.getFullYear() + years);
  return end;
}

/** Whole days from now until `date`; negative once it has passed. */
export function daysUntil(date: Date | string): number {
  const target = typeof date === "string" ? new Date(date) : date;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MATURITY AUDIT CRITERIA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * What the RCA checks at the end of the temporary year before converting the
 * permit. Same pattern as the formation criteria: the cooperative's own
 * readiness view, the officer checklist and the automated pre-assessment all
 * read this one list, so they cannot drift apart.
 */
export interface AuditCriterion {
  id: string;
  label: string;
  requirement: string;
  mandatory: boolean;
  weight: number;
}

export const MATURITY_AUDIT_CRITERIA: AuditCriterion[] = [
  {
    id: "trading_activity",
    label: "The cooperative actually traded",
    requirement: "Income transactions are recorded in at least 6 months of the permit period.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "member_register",
    label: "Member register maintained",
    requirement:
      "The member register is on the system and has not fallen below the formation minimum.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "general_assembly",
    label: "Ordinary general assemblies held",
    requirement:
      `The ordinary general assembly sat in ${ORDINARY_ASSEMBLY_MONTH_NAMES} as the RCA rules ` +
      "require, and the meetings were minuted.",
    mandatory: true,
    weight: 2,
  },
  {
    id: "member_participation",
    label: "Members are participating",
    requirement: "At least half the members attended an activity or paid a contribution.",
    mandatory: false,
    weight: 2,
  },
  {
    id: "financial_records",
    label: "Books of account kept",
    requirement: "Income and expenditure are recorded, and a balance sheet has been filed.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "leadership_complete",
    label: "Board of Directors in place",
    requirement:
      `All ${BOARD.standardSize} board seats are filled and recorded — ` +
      `${BOARD.namedOffices.join(", ")} and two advisors.`,
    mandatory: false,
    weight: 1,
  },
  {
    id: "governance_documents",
    label: "Governance documents filed",
    requirement: "Bylaws and assembly minutes are held on the cooperative's document record.",
    mandatory: false,
    weight: 2,
  },
];

/** A maturity audit scoring at or above this is recommended for conversion. */
export const MATURITY_PASS_MARK = 0.7;

export type AuditRecommendation =
  | "issue_permanent"
  | "extend_temporary"
  | "revoke"
  | "allow_dissolution"
  | "refuse_dissolution"
  | "none";

export interface MaturityAssessment {
  score: number;
  passMark: number;
  recommended: Extract<AuditRecommendation, "issue_permanent" | "extend_temporary" | "revoke">;
  met: string[];
  unmet: string[];
  failedMandatory: string[];
  notes: string[];
  model: string;
  confidence: number;
}

export interface MaturityFacts {
  monthsWithIncome: number;
  memberCount: number;
  minMembers: number;
  /** Every assembly meeting recorded in the period. */
  generalAssemblies: number;
  /** Those that fell in March or October — the RCA's ordinary sittings. */
  ordinaryAssemblies: number;
  /** Filled seats on the Board of Directors; the RCA expects five. */
  boardSeatsFilled: number;
  /** Share of members with any attendance or contribution; null when unmeasurable. */
  participationRate: number | null;
  hasTransactions: boolean;
  hasBalanceSheet: boolean;
  leadershipComplete: boolean;
  governanceDocuments: number;
}

/**
 * Scores an audit from facts the backend has already gathered. This is a
 * deterministic rules engine, not a learned model: there are no labelled past
 * audits to train against, and an officer has to be able to defend the number to
 * the cooperative it is about.
 */
export function assessMaturity(facts: MaturityFacts): MaturityAssessment {
  const results: Array<{ criterion: AuditCriterion; passed: boolean; note?: string }> = [];

  const check = (id: string, passed: boolean, note?: string) => {
    const criterion = MATURITY_AUDIT_CRITERIA.find((c) => c.id === id)!;
    results.push({ criterion, passed, note });
  };

  check(
    "trading_activity",
    facts.monthsWithIncome >= 6,
    `Income recorded in ${facts.monthsWithIncome} month(s) since the permit was issued.`
  );
  check(
    "member_register",
    facts.memberCount >= facts.minMembers,
    `${facts.memberCount} members on the register (minimum ${facts.minMembers}).`
  );
  // The RCA expects an ordinary assembly in each of March and October. A
  // permit year spans both, so one is a partial failure and none is a clear one.
  check(
    "general_assembly",
    facts.ordinaryAssemblies >= ORDINARY_ASSEMBLY_MONTHS.length,
    `${facts.ordinaryAssemblies} of ${ORDINARY_ASSEMBLY_MONTHS.length} ordinary assemblies ` +
      `(${ORDINARY_ASSEMBLY_MONTH_NAMES}) recorded in the permit year; ` +
      `${facts.generalAssemblies} assembly meeting(s) in total.`
  );
  check(
    "member_participation",
    facts.participationRate != null && facts.participationRate >= 0.5,
    facts.participationRate == null
      ? "No attendance or contribution records — participation could not be measured."
      : `${Math.round(facts.participationRate * 100)}% of members participated.`
  );
  check(
    "financial_records",
    facts.hasTransactions && facts.hasBalanceSheet,
    facts.hasBalanceSheet ? "Balance sheet on file." : "No balance sheet has been filed."
  );
  check(
    "leadership_complete",
    facts.boardSeatsFilled >= BOARD.standardSize,
    `${facts.boardSeatsFilled} of ${BOARD.standardSize} board seats recorded.`
  );
  check(
    "governance_documents",
    facts.governanceDocuments >= 2,
    `${facts.governanceDocuments} governance document(s) on file.`
  );

  const totalWeight = results.reduce((s, r) => s + r.criterion.weight, 0);
  const earned = results.reduce((s, r) => s + (r.passed ? r.criterion.weight : 0), 0);
  const score = totalWeight > 0 ? earned / totalWeight : 0;

  const failedMandatory = results
    .filter((r) => !r.passed && r.criterion.mandatory)
    .map((r) => r.criterion.label);

  let recommended: MaturityAssessment["recommended"];
  if (failedMandatory.length === 0 && score >= MATURITY_PASS_MARK) {
    recommended = "issue_permanent";
  } else if (failedMandatory.length >= 3 || score < 0.35) {
    // Nothing is working. Revocation is on the table, but the officer decides.
    recommended = "revoke";
  } else {
    recommended = "extend_temporary";
  }

  return {
    score: Number(score.toFixed(4)),
    passMark: MATURITY_PASS_MARK,
    recommended,
    met: results.filter((r) => r.passed).map((r) => r.criterion.label),
    unmet: results.filter((r) => !r.passed).map((r) => r.criterion.label),
    failedMandatory,
    notes: results.map((r) => r.note).filter((n): n is string => Boolean(n)),
    model: "MaturityAuditRules v1.0 (deterministic)",
    // The rules are certain about what they measured; the confidence reported is
    // about how much evidence there was, not about the arithmetic.
    confidence: facts.hasTransactions ? 0.9 : 0.55,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DISSOLUTION AUDIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A cooperative is not struck off on the president's word. The request is
 * audited by the RCA, which has to satisfy itself that the members really did
 * resolve to dissolve, that creditors and members will be paid, and that a
 * cooperative with a viable trade is not simply being abandoned.
 */
export const DISSOLUTION_AUDIT_CRITERIA: AuditCriterion[] = [
  {
    id: "member_resolution",
    label: "Members resolved to dissolve",
    requirement: "A general assembly voted for dissolution, with the votes recorded.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "grounds_stated",
    label: "Grounds are stated and substantiated",
    requirement: "The president's request explains why the cooperative can no longer continue.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "liabilities_declared",
    label: "Liabilities accounted for",
    requirement: "Outstanding liabilities are declared and a settlement plan is attached.",
    mandatory: true,
    weight: 3,
  },
  {
    id: "asset_plan",
    label: "Asset disposal plan",
    requirement: "A plan for disposing of assets and settling members' claims is attached.",
    mandatory: true,
    weight: 2,
  },
  {
    id: "no_viable_trade",
    label: "No viable trade being abandoned",
    requirement: "The cooperative is not trading profitably at the time of the request.",
    mandatory: false,
    weight: 2,
  },
  {
    id: "support_exhausted",
    label: "Support options exhausted",
    requirement: "A field visit or funding referral was tried before dissolution was accepted.",
    mandatory: false,
    weight: 2,
  },
];

/**
 * Calendar days the RCA targets end-to-end for a dissolution request, from the
 * president filing it to the register being updated. Roughly two weeks — longer
 * where the grounds are contested or the accounts are not settled.
 */
export const DISSOLUTION_TARGET_DAYS = 14;

export interface DissolutionAssessment {
  score: number;
  passMark: number;
  recommended: Extract<AuditRecommendation, "allow_dissolution" | "refuse_dissolution">;
  met: string[];
  unmet: string[];
  failedMandatory: string[];
  notes: string[];
  model: string;
  confidence: number;
}

export interface DissolutionFacts {
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  memberCount: number;
  reasonLength: number;
  liabilitiesDeclared: boolean;
  assetPlanLength: number;
  /** Net surplus over the last 12 months; positive means it is still trading well. */
  recentSurplus: number;
  monthsWithIncome: number;
  supportAttempts: number;
}

/**
 * Scores a dissolution request the same deterministic way. The decisive
 * question is whether the members actually voted for it: a president cannot
 * dissolve a cooperative over the heads of its membership.
 */
export function assessDissolution(facts: DissolutionFacts): DissolutionAssessment {
  const results: Array<{ criterion: AuditCriterion; passed: boolean; note?: string }> = [];
  const check = (id: string, passed: boolean, note?: string) => {
    const criterion = DISSOLUTION_AUDIT_CRITERIA.find((c) => c.id === id)!;
    results.push({ criterion, passed, note });
  };

  const votesFor = facts.votesFor ?? 0;
  const votesAgainst = facts.votesAgainst ?? 0;
  const votesAbstain = facts.votesAbstain ?? 0;

  // Dissolution is one of the matters the RCA brochure reserves to a
  // REINFORCED majority: "decisions on ... dissolving the cooperative require
  // an Assembly attended and voted on by at least three-quarters of the members
  // or representatives present." The threshold therefore comes from
  // governance.ts rather than being guessed at here.
  const resolution = voteCarries("dissolve", votesFor, votesAgainst, votesAbstain);
  const cast = resolution.cast;

  check(
    "member_resolution",
    resolution.carried,
    cast === 0 ? "No general assembly vote was recorded on the request." : resolution.basis
  );
  check("grounds_stated", facts.reasonLength >= 30);
  check(
    "liabilities_declared",
    facts.liabilitiesDeclared,
    facts.liabilitiesDeclared
      ? "Outstanding liabilities declared."
      : "Outstanding liabilities were not declared."
  );
  check("asset_plan", facts.assetPlanLength >= 30);
  check(
    "no_viable_trade",
    !(facts.recentSurplus > 0 && facts.monthsWithIncome >= 6),
    facts.recentSurplus > 0 && facts.monthsWithIncome >= 6
      ? `The cooperative traded in ${facts.monthsWithIncome} of the last 12 complete months and ran a ` +
        `surplus of RWF ${Math.round(facts.recentSurplus).toLocaleString()}. Dissolving a ` +
        "cooperative that is still trading needs a stronger explanation."
      : "No profitable trade is being abandoned."
  );
  check(
    "support_exhausted",
    facts.supportAttempts > 0,
    facts.supportAttempts > 0
      ? `${facts.supportAttempts} support intervention(s) recorded before this request.`
      : "No field visit or funding referral was recorded before dissolution was requested."
  );

  const totalWeight = results.reduce((s, r) => s + r.criterion.weight, 0);
  const earned = results.reduce((s, r) => s + (r.passed ? r.criterion.weight : 0), 0);
  const score = totalWeight > 0 ? earned / totalWeight : 0;
  const failedMandatory = results
    .filter((r) => !r.passed && r.criterion.mandatory)
    .map((r) => r.criterion.label);

  return {
    score: Number(score.toFixed(4)),
    passMark: MATURITY_PASS_MARK,
    recommended:
      failedMandatory.length === 0 && score >= MATURITY_PASS_MARK
        ? "allow_dissolution"
        : "refuse_dissolution",
    met: results.filter((r) => r.passed).map((r) => r.criterion.label),
    unmet: results.filter((r) => !r.passed).map((r) => r.criterion.label),
    failedMandatory,
    notes: results.map((r) => r.note).filter((n): n is string => Boolean(n)),
    model: "DissolutionAuditRules v1.0 (deterministic)",
    confidence: cast > 0 ? 0.9 : 0.5,
  };
}
