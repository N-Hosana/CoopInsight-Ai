/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LEAVING A COOPERATIVE — THE SEVEN STEPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member asking to be released is not a form submission that an officer
 * approves. It is a procedure with seven steps, each of which must visibly
 * happen before the next one may:
 *
 *   1. FILED        the member states their grounds and their payment instruction
 *   2. ASSEMBLY CALLED   the manager convenes a general assembly and broadcasts
 *                        the notice to every member
 *   3. ASSEMBLY HELD     attendance, quorum and the vote are recorded
 *   4. MINUTED           what the assembly decided, and why, is written down
 *   5. SETTLED           the member's savings, shares and loans are resolved and
 *                        the payment is recorded
 *   6. RELEASED          the decision is entered and takes effect
 *   7. CERTIFICATE       the cooperative issues proof of past membership, and
 *                        the member is archived
 *
 * This module is the single place those steps are defined. The route enforces
 * them; the portal renders them; both read the same list, so what a member is
 * shown is exactly what the server will insist on. A step that the data says
 * has not happened is never reported as done.
 */

export type StepState = "done" | "current" | "blocked" | "pending" | "skipped";

export interface ProcessStep {
  key: string;
  order: number;
  title: string;
  /** What actually has to happen, in words a member can act on. */
  description: string;
  /** Who moves this step forward. */
  actor: "member" | "manager" | "assembly" | "system";
  state: StepState;
  /** Filled once the step has happened. */
  completedAt?: string | null;
  /** Why the step cannot proceed yet, when it is blocked. */
  blockedReason?: string;
  detail?: string;
}

export const EXIT_STEP_DEFINITIONS = [
  {
    key: "filed",
    title: "Request filed",
    actor: "member" as const,
    description:
      "The member states why they want to leave and how they want their savings and shares " +
      "returned. The cooperative has a published number of days to respond.",
  },
  {
    key: "assembly_called",
    title: "General assembly convened",
    actor: "manager" as const,
    description:
      "The manager calls an extraordinary general assembly to decide the request and broadcasts " +
      "the notice — date, place and agenda — to every member of the cooperative.",
  },
  {
    key: "assembly_held",
    title: "Assembly sat and voted",
    actor: "assembly" as const,
    description:
      "Attendance is counted against the quorum, the members debate the grounds, and the vote is " +
      "taken. Without quorum the assembly may only defer.",
  },
  {
    key: "minuted",
    title: "Resolution minuted",
    actor: "manager" as const,
    description:
      "What the assembly resolved, the figures it resolved on and its reasoning are written into " +
      "the minutes. The member is entitled to read them.",
  },
  {
    key: "settled",
    title: "Member's assets resolved",
    actor: "manager" as const,
    description:
      "Savings, share capital and special levies are refunded, the member's share of the " +
      "cooperative's accumulated value is added, outstanding loans are deducted, and the payment " +
      "is recorded against the request.",
  },
  {
    key: "released",
    title: "Release recorded",
    actor: "manager" as const,
    description:
      "The decision the assembly reached is entered. Approving it releases the member from " +
      "membership; the office cannot enter an outcome the assembly did not reach.",
  },
  {
    key: "certificate",
    title: "Certificate issued and record archived",
    actor: "system" as const,
    description:
      "The cooperative issues a certificate of past membership the member can download from their " +
      "portal, and the member's register entry is archived rather than deleted.",
  },
] as const;

export type ExitStepKey = (typeof EXIT_STEP_DEFINITIONS)[number]["key"];

interface MeetingRow {
  [key: string]: unknown;
  status: string;
  resolution: string | null;
  resolution_note?: string | null;
  resolutionNote?: string | null;
  held_at?: string | null;
  heldAt?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  quorum_met?: boolean | null;
  quorumMet?: boolean | null;
  minutes_url?: string | null;
  minutesUrl?: string | null;
}

interface ProcessFacts {
  status: string;
  createdAt: string | null;
  decidedAt: string | null;
  meetings: MeetingRow[];
  settlement: { settled_on?: string | null; created_at?: string | null; net_payable?: unknown } | null;
  certificate: { issued_at?: string | null; certificate_number?: string | null } | null;
  memberArchivedAt: string | null;
}

/** Reads either snake_case (a DB row) or camelCase (a JSON-aggregated meeting). */
const pick = <T>(row: Record<string, unknown>, ...keys: string[]): T | null => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return null;
};

/**
 * Turns the stored state of one exit request into the seven steps, with each
 * one's real state. Nothing here guesses: a step is `done` only when the row
 * that proves it exists.
 */
