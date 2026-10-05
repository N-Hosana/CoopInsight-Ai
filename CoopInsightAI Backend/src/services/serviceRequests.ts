/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RCA SERVICE REQUESTS — WHAT A COOPERATIVE MUST PROVIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Source: Rwanda Cooperative Agency, "Requirements for Cooperatives Requesting
 * Various Services at RCA", read together with Law No. 057/2024 of 20/06/2024
 * governing cooperatives (dissolution: Articles 132–142).
 *
 * Beyond forming and dissolving, a cooperative may ask the RCA to let it change
 * its objective, add activities to its certificate, change its name, or replace
 * a lost certificate. Each has its own checklist, and they share a spine:
 *
 *   • a General Assembly attended by THREE-QUARTERS of eligible members, with
 *     the decision carried by THREE-QUARTERS of those present;
 *   • lists of members, Board and Supervisory Committee with identities and
 *     signatures;
 *   • the ORIGINAL legal personality certificate handed back;
 *   • a fee of RWF 1,000 before the Director General signs the new certificate;
 *   • submission through CMIS.
 *
 * LIKE `governance.ts` AND UNLIKE `eligibility.ts`, THESE ARE NOT LOCAL
 * CONFIGURATION. Each requirement carries the clause it comes from. Changing one
 * asserts that the regulation changed.
 */

import { REINFORCED_MAJORITY } from "./governance";

