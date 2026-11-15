/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RCA AUDITS — WHO MAY ASK, WHO DECIDES, AND EVERY STAGE IN BETWEEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two kinds of audit, and two ways an audit comes about.
 *
 *   KINDS     general     — governance, the register, meetings, compliance
 *             financial   — the books, the money, the loans, the assets
 *
 *   ORIGINS   requested     — somebody in authority asks for one, with reasons
 *                             and a suggested date, and it climbs the chain
 *             rca_initiated — the RCA officer announces one on their own
 *                             initiative; nobody has to ask
 *
 * A REQUESTED audit climbs from whoever filed it to the RCA officer for the
 * district, one tier at a time — a cooperative manager's request is seen by the
 * sector, then the district, then the RCA. The RCA officer approves (fixing the
 * date and what will be checked), rejects, or puts it on the waiting list. An
 * approval then travels back DOWN through the same tiers it came up, so each of
 * them knows it is going ahead, until it reaches the person who asked, who
 * confirms it.
 *
 * Once an audit is confirmed the cooperative's manager can put it on the
 * calendar and tell every member — the same calendar entry and broadcast an
 * assembly gets.
 *
 * Separately, the GENERAL AUDIT PROGRAMME is the routine: a sector committee
 * visits the sector's cooperatives every month, a district committee every
 * trimester, and once a trimester the district gathers every cooperative's
 * leaders for a sensitization (refresher) session on what they should be doing
 * and where they are falling short.
 *
 * The CADENCES and the SCOPE CHECKLISTS below are working configuration agreed
 * for this system, not quoted regulation. Changing them is a policy decision,
 * not a bug fix.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────────

export const AUDIT_KINDS = ["general", "financial"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  general: "General audit",
  financial: "Financial audit",
};

export type RequesterLevel = "cooperative" | "sector" | "district" | "rca";
export type Origin = "requested" | "rca_initiated";

export const REASON_CATEGORIES = [
  { id: "suspected_mismanagement", label: "Suspected mismanagement" },
  { id: "financial_irregularity", label: "Financial irregularity or missing money" },
  { id: "member_complaints", label: "Complaints from members" },
  { id: "leadership_dispute", label: "Leadership dispute or handover" },
  { id: "pre_support", label: "Before funding, a loan or external support" },
  { id: "routine_check", label: "Routine check — no specific concern" },
  { id: "other", label: "Other" },
] as const;
export const REASON_CATEGORY_IDS: string[] = REASON_CATEGORIES.map((r) => r.id);

/** A reason has to say enough for an officer to judge it. */
export const MIN_REASON_LENGTH = 40;

/** How long each tier has to act before its step shows as overdue. */
export const AUDIT_STEP_RESPONSE_DAYS = 7;

/** How many days' notice the cooperative is given of an audit at the least. */
export const MIN_AUDIT_NOTICE_DAYS = 3;

/** The one district this deployment covers. */
export const DISTRICT_NAME = "Gasabo";

/**
 * What the auditors may be asked to look at. The RCA officer ticks what this
 * audit will cover and may add anything else; the cooperative sees the list in
 * advance so it can have the records ready.
 */
export const AUDIT_SCOPE: Record<AuditKind, Array<{ id: string; label: string; detail: string }>> = {
  general: [
    { id: "gen_organs", label: "Governing organs", detail: "The Board and the Supervisory Committee exist, meet, and keep minutes." },
    { id: "gen_assembly", label: "General assembly", detail: "An ordinary general assembly was held this year and its minutes are signed." },
    { id: "gen_register", label: "Member register", detail: "The register is current: joins, exits and shares recorded." },
    { id: "gen_bylaws", label: "Bylaws respected", detail: "Decisions follow the cooperative's own bylaws and the law." },
    { id: "gen_leadership", label: "Leadership terms", detail: "Leaders were elected properly and are within their terms." },
    { id: "gen_records", label: "Record keeping", detail: "Minutes books, correspondence and documents are kept and available." },
    { id: "gen_plan", label: "Business plan", detail: "The activities planned for the year are actually being carried out." },
    { id: "gen_members", label: "Member participation", detail: "Members take part, are informed, and complaints are handled." },
    { id: "gen_permit", label: "Legal status", detail: "The operating permit and the legal personality certificate are valid." },
    { id: "gen_followup", label: "Previous recommendations", detail: "What earlier audits asked for has been done." },
  ],
  financial: [
    { id: "fin_books", label: "Books of account", detail: "Cash book and ledgers are kept and up to date." },
    { id: "fin_cash_bank", label: "Cash and bank", detail: "Cash counted and bank balances reconciled to the books." },
    { id: "fin_shares", label: "Share capital and contributions", detail: "Each member's shares and contributions agree with the ledger." },
    { id: "fin_loans", label: "Loans to members", detail: "Loans were approved properly and are being recovered." },
    { id: "fin_spending", label: "Spending", detail: "Every expense was authorised and is backed by a receipt." },
    { id: "fin_assets", label: "Assets", detail: "The asset inventory exists and the assets are where it says." },
    { id: "fin_statements", label: "Financial statements", detail: "Annual statements were prepared and presented to the assembly." },
    { id: "fin_tax", label: "Tax obligations", detail: "RRA declarations and payments are up to date." },
    { id: "fin_support", label: "External funding", detail: "Grants and support were spent on what they were given for." },
    { id: "fin_controls", label: "Internal controls", detail: "No single person both handles and records the money." },
  ],
};

