/**
 * ─────────────────────────────────────────────────────────────────────────────
 * COOPERATIVE FORMATION — ELIGIBILITY CRITERIA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This file is the single place where the vetting rules live. The sector,
 * district and RCA review screens all render the checklist from here, and the
 * automated assessor below scores against exactly the same list — so what the
 * applicant is told, what the officer sees, and what the model scores can never
 * drift apart.
 *
 * THRESHOLDS ARE CONFIGURATION, NOT LAW. The numbers below (minimum members,
 * minimum share capital, minimum purpose length) are the values this deployment
 * currently vets against. Confirm them against the RCA guidance in force before
 * relying on a decision, and edit them here — nowhere else — when they change.
 */

export const FORMATION_THRESHOLDS = {
  /** Minimum number of founding members on the register. */
  minMembers: 7,
  /** Minimum paid-up share capital, in RWF. */
  minShareCapital: 100_000,
  /** Minimum characters of narrative describing what the cooperative will do. */
  minPurposeLength: 120,
  /** A request scoring at or above this is predicted eligible. */
  passMark: 0.75,
};

export type CriterionKind = "document" | "data";

export interface Criterion {
  id: string;
  label: string;
  /** What the applicant has to provide, in plain language. */
  requirement: string;
  kind: CriterionKind;
  /** A mandatory criterion that fails makes the whole request ineligible. */
  mandatory: boolean;
  /** Relative contribution to the overall score. */
  weight: number;
}

export const FORMATION_CRITERIA: Criterion[] = [
  {
    id: "min_members",
    label: "Minimum founding members",
    requirement: `At least ${FORMATION_THRESHOLDS.minMembers} founding members are listed on the application.`,
    kind: "data",
    mandatory: true,
    weight: 3,
  },
  {
    id: "share_capital",
    label: "Paid-up share capital",
    requirement: `Members have subscribed at least RWF ${FORMATION_THRESHOLDS.minShareCapital.toLocaleString()} in share capital.`,
    kind: "data",
    mandatory: true,
    weight: 3,
  },
  {
    id: "unique_name",
    label: "Name is not already registered",
    requirement: "The proposed name is not already used by a registered cooperative.",
    kind: "data",
    mandatory: true,
    weight: 2,
  },
  {
    id: "purpose_statement",
    label: "Statement of economic purpose",
    requirement: `A description of at least ${FORMATION_THRESHOLDS.minPurposeLength} characters explaining the economic activity the cooperative will carry out.`,
    kind: "data",
    mandatory: true,
    weight: 2,
  },
  {
    id: "location",
    label: "Operating area identified",
    requirement: "Sector and cell of operation are stated.",
    kind: "data",
    mandatory: true,
    weight: 1,
  },
  {
    id: "contact",
    label: "Reachable applicant",
    requirement: "A named contact person with a working telephone number.",
    kind: "data",
    mandatory: true,
    weight: 1,
  },
  {
    id: "doc_bylaws",
    label: "Draft bylaws",
    requirement: "The cooperative's draft bylaws, adopted by the founding members.",
    kind: "document",
    mandatory: true,
    weight: 3,
  },
  {
    id: "doc_minutes",
    label: "Constitutive assembly minutes",
    requirement: "Signed minutes of the constitutive general assembly that resolved to form the cooperative.",
    kind: "document",
    mandatory: true,
    weight: 3,
  },
  {
    id: "doc_member_list",
    label: "List of founding members",
    requirement: "A member list carrying each founder's names and national ID number.",
    kind: "document",
    mandatory: true,
    weight: 2,
  },
  {
    id: "doc_business_plan",
    label: "Business / feasibility plan",
    requirement: "A plan showing the activity is viable and how the cooperative will fund itself.",
    kind: "document",
    mandatory: false,
    weight: 2,
  },
  {
    id: "doc_bank_proof",
    label: "Proof of bank account or share deposit",
    requirement: "Evidence that the subscribed share capital has been deposited.",
    kind: "document",
    mandatory: false,
    weight: 1,
  },
];

export const DOCUMENT_CRITERIA = FORMATION_CRITERIA.filter((c) => c.kind === "document");

export interface CriterionResult {
  id: string;
  label: string;
  requirement: string;
  mandatory: boolean;
  weight: number;
  passed: boolean;
  /** What the assessor actually observed — shown to the officer verbatim. */
  finding: string;
}

export interface Assessment {
  /** The assessor's prediction. Never a decision — an officer still decides. */
  eligible: boolean;
  /** Weighted proportion of criteria met, 0–1. */
  score: number;
  /**
   * How much weight to put on the prediction. Document criteria are judged only
   * on whether a file was attached, not on its contents, so confidence falls as
   * the outcome leans more on documents.
   */
  confidence: number;
  passMark: number;
  criteria: CriterionResult[];
  failedMandatory: string[];
  missingDocuments: string[];
  recommendations: string[];
  model: string;
  assessedAt: string;
}