/** Every service a cooperative can ask the RCA for, plus the two we already had. */
export const SERVICE_REQUEST_TYPES = [
  "formation",
  "dissolution",
  "change_objective",
  "add_activity",
  "change_name",
  "duplicate_certificate",
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

/** The four services introduced by this brochure, as opposed to the original two. */
export const NEW_SERVICE_TYPES: ServiceRequestType[] = [
  "change_objective",
  "add_activity",
  "change_name",
  "duplicate_certificate",
];

export type RequirementKind = "assembly" | "document" | "data" | "payment" | "declaration";

export interface ServiceRequirement {
  id: string;
  label: string;
  /** What the cooperative has to provide, in plain language. */
  requirement: string;
  kind: RequirementKind;
  mandatory: boolean;
  weight: number;
}

export interface ServiceRequestSpec {
  id: ServiceRequestType;
  label: string;
  /** One sentence a manager can understand without reading the law. */
  summary: string;
  lawReference: string;
  /**
   * Which office may file. The cooperative's president answers for it, exactly
   * as with dissolution; an administrator may file on the register's behalf.
   */
  filedBy: "president" | "any_member";
  /** Share of eligible members who must ATTEND the assembly. */
  attendanceFraction: number | null;
  /** Share of those present who must vote in favour. */
  majorityFraction: number | null;
  minutesMustBeNotarized: boolean;
  requiresCertificateReturn: boolean;
  /** RWF payable before the Director General signs the replacement certificate. */
  feeRwf: number | null;
  submittedVia: "CMIS";
  requirements: ServiceRequirement[];
}

/** The fee the brochure sets for a re-issued certificate. */
export const CERTIFICATE_FEE_RWF = 1000;

/** Assembly thresholds the brochure applies to every certificate change. */
export const SERVICE_ATTENDANCE_FRACTION = 0.75;
export const SERVICE_MAJORITY_FRACTION = REINFORCED_MAJORITY; // three-quarters

/**
 * The requirements shared by change of objective, added activities and change
 * of name. Declared once so the three checklists cannot drift apart.
 */
function commonCertificateChangeRequirements(): ServiceRequirement[] {
  return [
    {
      id: "assembly_quorum",
      label: "General Assembly properly attended",
      requirement:
        `Three-quarters of eligible members attended the General Assembly that took the ` +
        `decision.`,
      kind: "assembly",
      mandatory: true,
      weight: 3,
    },
    {
      id: "assembly_majority",
      label: "Decision carried by three-quarters",
      requirement: "Three-quarters of the members present voted in favour.",
      kind: "assembly",
      mandatory: true,
      weight: 3,
    },
    {
      id: "doc_minutes",
      label: "General Assembly minutes",
      requirement: "The minutes of the assembly that took the decision.",
      kind: "document",
      mandatory: true,
      weight: 3,
    },
    {
      id: "reason_stated",
      label: "Reason for the request",
      requirement: "The members' reasons are stated in the request.",
      kind: "data",
      mandatory: true,
      weight: 2,
    },
    {
      id: "doc_member_list",
      label: "List of all members",
      requirement: "Every member, with identity details and signature.",
      kind: "document",
      mandatory: true,
      weight: 2,
    },
    {
      id: "doc_board_list",
      label: "List of Board members",
      requirement: "Board of Directors, with identity details and signatures.",
      kind: "document",
      mandatory: true,
      weight: 2,
    },
    {
      id: "doc_supervisory_list",
      label: "List of Supervisory Committee members",
      requirement: "Supervisory Committee, with identity details and signatures.",
      kind: "document",
      mandatory: true,
      weight: 2,
    },
    {
      id: "share_capital",
      label: "Share capital and share value",
      requirement: "Current share capital and the value of a single share.",
      kind: "data",
      mandatory: true,
      weight: 1,
    },
    {
      id: "certificate_returned",
      label: "Original certificate returned",
      requirement:
        "The original legal personality certificate is handed back to the RCA, which issued it.",
      kind: "declaration",
      mandatory: true,
      weight: 2,
    },
    {
      id: "fee_paid",
      label: `Fee of RWF ${CERTIFICATE_FEE_RWF.toLocaleString()} paid`,
      requirement:
        `RWF ${CERTIFICATE_FEE_RWF.toLocaleString()} is paid before the Director General signs ` +
        "the new certificate.",
      kind: "payment",
      mandatory: true,
      weight: 1,
    },
    {
      id: "cmis_submission",
      label: "Filed through CMIS",
      requirement: "The request is submitted on the designated CMIS form with its attachments.",
      kind: "declaration",
      mandatory: true,
      weight: 1,
    },
  ];
}

export const SERVICE_REQUESTS: Record<ServiceRequestType, ServiceRequestSpec> = {
  formation: {
    id: "formation",
    label: "Register a new cooperative",
    summary: "Apply for legal personality for a cooperative that does not yet exist.",
    lawReference: "Law No. 057/2024 of 20/06/2024 governing cooperatives.",
    filedBy: "any_member",
    attendanceFraction: null,
    majorityFraction: null,
    minutesMustBeNotarized: false,
    requiresCertificateReturn: false,
    feeRwf: null,
    submittedVia: "CMIS",
    // Formation keeps its own, older checklist in services/eligibility.ts —
    // it is the one set of criteria that predates this brochure.
    requirements: [],
  },

  dissolution: {
    id: "dissolution",
    label: "Dissolve the cooperative",
    summary:
      "Wind the cooperative up, distribute what is left, and hand the certificate back. " +
      "Runs in two stages, each with its own General Assembly.",
    lawReference: "Law No. 057/2024 of 20/06/2024, Articles 132–142.",
    filedBy: "president",
    attendanceFraction: SERVICE_ATTENDANCE_FRACTION,
    majorityFraction: SERVICE_MAJORITY_FRACTION,
    minutesMustBeNotarized: false,
    requiresCertificateReturn: true,
    feeRwf: null,
    submittedVia: "CMIS",
    requirements: [
      {
        id: "assembly_quorum",
        label: "First assembly properly attended",
        requirement: "Three-quarters of eligible members attended the assembly that decided to dissolve.",
        kind: "assembly",
        mandatory: true,
        weight: 3,
      },
      {
        id: "assembly_majority",
        label: "Decision carried by three-quarters",
        requirement: "Three-quarters of the members present voted to dissolve.",
        kind: "assembly",
        mandatory: true,
        weight: 3,
      },
      {
        id: "liquidator_appointed",
        label: "Liquidator appointed",
        requirement:
          "The assembly named the person or persons who will collect and distribute the assets.",
        kind: "data",
        mandatory: true,
        weight: 3,
      },
      {
        id: "liquidator_qualified",
        label: "Liquidator is qualified",
        requirement:
          "The liquidator is a financial auditor, an accountant, or otherwise authorised for this work.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
      {
        id: "monitoring_committee",
        label: "Monitoring committee set up",
        requirement: "The assembly appointed members to monitor the dissolution.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
      {
        id: "rca_notified",
        label: "RCA notified within 7 days",
        requirement: "A letter informing the RCA of the decision was sent within 7 days of it.",
        kind: "declaration",
        mandatory: true,
        weight: 2,
      },
      {
        id: "doc_first_minutes",
        label: "First General Assembly minutes",
        requirement:
          "Minutes showing the decision, the liquidator, the monitoring committee, and who " +
          "will show where the assets are.",
        kind: "document",
        mandatory: true,
        weight: 3,
      },
      {
        id: "asset_inventory",
        label: "Inventory of assets and liabilities",
        requirement: "The liquidator has taken an inventory, using an expert where necessary.",
        kind: "declaration",
        mandatory: true,
        weight: 2,
      },
      {
        id: "creditors_notified",
        label: "Creditors notified",
        requirement: "Creditors were told of the dissolution and given the chance to be heard.",
        kind: "declaration",
        mandatory: true,
        weight: 2,
      },
      {
        id: "doc_second_minutes",
        label: "Second General Assembly minutes",
        requirement:
          "Minutes showing the liquidator's report, recovery of loans, payment of creditors, " +
          "how members shared the remainder or the loss, and the return of the certificate.",
        kind: "document",
        mandatory: true,
        weight: 3,
      },
      {
        id: "assets_distributed",
        label: "Remaining assets shared in proportion to shares",
        requirement:
          "After creditors are paid, members share what is left — or bear the loss — in " +
          "proportion to their shares.",
        kind: "declaration",
        mandatory: true,
        weight: 2,
      },
      {
        id: "certificate_returned",
        label: "Original certificate returned",
        requirement: "The original legal personality certificate is handed back to the RCA.",
        kind: "declaration",
        mandatory: true,
        weight: 2,
      },
      {
        id: "cmis_submission",
        label: "Filed through CMIS",
        requirement:
          "The minutes go to the RCA, the District and the Sector through CMIS, and the " +
          "request is submitted there.",
        kind: "declaration",
        mandatory: true,
        weight: 1,
      },
    ],
  },

  change_objective: {
    id: "change_objective",
    label: "Change the cooperative's objective",
    summary:
      "Move the cooperative to a different cluster and value chain. Needs notarized minutes " +
      "and a tax clearance.",
    lawReference: "RCA — Requirements for Cooperatives Requesting Various Services, §3.",
    filedBy: "president",
    attendanceFraction: SERVICE_ATTENDANCE_FRACTION,
    majorityFraction: SERVICE_MAJORITY_FRACTION,
    minutesMustBeNotarized: true,
    requiresCertificateReturn: true,
    feeRwf: CERTIFICATE_FEE_RWF,
    submittedVia: "CMIS",
    requirements: [
      ...commonCertificateChangeRequirements(),
      {
        id: "minutes_notarized",
        label: "Minutes notarized",
        requirement: "The General Assembly minutes are notarized.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
      {
        id: "rra_clearance",
        label: "RRA tax clearance",
        requirement:
          "A certificate from the RRA showing the cooperative has no outstanding tax arrears.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
      {
        id: "new_objective_stated",
        label: "New objective stated",
        requirement: "The proposed new objective, cluster and value chain are set out.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
    ],
  },

  add_activity: {
    id: "add_activity",
    label: "Add activities to the certificate",
    summary:
      "Add one or more activities to the legal personality certificate. They must sit in the " +
      "same value chain as the licensed ones.",
    lawReference: "RCA — Requirements for Cooperatives Requesting Various Services, §4.",
    filedBy: "president",
    attendanceFraction: SERVICE_ATTENDANCE_FRACTION,
    majorityFraction: SERVICE_MAJORITY_FRACTION,
    minutesMustBeNotarized: false,
    requiresCertificateReturn: true,
    feeRwf: CERTIFICATE_FEE_RWF,
    submittedVia: "CMIS",
    requirements: [
      ...commonCertificateChangeRequirements(),
      {
        id: "activities_listed",
        label: "Activities to be added are listed",
        requirement: "Each activity the cooperative wants added is named.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
      {
        id: "same_value_chain",
        label: "Activities are in the same value chain",
        requirement:
          "The request shows the new activities are in the same value chain as those the " +
          "cooperative is already licensed for.",
        kind: "data",
        mandatory: true,
        weight: 3,
      },
    ],
  },

  change_name: {
    id: "change_name",
    label: "Change the cooperative's name",
    summary:
      "Trade under a new name. The heaviest of the certificate changes: notarized minutes, a " +
      "balance sheet, and proof that creditors were told.",
    lawReference: "RCA — Requirements for Cooperatives Requesting Various Services, §5.",
    filedBy: "president",
    attendanceFraction: SERVICE_ATTENDANCE_FRACTION,
    majorityFraction: SERVICE_MAJORITY_FRACTION,
    minutesMustBeNotarized: true,
    requiresCertificateReturn: true,
    feeRwf: CERTIFICATE_FEE_RWF,
    submittedVia: "CMIS",
    requirements: [
      ...commonCertificateChangeRequirements(),
      {
        id: "minutes_notarized",
        label: "Minutes notarized",
        requirement: "The General Assembly minutes are notarized.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
      {
        id: "new_name_stated",
        label: "New name stated and available",
        requirement:
          "The proposed name is given and is not already used by a registered cooperative.",
        kind: "data",
        mandatory: true,
        weight: 3,
      },
      {
        id: "doc_balance_sheet",
        label: "Balance sheet to the date of the decision",
        requirement:
          "A balance sheet showing the components and value of the assets up to the day the " +
          "assembly decided on the change.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
      {
        id: "debts_disclosed",
        label: "Debtors and creditors disclosed",
        requirement: "Who the cooperative owes, who owes it, and the amounts.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
      {
        id: "creditors_notified",
        label: "Creditors notified of the change",
        requirement: "Proof that creditors were told the name is changing.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
    ],
  },

  duplicate_certificate: {
    id: "duplicate_certificate",
    label: "Replace a lost certificate (duplicate)",
    summary:
      "Get a replacement legal personality certificate after loss, damage or theft. No " +
      "assembly is needed — but the RIB is.",
    lawReference: "RCA — Requirements for Cooperatives Requesting Various Services, §6.",
    filedBy: "president",
    // A duplicate replaces a document; it does not change what the members
    // resolved, so the brochure asks for no assembly at all.
    attendanceFraction: null,
    majorityFraction: null,
    minutesMustBeNotarized: false,
    requiresCertificateReturn: false,
    feeRwf: null,
    submittedVia: "CMIS",
    requirements: [
      {
        id: "doc_rib_certificate",
        label: "RIB certificate",
        requirement:
          "A certificate from the Rwanda Investigation Bureau stating why the cooperative no " +
          "longer holds its certificate.",
        kind: "document",
        mandatory: true,
        weight: 3,
      },
      {
        id: "loss_circumstances",
        label: "Circumstances of the loss",
        requirement: "Whether the certificate was lost, damaged or stolen, and how.",
        kind: "data",
        mandatory: true,
        weight: 2,
      },
      {
        id: "doc_certificate_copy",
        label: "Copy of the previous certificate",
        requirement: "A copy of the certificate previously issued, if one is available.",
        kind: "document",
        mandatory: false,
        weight: 1,
      },
      {
        id: "doc_dg_letter",
        label: "Letter to the Director General",
        requirement: "A letter to the RCA Director General requesting the duplicate.",
        kind: "document",
        mandatory: true,
        weight: 2,
      },
      {
        id: "cmis_submission",
        label: "Filed through CMIS",
        requirement: "The request is submitted electronically through CMIS.",
        kind: "declaration",
        mandatory: true,
        weight: 1,
      },
    ],
  },
};

/** A request scoring at or above this is predicted to meet the requirements. */
export const SERVICE_PASS_MARK = 0.8;

export interface ServiceAssessmentInput {
  /** Members entitled to sit in the assembly (delegates above 100 members). */
  membersEligible?: number | null;
  membersPresent?: number | null;
  votesFor?: number | null;
  votesAgainst?: number | null;
  votesAbstain?: number | null;
  reason?: string | null;
  minutesNotarized?: boolean;
  certificateReturned?: boolean;
  feePaidRwf?: number | null;
  rraClearance?: boolean;
  creditorsNotified?: boolean;
  cmisReference?: string | null;
  shareCapital?: number | null;
  shareValue?: number | null;
  proposedName?: string | null;
  nameTaken?: boolean;
  proposedObjective?: string | null;
  addedActivities?: string[];
  sameValueChainJustification?: string | null;
  lossCircumstances?: string | null;
  /** Requirement ids covered by an attached file. */
  attachedDocumentIds?: string[];
  /** Dissolution-specific. */
  liquidatorName?: string | null;
  liquidatorQualification?: string | null;
  monitoringCommittee?: string[];
  rcaNotifiedAt?: string | null;
  decisionAt?: string | null;
  assetInventoryDone?: boolean;
  assetsDistributed?: boolean;
}

export interface ServiceAssessment {
  type: ServiceRequestType;
  score: number;
  passMark: number;
  eligible: boolean;
  results: Array<{ id: string; label: string; mandatory: boolean; passed: boolean; finding: string }>;
  failedMandatory: string[];
  missingDocuments: string[];
  recommendations: string[];
  model: string;
}

/** Qualifications the brochure accepts for a liquidator. */
export const LIQUIDATOR_QUALIFICATIONS = [
  "financial_auditor",
  "accountant",
  "authorised_by_competent_authority",
] as const;

/** Days within which the RCA must be told of a dissolution decision. */
export const RCA_NOTIFICATION_DAYS = 7;

/**
 * Scores a service request against its checklist.
 *
 * Deterministic rules, like the formation assessor: there are no labelled past
 * requests to learn from, and an officer has to be able to tell a cooperative
 * exactly which line it failed.
 */
export function assessServiceRequest(
  type: ServiceRequestType,
  input: ServiceAssessmentInput
): ServiceAssessment {
  const spec = SERVICE_REQUESTS[type];
  const attached = new Set(input.attachedDocumentIds ?? []);
  const results: ServiceAssessment["results"] = [];

  const present = input.membersPresent ?? 0;
  const eligible = input.membersEligible ?? 0;
  const votesFor = input.votesFor ?? 0;
  const votesAgainst = input.votesAgainst ?? 0;
  const votesAbstain = input.votesAbstain ?? 0;
  const cast = votesFor + votesAgainst + votesAbstain;

  const check = (id: string, passed: boolean, finding: string) => {
    const requirement = spec.requirements.find((r) => r.id === id);
    if (!requirement) return;
    results.push({
      id,
      label: requirement.label,
      mandatory: requirement.mandatory,
      passed,
      finding,
    });
  };

  for (const requirement of spec.requirements) {
    switch (requirement.id) {
      case "assembly_quorum": {
        const needed = Math.ceil(eligible * (spec.attendanceFraction ?? 0));
        check(
          requirement.id,
          eligible > 0 && present >= needed,
          eligible === 0
            ? "The number of members entitled to attend was not recorded."
            : `${present} of ${eligible} attended; ${needed} were required ` +
              `(${Math.round((spec.attendanceFraction ?? 0) * 100)}%).`
        );
        break;
      }
      case "assembly_majority": {
        const share = cast > 0 ? votesFor / cast : 0;
        check(
          requirement.id,
          cast > 0 && share >= (spec.majorityFraction ?? 0),
          cast === 0
            ? "No vote was recorded."
            : `${votesFor} of ${cast} votes in favour (${Math.round(share * 100)}%); ` +
              `${Math.round((spec.majorityFraction ?? 0) * 100)}% required.`
        );
        break;
      }
      case "reason_stated":
        check(
          requirement.id,
          (input.reason ?? "").trim().length >= 30,
          `${(input.reason ?? "").trim().length} characters of explanation given; 30 required.`
        );
        break;
      case "minutes_notarized":
        check(requirement.id, input.minutesNotarized === true,
          input.minutesNotarized ? "Declared notarized." : "The minutes are not declared notarized.");
        break;
      case "certificate_returned":
        check(requirement.id, input.certificateReturned === true,
          input.certificateReturned
            ? "The original certificate has been handed back."
            : "The original certificate has not been returned.");
        break;
      case "fee_paid":
        check(
          requirement.id,
          (input.feePaidRwf ?? 0) >= (spec.feeRwf ?? 0),
          `RWF ${(input.feePaidRwf ?? 0).toLocaleString()} recorded against a fee of ` +
            `RWF ${(spec.feeRwf ?? 0).toLocaleString()}.`
        );
        break;
      case "cmis_submission":
        check(requirement.id, Boolean((input.cmisReference ?? "").trim()),
          input.cmisReference ? `CMIS reference ${input.cmisReference}.` : "No CMIS reference given.");
        break;
      case "share_capital":
        check(
          requirement.id,
          (input.shareCapital ?? 0) > 0 && (input.shareValue ?? 0) > 0,
          `Share capital RWF ${(input.shareCapital ?? 0).toLocaleString()}, ` +
            `share value RWF ${(input.shareValue ?? 0).toLocaleString()}.`
        );
        break;
      case "rra_clearance":
        check(
          requirement.id,
          input.rraClearance === true || attached.has("rra_clearance"),
          input.rraClearance ? "Tax clearance declared." : "No RRA tax clearance on file."
        );
        break;
      case "new_name_stated":
        check(
          requirement.id,
          Boolean((input.proposedName ?? "").trim()) && input.nameTaken !== true,
          !(input.proposedName ?? "").trim()
            ? "No new name was given."
            : input.nameTaken
              ? `"${input.proposedName}" is already used by a registered cooperative.`
              : `"${input.proposedName}" is available.`
        );
        break;
      case "new_objective_stated":
        check(
          requirement.id,
          (input.proposedObjective ?? "").trim().length >= 20,
          (input.proposedObjective ?? "").trim()
            ? "New objective stated."
            : "No new objective was given."
        );
        break;
      case "activities_listed":
        check(
          requirement.id,
          (input.addedActivities ?? []).length > 0,
          `${(input.addedActivities ?? []).length} activity/activities listed.`
        );
        break;
      case "same_value_chain":
        check(
          requirement.id,
          (input.sameValueChainJustification ?? "").trim().length >= 30,
          (input.sameValueChainJustification ?? "").trim().length >= 30
            ? "Value-chain justification given."
            : "The request does not show the activities are in the same value chain."
        );
        break;
      case "debts_disclosed":
        check(
          requirement.id,
          attached.has("debts_disclosed") || (input.reason ?? "").length > 0,
          attached.has("debts_disclosed")
            ? "Schedule of debtors and creditors attached."
            : "No schedule of debtors and creditors was attached."
        );
        break;
      case "creditors_notified":
        check(
          requirement.id,
          input.creditorsNotified === true || attached.has("creditors_notified"),
          input.creditorsNotified
            ? "Creditors were notified."
            : "No proof that creditors were notified."
        );
        break;
      case "loss_circumstances":
        check(
          requirement.id,
          (input.lossCircumstances ?? "").trim().length >= 20,
          (input.lossCircumstances ?? "").trim().length >= 20
            ? "Circumstances of the loss described."
            : "The circumstances of the loss are not described."
        );
        break;
      case "liquidator_appointed":
        check(
          requirement.id,
          Boolean((input.liquidatorName ?? "").trim()),
          input.liquidatorName
            ? `${input.liquidatorName} appointed.`
            : "No liquidator was named by the assembly."
        );
        break;
      case "liquidator_qualified":
        check(
          requirement.id,
          (LIQUIDATOR_QUALIFICATIONS as readonly string[]).includes(input.liquidatorQualification ?? ""),
          input.liquidatorQualification
            ? `Recorded as ${input.liquidatorQualification.replace(/_/g, " ")}.`
            : "The liquidator's qualification was not recorded. The brochure requires a " +
              "financial auditor, an accountant, or someone authorised for this work."
        );
        break;
      case "monitoring_committee":
        check(
          requirement.id,
          (input.monitoringCommittee ?? []).length > 0,
          `${(input.monitoringCommittee ?? []).length} member(s) appointed to monitor the process.`
        );
        break;
      case "rca_notified": {
        const decided = input.decisionAt ? new Date(input.decisionAt) : null;
        const notified = input.rcaNotifiedAt ? new Date(input.rcaNotifiedAt) : null;
        const withinWindow =
          decided && notified
            ? (notified.getTime() - decided.getTime()) / 86_400_000 <= RCA_NOTIFICATION_DAYS
            : false;
        check(
          requirement.id,
          withinWindow,
          !notified
            ? `The RCA has not been told of the decision. The letter is due within ` +
              `${RCA_NOTIFICATION_DAYS} days.`
            : withinWindow
              ? "The RCA was notified inside the 7-day window."
              : `The RCA was notified more than ${RCA_NOTIFICATION_DAYS} days after the decision.`
        );
        break;
      }
      case "asset_inventory":
        check(requirement.id, input.assetInventoryDone === true,
          input.assetInventoryDone ? "Inventory taken." : "No inventory of assets and liabilities.");
        break;
      case "assets_distributed":
        check(requirement.id, input.assetsDistributed === true,
          input.assetsDistributed
            ? "Remaining assets shared in proportion to shares."
            : "The remaining assets have not yet been shared.");
        break;
      default:
        // Everything else is satisfied by attaching the document it names.
        if (requirement.kind === "document") {
          check(
            requirement.id,
            attached.has(requirement.id),
            attached.has(requirement.id) ? "Attached." : "Not attached."
          );
        } else {
          check(requirement.id, false, "Not provided.");
        }
    }
  }

  const totalWeight = spec.requirements.reduce((sum, r) => sum + r.weight, 0);
  const earned = results.reduce((sum, r) => {
    const weight = spec.requirements.find((x) => x.id === r.id)?.weight ?? 0;
    return sum + (r.passed ? weight : 0);
  }, 0);
  const score = totalWeight > 0 ? earned / totalWeight : 0;

  const failedMandatory = results.filter((r) => !r.passed && r.mandatory).map((r) => r.label);
  const missingDocuments = spec.requirements
    .filter((r) => r.kind === "document" && !attached.has(r.id))
    .map((r) => r.label);

  const recommendations: string[] = [];
  for (const failure of results.filter((r) => !r.passed)) {
    const requirement = spec.requirements.find((r) => r.id === failure.id);
    if (requirement) recommendations.push(requirement.requirement);
  }

  return {
    type,
    score: Number(score.toFixed(4)),
    passMark: SERVICE_PASS_MARK,
    eligible: failedMandatory.length === 0 && score >= SERVICE_PASS_MARK,
    results,
    failedMandatory,
    missingDocuments,
    recommendations,
    model: "ServiceRequestRules v1.0 (deterministic)",
  };
}
