/**
 * ─────────────────────────────────────────────────────────────────────────────
 * COOPERATIVE GOVERNANCE — THE RCA RULEBOOK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Source: Rwanda Cooperative Agency, "Cooperative Organs: Their Powers and
 * Responsibilities" (brochure, translated from Kinyarwanda).
 *
 * This file is the single place the app encodes how a cooperative governs
 * itself: who may convene an assembly, how much notice it needs, when it is
 * competent to sit, what majority carries a decision, and what has to be
 * reported afterwards and to whom.
 *
 * UNLIKE `eligibility.ts` AND `permits.ts`, THE FIGURES BELOW ARE NOT LOCAL
 * CONFIGURATION. They are taken from the published RCA brochure and each one
 * carries the clause it comes from. Changing a number here is asserting that
 * the regulation changed — not that this deployment prefers a different value.
 * Re-check against the brochure in force before editing, and keep the citation
 * next to whatever you change.
 *
 * Anything the brochure does not settle is marked DEPLOYMENT CHOICE.
 */

// ─── Meeting kinds ───────────────────────────────────────────────────────────

/**
 * "A cooperative holds ordinary and extraordinary General Assembly meetings.
 *  Ordinary meetings are held in March and October. Extraordinary meetings can
 *  be held whenever necessary."
 */
export type AssemblyKind = "ordinary" | "extraordinary";

/** Calendar months (1-based) in which the ordinary General Assembly sits. */
export const ORDINARY_ASSEMBLY_MONTHS = [3, 10] as const;

export const ORDINARY_ASSEMBLY_MONTH_NAMES = "March and October";

/**
 * "First General Assembly: it meets within 15 days of the cooperative receiving
 *  its legal personality certificate."
 */
export const FIRST_ASSEMBLY_DAYS = 15;

/**
 * "In a primary cooperative with more than 100 members, [the General Assembly]
 *  is made up of delegates elected by their peers."
 *
 * Above this size, quorum is counted against the delegate body, not the whole
 * register. The number of delegates is set by the National Agency's
 * instructions, so the app cannot derive it — it has to be recorded.
 */
export const DELEGATE_THRESHOLD_MEMBERS = 100;

// ─── Notice ──────────────────────────────────────────────────────────────────

/**
 * "[Invitations] must reach attendees at least 7 days before an ordinary
 *  meeting or 3 days before an extraordinary one."
 */
export const NOTICE_DAYS: Record<AssemblyKind, number> = {
  ordinary: 7,
  extraordinary: 3,
};

/**
 * "The invitation states the time, date, venue and agenda."
 * Used to validate that a convening request is complete.
 */
export const INVITATION_REQUIRED_FIELDS = ["time", "date", "venue", "agenda"] as const;

// ─── Quorum ──────────────────────────────────────────────────────────────────

/**
 * "Ordinary: at least two-thirds of eligible members or their representatives.
 *  If not reached, a second meeting is called within the next 7 days.
 *  Extraordinary: at least three-quarters. If not reached, a second meeting is
 *  called within the next 3 working days.
 *  On the second call, either meeting is valid if one-half of the members ...
 *  attend.
 *  If two calls fail to reach quorum, the matter goes to the National Agency
 *  for direction."
 */
export const QUORUM_FRACTION: Record<AssemblyKind, { first: number; second: number }> = {
  ordinary: { first: 2 / 3, second: 1 / 2 },
  extraordinary: { first: 3 / 4, second: 1 / 2 },
};

/** How soon a failed first call must be followed by a second. */
export const SECOND_CALL_WINDOW: Record<
  AssemblyKind,
  { amount: number; unit: "days" | "working days" }
> = {
  ordinary: { amount: 7, unit: "days" },
  extraordinary: { amount: 3, unit: "working days" },
};

/** Which call this is. A third call is not provided for; the matter escalates. */
export type AssemblyCall = 1 | 2;

/**
 * How many attendees make the assembly competent.
 *
 * `eligible` is the number of members entitled to sit — which above
 * DELEGATE_THRESHOLD_MEMBERS is the delegate body, not the whole register.
 */
export function quorumRequired(
  kind: AssemblyKind,
  call: AssemblyCall,
  eligible: number
): number {
  const fraction = call === 1 ? QUORUM_FRACTION[kind].first : QUORUM_FRACTION[kind].second;
  return Math.ceil(eligible * fraction);
}

/** Plain-language explanation of the quorum that applied, for the minutes. */
export function quorumBasis(kind: AssemblyKind, call: AssemblyCall, eligible: number): string {
  const fraction = call === 1 ? QUORUM_FRACTION[kind].first : QUORUM_FRACTION[kind].second;
  const label = call === 1 ? "first call" : "second call";
  const pct = Math.round(fraction * 100);
  return (
    `${quorumRequired(kind, call, eligible)} of ${eligible} (${pct}%, ${kind} assembly, ${label}).`
  );
}