export interface FormationInput {
  proposedName?: string | null;
  proposedType?: string | null;
  sector?: string | null;
  cell?: string | null;
  memberCount?: number | null;
  shareCapital?: number | null;
  purpose?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

/**
 * Rules-based eligibility assessor.
 *
 * This is deterministic scoring, not a trained model — the Python AI service is
 * not yet built, so `POST /cooperative-requests/:id/assess` tries that service
 * first and falls back to this. Keeping the criteria and weights in one place
 * means the model, when it arrives, can be scored against the same rubric.
 */
export function assessFormation(
  input: FormationInput,
  attachedCriterionIds: string[],
  nameAlreadyRegistered: boolean
): Assessment {
  const attached = new Set(attachedCriterionIds);
  const results: CriterionResult[] = [];

  const push = (c: Criterion, passed: boolean, finding: string) =>
    results.push({
      id: c.id,
      label: c.label,
      requirement: c.requirement,
      mandatory: c.mandatory,
      weight: c.weight,
      passed,
      finding,
    });

  for (const c of FORMATION_CRITERIA) {
    switch (c.id) {
      case "min_members": {
        const n = input.memberCount ?? 0;
        push(c, n >= FORMATION_THRESHOLDS.minMembers,
          `${n} founding member${n === 1 ? "" : "s"} declared; ${FORMATION_THRESHOLDS.minMembers} required.`);
        break;
      }
      case "share_capital": {
        const amount = input.shareCapital ?? 0;
        push(c, amount >= FORMATION_THRESHOLDS.minShareCapital,
          `RWF ${amount.toLocaleString()} subscribed; RWF ${FORMATION_THRESHOLDS.minShareCapital.toLocaleString()} required.`);
        break;
      }
      case "unique_name":
        push(c, !nameAlreadyRegistered,
          nameAlreadyRegistered
            ? `"${input.proposedName}" matches a cooperative already on the register.`
            : `"${input.proposedName}" is not on the register.`);
        break;
      case "purpose_statement": {
        const len = (input.purpose ?? "").trim().length;
        push(c, len >= FORMATION_THRESHOLDS.minPurposeLength,
          `${len} characters supplied; ${FORMATION_THRESHOLDS.minPurposeLength} required.`);
        break;
      }
      case "location":
        push(c, Boolean(input.sector && input.cell),
          input.sector && input.cell
            ? `Operating area: ${input.cell} cell, ${input.sector} sector.`
            : "Sector and/or cell not stated.");
        break;
      case "contact":
        push(c, Boolean(input.contactName && input.contactPhone),
          input.contactName && input.contactPhone
            ? `${input.contactName} on ${input.contactPhone}.`
            : "Contact name and telephone are incomplete.");
        break;
      default: {
        // Document criteria — presence only.
        const has = attached.has(c.id);
        push(c, has, has ? "Document attached." : "No document attached for this requirement.");
      }
    }
  }

  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  const earned = results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  const score = totalWeight === 0 ? 0 : earned / totalWeight;

  const failedMandatory = results.filter((r) => r.mandatory && !r.passed).map((r) => r.label);
  const missingDocuments = DOCUMENT_CRITERIA.filter((c) => !attached.has(c.id)).map((c) => c.label);

  const eligible = failedMandatory.length === 0 && score >= FORMATION_THRESHOLDS.passMark;

  // Documents are only checked for presence, so the more the verdict rests on
  // them the less certain it is.
  const documentWeight = results
    .filter((r) => DOCUMENT_CRITERIA.some((d) => d.id === r.id))
    .reduce((sum, r) => sum + r.weight, 0);
  const documentShare = totalWeight === 0 ? 0 : documentWeight / totalWeight;
  const confidence = Number((0.95 - documentShare * 0.35).toFixed(2));

  const recommendations: string[] = [];
  for (const r of results.filter((x) => !x.passed)) {
    recommendations.push(`${r.mandatory ? "Required" : "Recommended"}: ${r.requirement}`);
  }
  if (recommendations.length === 0) {
    recommendations.push("All configured criteria are met — proceed to sector officer verification of the documents.");
  }

  return {
    eligible,
    score: Number(score.toFixed(4)),
    confidence,
    passMark: FORMATION_THRESHOLDS.passMark,
    criteria: results,
    failedMandatory,
    missingDocuments,
    recommendations,
    model: "RulesEligibility v1.0 (deterministic — no trained model in use)",
    assessedAt: new Date().toISOString(),
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DISSOLUTION — what each level checks before winding a cooperative up.
 * Reviewed by officers rather than scored automatically, because the decisive
 * facts (the members' vote, settlement of debts) are matters of evidence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DISSOLUTION_CRITERIA: Criterion[] = [
  {
    id: "member_resolution",
    label: "Members' resolution to dissolve",
    requirement: "A general assembly resolution to dissolve, carried by the majority the bylaws require.",
    kind: "data",
    mandatory: true,
    weight: 3,
  },
  {
    id: "liabilities_declared",
    label: "Outstanding liabilities declared",
    requirement: "All outstanding debts and obligations are declared with amounts.",
    kind: "data",
    mandatory: true,
    weight: 3,
  },
  {
    id: "asset_plan",
    label: "Asset disposal and settlement plan",
    requirement: "A plan for realising assets, settling creditors, and distributing any residue to members.",
    kind: "data",
    mandatory: true,
    weight: 3,
  },
  {
    id: "member_settlement",
    label: "Member savings and shares accounted for",
    requirement: "Every member's savings and share balance is accounted for in the settlement plan.",
    kind: "data",
    mandatory: true,
    weight: 2,
  },
];