export const FINDING_RESULTS = ["satisfactory", "concern", "non_compliant", "not_checked"] as const;
export const OVERALL_RATINGS = ["satisfactory", "needs_improvement", "unsatisfactory"] as const;

// ─── The route an audit takes ─────────────────────────────────────────────────

export type StepActor = "requester" | "cooperative" | "sector" | "district" | "rca";

export interface StepDefinition {
  key: string;
  title: string;
  actor: StepActor;
  description: string;
  /** The status a request carries while it sits at this step. */
  status: string;
}

const REQUESTER_LABEL: Record<RequesterLevel, string> = {
  cooperative: "the cooperative manager",
  sector: "the sector cooperative officer",
  district: "the district cooperative officer",
  rca: "the RCA officer",
};

/**
 * The steps, in order, for one audit. A request only passes through the tiers
 * ABOVE the person who filed it — a district officer's request goes straight to
 * the RCA — and comes back down through exactly those tiers.
 */
export function auditRoute(origin: Origin, requesterLevel: RequesterLevel): StepDefinition[] {
  const tail: StepDefinition[] = [
    {
      key: "notify_members",
      title: "Cooperative tells its members",
      actor: "cooperative",
      status: "confirmed",
      description:
        "The cooperative's manager puts the audit on the calendar and sends every member the " +
        "notice, so the records and the people the auditors need are there on the day.",
    },
    {
      key: "conduct",
      title: "Auditors visit and examine",
      actor: "rca",
      status: "in_progress",
      description: "The audit team works through the agreed checklist at the cooperative.",
    },
    {
      key: "report",
      title: "Findings and recommendations issued",
      actor: "rca",
      status: "completed",
      description:
        "Each item on the checklist is rated, with an overall rating, recommendations and a date " +
        "by which they must be acted on. Everyone in the chain receives the result.",
    },
  ];

  if (origin === "rca_initiated") {
    return [
      {
        key: "announced",
        title: "RCA announces the audit",
        actor: "rca",
        status: "announced",
        description:
          "The RCA officer for the district decides to audit this cooperative, sets the date and " +
          "what will be checked. No request is needed.",
      },
      {
        key: "acknowledge",
        title: "Cooperative acknowledges",
        actor: "cooperative",
        status: "announced",
        description: "The cooperative's manager confirms they have received the notice and will be ready.",
      },
      ...tail,
    ];
  }

  const climbsSector = requesterLevel === "cooperative";
  const climbsDistrict = requesterLevel === "cooperative" || requesterLevel === "sector";

  const steps: StepDefinition[] = [
    {
      key: "filed",
      title: "Audit requested",
      actor: "requester",
      status: "filed",
      description:
        `Filed by ${REQUESTER_LABEL[requesterLevel]}, with the reasons, the cooperative and a ` +
        "suggested date.",
    },
  ];
  if (climbsSector) {
    steps.push({
      key: "review_sector",
      title: "Sector officer reviews",
      actor: "sector",
      status: "pending_sector",
      description:
        "The officer for the cooperative's sector checks the reasons and forwards it, returns it " +
        "for more detail, or turns it down.",
    });
  }
  if (climbsDistrict) {
    steps.push({
      key: "review_district",
      title: "District officer reviews",
      actor: "district",
      status: "pending_district",
      description: "The district cooperative office reviews it and decides whether it goes to the RCA.",
    });
  }
  steps.push({
    key: "rca_decision",
    title: "RCA officer decides",
    actor: "rca",
    status: "pending_rca",
    description:
      "The RCA officer for the district approves it — fixing the date and exactly what will be " +
      "checked — rejects it, or puts it on the waiting list.",
  });
  if (climbsDistrict) {
    steps.push({
      key: "relay_district",
      title: "District passes the approval down",
      actor: "district",
      status: "relay_district",
      description: "The district office is told the audit is going ahead and passes it on.",
    });
  }
  if (climbsSector) {
    steps.push({
      key: "relay_sector",
      title: "Sector passes the approval down",
      actor: "sector",
      status: "relay_sector",
      description: "The sector officer is told the audit is going ahead and passes it on.",
    });
  }
  steps.push({
    key: "confirm",
    title: "Requester confirms",
    actor: "requester",
    status: "awaiting_confirmation",
    description:
      `${REQUESTER_LABEL[requesterLevel][0].toUpperCase()}${REQUESTER_LABEL[requesterLevel].slice(1)} ` +
      "accepts the RCA's date and checklist, or asks for another date.",
  });
  return [...steps, ...tail];
}