// ─── Decisions ───────────────────────────────────────────────────────────────

/**
 * "Decisions are taken by absolute majority of votes cast. If none is reached,
 *  the vote is repeated. However, decisions on amending the statutes, joining
 *  other cooperatives in a federation/confederation/union, merging, converting
 *  into a company, or dissolving the cooperative require an Assembly attended
 *  and voted on by at least three-quarters of the members or representatives
 *  present."
 */
export const ABSOLUTE_MAJORITY = 0.5;
export const REINFORCED_MAJORITY = 0.75;

/** The matters the brochure reserves to a three-quarters majority. */
export const RESERVED_MATTERS = [
  "amend_statutes",
  "join_federation",
  "merge",
  "convert_to_company",
  "dissolve",
] as const;
export type ReservedMatter = (typeof RESERVED_MATTERS)[number];

/**
 * Ordinary business — approving minutes, electing organs, admitting members,
 * and (relevantly here) releasing a member who has asked to leave. Not reserved,
 * so absolute majority applies.
 */
export type AssemblyMatter = ReservedMatter | "ordinary_business";

export function isReservedMatter(matter: AssemblyMatter): matter is ReservedMatter {
  return (RESERVED_MATTERS as readonly string[]).includes(matter);
}

/** The share of votes cast a resolution on `matter` must carry. */
export function majorityRequired(matter: AssemblyMatter): number {
  return isReservedMatter(matter) ? REINFORCED_MAJORITY : ABSOLUTE_MAJORITY;
}

/**
 * Does the vote carry?
 *
 * Absolute majority means *more than* half of the votes cast — a tie does not
 * carry, and the brochure says the vote is then repeated. A reserved matter
 * needs at least three-quarters, and the brochure additionally requires the
 * assembly to be *attended* by three-quarters, which is checked as quorum.
 */
export function voteCarries(
  matter: AssemblyMatter,
  votesFor: number,
  votesAgainst: number,
  votesAbstain: number
): { carried: boolean; cast: number; share: number; required: number; basis: string } {
  const cast = votesFor + votesAgainst + votesAbstain;
  const required = majorityRequired(matter);
  const share = cast > 0 ? votesFor / cast : 0;
  // Reserved matters are "at least" three-quarters; ordinary business is a
  // strict majority of the votes cast.
  const carried = cast > 0 && (isReservedMatter(matter) ? share >= required : share > required);
  return {
    carried,
    cast,
    share,
    required,
    basis:
      cast === 0
        ? "No votes were recorded."
        : `${votesFor} for, ${votesAgainst} against, ${votesAbstain} abstained ` +
          `(${Math.round(share * 100)}% of ${cast} cast; ` +
          `${isReservedMatter(matter) ? "at least" : "more than"} ${Math.round(required * 100)}% required).`,
  };
}

// ─── Reporting after the meeting ─────────────────────────────────────────────

/**
 * "The report goes to the Sector and District administrations where the
 *  cooperative is based within 3 working days of the meeting, and to the
 *  National Agency within 7 days."
 */
export const REPORT_DEADLINES = {
  sectorAndDistrictWorkingDays: 3,
  nationalAgencyDays: 7,
};

/** Adds `n` working days (Mon–Fri), used for the sector/district deadline. */
export function addWorkingDays(from: Date, n: number): Date {
  const out = new Date(from);
  let added = 0;
  while (added < n) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return out;
}

export function addDays(from: Date, n: number): Date {
  const out = new Date(from);
  out.setDate(out.getDate() + n);
  return out;
}

/** The two deadlines that attach to a meeting once it has been held. */
export function reportDeadlines(heldAt: Date) {
  return {
    sectorAndDistrict: addWorkingDays(heldAt, REPORT_DEADLINES.sectorAndDistrictWorkingDays),
    nationalAgency: addDays(heldAt, REPORT_DEADLINES.nationalAgencyDays),
  };
}

// ─── Who may convene ─────────────────────────────────────────────────────────

/**
 * "It is convened by the Board President, or the Vice President if the
 *  President is absent, on their own initiative or at the request of at least
 *  three Board members, or at least one-third of the members or their
 *  representatives ... If the above is not possible, the National Agency may
 *  convene an extraordinary General Assembly in the public interest."
 */
export const CONVENER_OFFICES = ["President", "Vice President"] as const;
export const CONVENE_ON_REQUEST_OF = {
  boardMembers: 3,
  memberFraction: 1 / 3,
};