export function buildExitProcess(facts: ProcessFacts): {
  steps: ProcessStep[];
  currentStepKey: string | null;
  percentComplete: number;
  nextAction: string | null;
} {
  const heldMeetings = facts.meetings.filter((m) => m.status === "held");
  const scheduled = facts.meetings.find((m) => m.status === "scheduled");
  const resolved = heldMeetings.find(
    (m) => m.resolution === "approve_exit" || m.resolution === "reject_exit"
  );
  const terminal = ["approved", "rejected", "withdrawn"].includes(facts.status);
  const approved = facts.status === "approved";

  const done: Record<string, string | null> = {};
  done.filed = facts.createdAt;
  if (scheduled || heldMeetings.length) {
    done.assembly_called =
      pick<string>((scheduled ?? heldMeetings[0]) as Record<string, unknown>, "created_at", "createdAt");
  }
  if (heldMeetings.length) {
    done.assembly_held = pick<string>(
      heldMeetings[heldMeetings.length - 1] as Record<string, unknown>,
      "held_at",
      "heldAt"
    );
  }
  if (resolved) {
    const note = pick<string>(resolved as Record<string, unknown>, "resolution_note", "resolutionNote");
    if (note) done.minuted = pick<string>(resolved as Record<string, unknown>, "held_at", "heldAt");
  }
  if (facts.settlement) {
    done.settled = facts.settlement.settled_on ?? facts.settlement.created_at ?? null;
  }
  if (terminal) done.released = facts.decidedAt;
  if (facts.certificate) done.certificate = facts.certificate.issued_at ?? null;

  const steps: ProcessStep[] = EXIT_STEP_DEFINITIONS.map((definition, index) => {
    const completedAt = done[definition.key] ?? null;
    const isDone = definition.key in done;
    return {
      key: definition.key,
      order: index + 1,
      title: definition.title,
      description: definition.description,
      actor: definition.actor,
      state: isDone ? "done" : "pending",
      completedAt,
    };
  });

  const byKey = (key: string) => steps.find((s) => s.key === key)!;

  // ── Refinements the raw "has it happened" test cannot express ─────────────
  if (facts.status === "withdrawn") {
    for (const step of steps) {
      if (step.state !== "done") step.state = "skipped";
    }
    byKey("released").state = "done";
    byKey("released").detail = "The member withdrew the request before it was decided.";
    byKey("certificate").state = "skipped";
    byKey("certificate").detail = "No certificate is issued for a withdrawn request.";
  } else if (facts.status === "rejected") {
    byKey("settled").state = "skipped";
    byKey("settled").detail =
      "The assembly refused the release, so nothing is settled — the member stays on the register.";
    byKey("certificate").state = "skipped";
    byKey("certificate").detail =
      "The member remains in the cooperative, so no certificate of past membership is due.";
  } else {
    // A settlement that produced nothing payable is still a settlement, but a
    // release with no settlement recorded is blocked, not merely pending.
    if (byKey("minuted").state === "done" && !facts.settlement) {
      byKey("settled").state = "current";
    }
    if (!facts.settlement && !approved) {
      byKey("released").state = byKey("released").state === "done" ? "done" : "blocked";
      byKey("released").blockedReason =
        "The member's savings, shares and loans have to be resolved and the payment recorded " +
        "before the release can be entered.";
    }
    if (approved && !facts.certificate) {
      byKey("certificate").state = "current";
    }
  }

  // The first step that is not settled becomes `current`, unless something
  // further down already claimed it.
  if (!terminal) {
    const firstOpen = steps.find((s) => s.state === "pending" || s.state === "blocked");
    if (firstOpen && firstOpen.state === "pending") firstOpen.state = "current";
  }

  const doneCount = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const current = steps.find((s) => s.state === "current" || s.state === "blocked") ?? null;

  const nextActions: Record<string, string> = {
    filed: "File the request from the Membership page.",
    assembly_called:
      "Call the general assembly. Every member is notified and a broadcast message goes out.",
    assembly_held: scheduled
      ? "The assembly is on the calendar. Record its attendance and vote once it has sat."
      : "Call the assembly before recording a vote.",
    minuted: "Minute what the assembly resolved and why.",
    settled: "Record the settlement of the member's savings, shares and outstanding loans.",
    released: "Enter the decision the assembly reached.",
    certificate: "Issue the certificate of past membership and archive the register entry.",
  };

  return {
    steps,
    currentStepKey: current?.key ?? null,
    percentComplete: Math.round((doneCount / steps.length) * 100),
    nextAction: current ? nextActions[current.key] ?? null : null,
  };
}

/**
 * The wording printed on a certificate of past membership. Written as one
 * paragraph a bank or another cooperative can read without knowing this system.
 */
export function certificateStatement(input: {
  memberName: string;
  cooperativeName: string;
  registrationNumber: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  monthsOfMembership: number | null;
  rolesHeld: string | null;
  assemblyHeldOn: string | null;
}): string {
  const fmt = (v: string | null) =>
    v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

  const from = fmt(input.joinedOn);
  const to = fmt(input.leftOn);
  const duration =
    input.monthsOfMembership != null
      ? input.monthsOfMembership >= 24
        ? `${Math.floor(input.monthsOfMembership / 12)} years`
        : `${input.monthsOfMembership} months`
      : null;

  const parts = [
    `This is to certify that ${input.memberName} was a registered member of ` +
      `${input.cooperativeName}` +
      (input.registrationNumber ? ` (registration number ${input.registrationNumber})` : "") +
      ".",
  ];

  if (from && to) {
    parts.push(
      `Their membership ran from ${from} to ${to}${duration ? `, a period of ${duration}` : ""}.`
    );
  } else if (from) {
    parts.push(`Their membership began on ${from}.`);
  }

  if (input.rolesHeld) {
    parts.push(`During that time they held the following office: ${input.rolesHeld}.`);
  }

  parts.push(
    "They left at their own request, which was decided by a general assembly of the members" +
      (fmt(input.assemblyHeldOn) ? ` held on ${fmt(input.assemblyHeldOn)}` : "") +
      ", and their savings, share capital and outstanding obligations were settled in full."
  );

  parts.push(
    "This certificate is issued on the cooperative's records as held in CoopInsight and may be " +
      "verified against the code printed below."
  );

  return parts.join(" ");
}