/** The step a request moves to after `stepKey` is completed. */
export function nextStep(route: StepDefinition[], stepKey: string): StepDefinition | null {
  const i = route.findIndex((s) => s.key === stepKey);
  return i >= 0 && i < route.length - 1 ? route[i + 1] : null;
}

// ─── Statuses ─────────────────────────────────────────────────────────────────

export const TERMINAL_STATUSES = ["completed", "rejected", "withdrawn", "cancelled"];

export const STATUS_LABEL: Record<string, string> = {
  pending_sector: "With the sector officer",
  pending_district: "With the district officer",
  pending_rca: "With the RCA officer",
  returned: "Returned for more information",
  waitlisted: "On the RCA waiting list",
  relay_district: "Approved — passing down via the district",
  relay_sector: "Approved — passing down via the sector",
  awaiting_confirmation: "Approved — awaiting your confirmation",
  reschedule_requested: "Another date requested",
  announced: "Announced by the RCA",
  confirmed: "Confirmed — audit scheduled",
  in_progress: "Audit under way",
  completed: "Completed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

// ─── The process, as a person sees it ─────────────────────────────────────────

export type StageState = "done" | "current" | "pending" | "failed" | "skipped" | "blocked";

export interface AuditStage {
  key: string;
  order: number;
  title: string;
  description: string;
  actor: StepActor;
  state: StageState;
  completedAt?: string | null;
  completedBy?: string | null;
  detail?: string;
}

export interface AuditActionRow {
  step: string;
  action: string;
  note?: string | null;
  actedAt?: string;
  actorName?: string | null;
}

export interface AuditFacts {
  origin: Origin;
  requesterLevel: RequesterLevel;
  status: string;
  currentStep: string;
  createdAt: string | null;
  stepDueAt: string | null;
  scheduledStart: string | null;
  activityId: string | null;
  actions: AuditActionRow[];
}

/** Which actions complete a step on the way through (as opposed to bouncing it). */
const COMPLETING_ACTIONS = new Set([
  "filed", "forward", "approve", "relay", "confirm", "acknowledge", "announce", "convene", "start", "complete",
]);

export function buildAuditProcess(facts: AuditFacts) {
  const route = auditRoute(facts.origin, facts.requesterLevel);
  const currentIndex = route.findIndex((s) => s.key === facts.currentStep);
  const terminal = TERMINAL_STATUSES.includes(facts.status);
  const failedHere = facts.status === "rejected" || facts.status === "cancelled";

  const completion = (key: string) =>
    [...facts.actions].reverse().find((a) => a.step === key && COMPLETING_ACTIONS.has(a.action));

  const stages: AuditStage[] = route.map((def, index) => {
    const stage: AuditStage = {
      key: def.key,
      order: index + 1,
      title: def.title,
      description: def.description,
      actor: def.actor,
      state: "pending",
    };
    const done = completion(def.key);

    if (def.key === "filed" || def.key === "announced") {
      stage.state = "done";
      stage.completedAt = done?.actedAt ?? facts.createdAt;
      stage.completedBy = done?.actorName ?? null;
      return stage;
    }

    if (facts.status === "completed") {
      // The members' notice is optional; an audit can be held without it.
      stage.state = def.key === "notify_members" && !facts.activityId ? "skipped" : "done";
    } else if (index < currentIndex) {
      stage.state = def.key === "notify_members" && !facts.activityId ? "skipped" : "done";
    } else if (index === currentIndex) {
      if (failedHere) stage.state = "failed";
      else if (facts.status === "withdrawn") stage.state = "skipped";
      else stage.state = "current";
    } else if (terminal) {
      stage.state = "skipped";
    }

    if (done && stage.state === "done") {
      stage.completedAt = done.actedAt ?? null;
      stage.completedBy = done.actorName ?? null;
    }

    if (stage.state === "current") {
      if (facts.status === "returned") {
        stage.detail = "Returned to the requester for more information. It stays here until they resubmit.";
      } else if (facts.status === "waitlisted") {
        stage.detail = "On the RCA waiting list. The RCA officer will approve or reject it later.";
      } else if (facts.status === "reschedule_requested") {
        stage.detail = "The requester asked for a different date. The RCA officer sets a new one.";
      } else if (def.key === "notify_members" && facts.activityId) {
        stage.state = "done";
        stage.detail = "Members have been told and the audit is on the cooperative's calendar.";
      } else if (def.key === "notify_members" && facts.scheduledStart) {
        stage.detail = `The audit is set for ${new Date(facts.scheduledStart).toLocaleString("en-RW")}.`;
      }
    }
    if (stage.state === "failed") {
      const last = [...facts.actions].reverse().find((a) => a.action === "reject" || a.action === "cancel");
      stage.detail = last?.note ? `${facts.status === "cancelled" ? "Cancelled" : "Rejected"}: ${last.note}` : undefined;
      stage.completedAt = last?.actedAt ?? null;
      stage.completedBy = last?.actorName ?? null;
    }
    return stage;
  });

  // Once members have been notified, the conduct step is what the audit waits on.
  const notify = stages.find((s) => s.key === "notify_members");
  const conduct = stages.find((s) => s.key === "conduct");
  if (notify?.state === "done" && conduct?.state === "pending" && facts.status === "confirmed") {
    conduct.state = "current";
    conduct.detail = facts.scheduledStart
      ? `Scheduled for ${new Date(facts.scheduledStart).toLocaleString("en-RW")}.`
      : undefined;
  }

  const finished = stages.filter((s) => ["done", "skipped", "failed"].includes(s.state)).length;
  const current = [...stages].reverse().find((s) => s.state === "current") ?? null;

  return {
    stages,
    currentStageKey: current?.key ?? null,
    currentActor: current?.actor ?? null,
    percentComplete: Math.round((finished / stages.length) * 100),
    overdue:
      !terminal && facts.stepDueAt != null && new Date(facts.stepDueAt).getTime() < Date.now(),
  };
}

// ─── The general audit programme ──────────────────────────────────────────────

export const ROUND_TYPES = ["sector_general", "district_general", "sensitization"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

/**
 * The routine. A sector committee visits every month; the district committee
 * every trimester; and every trimester the district calls all cooperative
 * leaders together for sensitization.
 */
export const ROUND_CADENCE: Record<
  RoundType,
  { label: string; level: "sector" | "district"; every: "month" | "trimester"; description: string }
> = {
  sector_general: {
    label: "Sector general audit",
    level: "sector",
    every: "month",
    description:
      "The sector committee visits the cooperatives of its sector, checks how they are run and " +
      "notes what needs attention.",
  },
  district_general: {
    label: "District general audit",
    level: "district",
    every: "trimester",
    description:
      "The district committee — leaders at the administrative level of cooperatives — visits " +
      "cooperatives across the district.",
  },
  sensitization: {
    label: "Sensitization session",
    level: "district",
    every: "trimester",
    description:
      "All cooperative leaders are gathered and reminded of their obligations, retrained on what " +
      "they should be doing, and told plainly where they are falling short.",
  },
};

/** The period a date falls in for a cadence: "2026-11" or "2026-T4". */
export function periodOf(date: Date, every: "month" | "trimester") {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based
  if (every === "month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return {
      label: `${y}-${String(m + 1).padStart(2, "0")}`,
      name: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      start,
      end,
    };
  }
  // Calendar trimesters: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
  const t = Math.floor(m / 3);
  const start = new Date(y, t * 3, 1);
  const end = new Date(y, t * 3 + 3, 0);
  return { label: `${y}-T${t + 1}`, name: `Trimester ${t + 1}, ${y}`, start, end };
}

/** The period immediately before the one containing `date`. */
export function previousPeriodOf(date: Date, every: "month" | "trimester") {
  const current = periodOf(date, every);
  const dayBefore = new Date(current.start.getTime() - 86_400_000);
  return periodOf(dayBefore, every);
}

/** YYYY-MM-DD for a local date, without the UTC shift toISOString() applies. */
export function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