/** Leadership titles that satisfy "Board President or Vice President". */
export const CONVENER_TITLE_KEYWORDS = ["president", "chairperson", "chairman", "chairwoman"];

// ─── Board of Directors ──────────────────────────────────────────────────────

/**
 * "The Board has five members: a President, Vice President, Secretary and two
 *  advisors, elected by the General Assembly ... a cooperative may have more
 *  than five, but the number must be odd."
 * "Term: Five years, renewable once."
 * "The National Agency approves Board members before they start work, within 7
 *  working days of receiving the election report."
 */
export const BOARD = {
  standardSize: 5,
  mustBeOdd: true,
  offices: ["President", "Vice President", "Secretary", "Advisor", "Advisor"] as const,
  /** The three named offices; the remaining seats are advisors. */
  namedOffices: ["President", "Vice President", "Secretary"] as const,
  termYears: 5,
  renewals: 1,
  agencyApprovalWorkingDays: 7,
};

/**
 * "The Board meets once per quarter and whenever necessary, but no more than
 *  twice a month. Quorum is two-thirds of its members."
 */
export const BOARD_MEETINGS = {
  minimumPerQuarter: 1,
  maximumPerMonth: 2,
  quorumFraction: 2 / 3,
  /** "It can also be convened at the request of three members." */
  convenedOnRequestOf: 3,
};

/**
 * "If many or all members have such an interest, the matter goes to the
 *  National Agency, which decides within 30 days."
 */
export const CONFLICT_OF_INTEREST_AGENCY_DAYS = 30;

// ─── Organs ──────────────────────────────────────────────────────────────────

/**
 * "(a) General Assembly; (b) Board of Directors; (c) Supervisory Committee;
 *  (d) Special committees."
 *
 * Only the General Assembly and the Board are modelled in this system today.
 * The Supervisory Committee and special committees are recognised here so the
 * gap is explicit rather than silent.
 */
export const COOPERATIVE_ORGANS = [
  { id: "general_assembly", label: "General Assembly", modelled: true },
  { id: "board_of_directors", label: "Board of Directors", modelled: true },
  { id: "supervisory_committee", label: "Supervisory Committee", modelled: false },
  { id: "special_committees", label: "Special committees", modelled: false },
] as const;

/**
 * "The National Agency can annul any act or decision of the General Assembly
 *  that contradicts the principles, laws and regulations governing
 *  cooperatives."
 */
export const AGENCY_MAY_ANNUL_ASSEMBLY_DECISIONS = true;

/**
 * Leadership titles this system recognises. The Supervisory Committee was
 * previously named but unmodelled; the RCA service-request checklists require
 * its membership list, so it is a first-class role now.
 */
export const LEADERSHIP_ROLES = [
  "President",
  "Vice President",
  "Secretary",
  "Advisor",
  "Supervisory Committee Member",
  "Liquidator",
  "Sector Cooperative Officer",
] as const;

/** Roles that occupy a seat on the Board of Directors. */
export const BOARD_ROLES = ["President", "Vice President", "Secretary", "Advisor"] as const;

// ─── The liquidator ──────────────────────────────────────────────────────────

/**
 * Source: RCA — Requirements for Cooperatives Requesting Various Services, §7.
 *
 * "The person must be a financial auditor, an accountant, or another person
 *  authorized to do this work by the competent authority."
 *
 * The sixteen duties are listed so the appointment screen can show a
 * cooperative what it is actually asking someone to take on, rather than
 * reducing the role to a name in a box.
 */
export const LIQUIDATOR_DUTIES = [
  "Take possession of all the assets, books and management records.",
  "Take all necessary measures to prevent the assets being harmed or damaged.",
  "Continue the cooperative's work for as long as collection and distribution require.",
  "Distribute the assets fairly, once the plan is approved by the monitoring committee, the members and the RCA.",
  "Set a deadline for creditors to submit claims so they can be examined, accepted or removed.",
  "Appoint a legal adviser if necessary, but only after RCA approval.",
  "File lawsuits and act in the cooperative's name where the law requires.",
  "Review all claims against the cooperative and decide how they are handled.",
  "Pay creditors, with interest accrued to the date of dissolution where agreed, following any priority list.",
  "Refer disputed matters back to the body that made the appointment.",
  "Work with the monitoring committee to open and operate the collection account.",
  "Convene extraordinary assemblies of members or meetings of creditors whenever necessary.",
  "Identify and confirm members, former members, and representatives of deceased members.",
  "Identify debts owed to the cooperative and arrange for them to be paid.",
  "Do everything else needed to close the cooperative and distribute its assets.",
  "Report whenever necessary, and when the work is complete.",
] as const;

