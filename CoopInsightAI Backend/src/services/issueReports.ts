/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTING A PROBLEM — THE ONE THING AN ORDINARY MEMBER CAN ESCALATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member does not file a dissolution, a change of name or a change of
 * objective. Those commit the whole cooperative, so the law puts them in the
 * president's hands and the system refuses them from anyone else.
 *
 * But that left the member with exactly two things they could do — join, and
 * ask to leave — and nothing in between. The person who first notices that the
 * savings do not add up, that no election has been held in three years, or that
 * the committee has quietly stopped meeting, is almost always an ordinary
 * member. Before this they could only raise it with the office they might be
 * complaining about.
 *
 * So a member may do two things on their own account:
 *
 *   • apply to FORM a new cooperative — they are not yet anybody's member, so
 *     no office could file it for them;
 *   • REPORT AN ISSUE about the cooperative they belong to.
 *
 * Both travel the same sector → district → RCA chain as everything else. That
 * is deliberate: an escalation path that bypasses the officers who supervise
 * the cooperative would be useless, and a second parallel workflow would drift
 * out of step with the first.
 */

export const ISSUE_CATEGORIES = [
  {
    id: "financial_irregularity",
    label: "Money that does not add up",
    description:
      "Savings, contributions or loan records that do not match what members were told, or funds " +
      "that cannot be accounted for.",
    defaultSeverity: "high",
  },
  {
    id: "governance_failure",
    label: "The committee is not governing",
    description:
      "No general assembly held when one was due, elections overdue, or the management committee " +
      "no longer meeting.",
    defaultSeverity: "high",
  },
  {
    id: "exclusion_from_decisions",
    label: "Members shut out of decisions",
    description:
      "Decisions taken without an assembly, members not invited, or a vote held without quorum.",
    defaultSeverity: "medium",
  },
  {
    id: "unpaid_entitlement",
    label: "Money owed to me has not been paid",
    description:
      "Savings, dividends or a settlement on leaving that the cooperative has not paid.",
    defaultSeverity: "high",
  },
  {
    id: "register_error",
    label: "My record is wrong",
    description:
      "The member register has the wrong details, or shows contributions that are not mine.",
    defaultSeverity: "low",
  },
  {
    id: "cooperative_inactive",
    label: "The cooperative has stopped operating",
    description:
      "No activities, no trading and no meetings, but the cooperative is still on the register.",
    defaultSeverity: "medium",
  },
  {
    id: "misconduct",
    label: "Misconduct by an office-bearer",
    description:
      "Abuse of position, intimidation, or a conflict of interest by someone holding office.",
    defaultSeverity: "urgent",
  },
  {
    id: "other",
    label: "Something else",
    description: "Anything not covered above.",
    defaultSeverity: "medium",
  },
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]["id"];

export const ISSUE_SEVERITIES = ["low", "medium", "high", "urgent"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** The minimum a report has to say to be actionable rather than a complaint. */
export const MIN_ISSUE_DETAIL_LENGTH = 30;

/**
 * How long each level has to respond, by severity.
 *
 * An urgent report — money missing, intimidation — cannot sit in the same
 * three-week queue as a wrong middle name on the register. The window is
 * stamped onto the row at filing so it cannot quietly move later.
 */
export const ISSUE_RESPONSE_DAYS: Record<IssueSeverity, number> = {
  urgent: 3,
  high: 7,
  medium: 14,
  low: 21,
};

export function issueCategory(id: string) {
  return ISSUE_CATEGORIES.find((c) => c.id === id) ?? null;
}

/**
 * Which severity applies. A reporter may raise it above the category default —
 * they know their own situation — but not lower it, because a category that the
 * RCA has decided is serious should not become routine because the person
 * filing it was being modest.
 */
export function resolveSeverity(categoryId: string, requested?: string | null): IssueSeverity {
  const category = issueCategory(categoryId);
  const fallback = (category?.defaultSeverity ?? "medium") as IssueSeverity;
  if (!requested || !(ISSUE_SEVERITIES as readonly string[]).includes(requested)) return fallback;

  const rank = (s: IssueSeverity) => ISSUE_SEVERITIES.indexOf(s);
  const asked = requested as IssueSeverity;
  return rank(asked) > rank(fallback) ? asked : fallback;
}