// ─── The independent auditor ─────────────────────────────────────────────────

/**
 * Source: RCA — Requirements for Cooperatives Requesting Various Services, §8.
 *
 * "A person ... becomes an independent auditor of a cooperative only when
 *  approved by the cooperative's General Assembly from the list of independent
 *  auditors approved by RCA."
 */
export const AUDITOR_MUST_BE_ON_RCA_LIST = true;
export const AUDITOR_MUST_BE_APPROVED_BY_ASSEMBLY = true;

/**
 * The six circumstances in which a person may not audit a cooperative. Each is
 * a question the appointment screen asks before the name can be recorded — a
 * conflicted auditor invalidates the audit, and the cheapest place to catch
 * that is before the engagement, not after the report.
 */
export const AUDITOR_DISQUALIFICATIONS = [
  {
    id: "was_insider",
    label: "Was a Board member, manager or staff involved in managing assets",
    detail: "During the audited year or the year before it.",
  },
  {
    id: "related_to_insider",
    label: "Spouse of, or directly related to, a staff or Board member",
    detail: "Related directly up to the first degree.",
  },
  {
    id: "holds_assets",
    label: "Is responsible for receiving the cooperative's assets",
    detail: "",
  },
  { id: "owes_money", label: "Owes the cooperative money", detail: "" },
  {
    id: "was_expelled",
    label: "Was expelled from a cooperative of which they were a member",
    detail: "",
  },
  { id: "has_interests", label: "Has direct interests in the cooperative", detail: "" },
] as const;

export type AuditorDisqualificationId = (typeof AUDITOR_DISQUALIFICATIONS)[number]["id"];

/** What the independent audit must cover. */
export const AUDIT_SCOPE = [
  "The cooperative's books and balance sheet.",
  "Governance and management of the cooperative and its staff.",
  "How resolutions of the cooperative's meetings have been implemented.",
  "Beneficiary and stakeholder information records.",
  "The list of members, and anything else the cooperative or an authority requests.",
] as const;

/** The auditor's duties of conduct, and what they are liable for. */
export const AUDITOR_CONDUCT = {
  duties: [
    "Work with care and diligence and comply with the laws governing the auditing profession.",
    "Keep confidential everything learned about the cooperative while auditing.",
  ],
  liableFor: [
    "Negligence at work.",
    "Deliberately disclosing confidential information seen or learned on the job.",
    "Failing to comply with the laws governing the auditing profession.",
  ],
};

/** Who else may audit, besides the cooperative's own appointee. */
export const OTHER_AUDIT_ROUTES = [
  "The RCA, or a person it authorises, may carry out an audit.",
  "A qualified person the cooperative selects from the RCA-approved list.",
  "The District, under a performance and cooperation agreement with the RCA.",
];

/**
 * Is this person eligible to audit? Returns the disqualifications that bite, so
 * the cooperative is told which one rather than simply "not eligible".
 */
export function auditorEligibility(input: {
  onRcaApprovedList: boolean;
  approvedByAssembly: boolean;
  disqualifications: string[];
}): { eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!input.onRcaApprovedList) {
    blockers.push(
      "An independent auditor must be drawn from the list of auditors approved by the RCA."
    );
  }
  if (!input.approvedByAssembly) {
    blockers.push("The cooperative's General Assembly has not approved this auditor.");
  }
  for (const id of input.disqualifications) {
    const rule = AUDITOR_DISQUALIFICATIONS.find((d) => d.id === id);
    if (rule) blockers.push(`Disqualified: ${rule.label.toLowerCase()}.`);
  }
  return { eligible: blockers.length === 0, blockers };
}

// ─── Convenience for the routes and the UI ───────────────────────────────────

/** Everything the assembly screens need, in one payload. */
export function assemblyPolicy(kind: AssemblyKind, matter: AssemblyMatter) {
  return {
    kind,
    matter,
    noticeDays: NOTICE_DAYS[kind],
    quorumFirstCall: QUORUM_FRACTION[kind].first,
    quorumSecondCall: QUORUM_FRACTION[kind].second,
    secondCallWindow: SECOND_CALL_WINDOW[kind],
    majorityRequired: majorityRequired(matter),
    reserved: isReservedMatter(matter),
    reportDeadlines: REPORT_DEADLINES,
    delegateThreshold: DELEGATE_THRESHOLD_MEMBERS,
    ordinaryMonths: ORDINARY_ASSEMBLY_MONTHS,
    source:
      "Rwanda Cooperative Agency — Cooperative Organs: Their Powers and Responsibilities.",
  };
}
