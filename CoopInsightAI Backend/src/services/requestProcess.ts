/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMING AND DISSOLVING A COOPERATIVE — EVERY STAGE, NAMED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A formation request and a dissolution request both travel the same oversight
 * chain — sector, then district, then RCA — but a dissolution carries four
 * extra stages the chain knows nothing about: two general assemblies, a
 * liquidation, and an RCA audit of the grounds.
 *
 * Before this module those stages existed in the database and in the route's
 * validation, but nowhere a person could see them. A president who filed a
 * dissolution was told "pending_sector" and left to work out that the
 * liquidator's report was the thing actually holding it up.
 *
 * This is the published procedure. The route enforces it; the portal renders
 * it; both read the same list.
 */

export type StageState = "done" | "current" | "blocked" | "pending" | "failed" | "skipped";

export interface RequestStage {
  key: string;
  order: number;
  title: string;
  description: string;
  /** Who moves it: the cooperative itself, or which tier of the oversight chain. */
  actor: "cooperative" | "liquidator" | "sector" | "district" | "rca" | "system";
  state: StageState;
  completedAt?: string | null;
  detail?: string;
  blockedReason?: string;
}

/**
 * THE DISSOLUTION PROCEDURE
 *
 * Law No. 057/2024, Articles 132–142. Two assemblies, not one: the first
 * resolves to dissolve and appoints the liquidator and the committee that
 * watches them; the second receives the liquidator's report once creditors have
 * been paid and what remains has been distributed. Only then may the RCA audit
 * the grounds and strike the cooperative off.
 */
export const DISSOLUTION_STAGES = [
  {
    key: "committee_meeting",
    title: "Committee calls the general assembly",
    actor: "cooperative" as const,
    description:
      "The management committee convenes a general assembly to put dissolution to the members. " +
      "Three-quarters of those entitled to sit must attend, and three-quarters of them must vote " +
      "in favour — dissolution is a reserved matter, not ordinary business.",
  },
  {
    key: "first_assembly",
    title: "First assembly resolves and appoints",
    actor: "cooperative" as const,
    description:
      "The assembly resolves to dissolve, appoints a liquidator qualified to collect and " +
      "distribute the assets, and appoints a committee of members to monitor them. The RCA must " +
      "be told within 7 days of the decision.",
  },
  {
    key: "filed",
    title: "Request filed with the documents",
    actor: "cooperative" as const,
    description:
      "The president files the request through the app with the minutes, the member and " +
      "committee lists, the asset inventory and the disposal plan. The sector, district and RCA " +
      "officers all see it from this moment.",
  },
  {
    key: "sector",
    title: "Sector cooperative officer reviews",
    actor: "sector" as const,
    description:
      "The officer for the sector the cooperative sits in checks the paperwork and the grounds, " +
      "and either forwards it to the district, returns it for more information, or rejects it.",
  },
  {
    key: "district",
    title: "District cooperative officer reviews",
    actor: "district" as const,
    description:
      "The district office reviews what the sector forwarded and decides whether the case goes " +
      "to the RCA.",
  },
  {
    key: "liquidation",
    title: "Liquidator collects, pays and distributes",
    actor: "liquidator" as const,
    description:
      "The appointed person recovers outstanding loans, pays the creditors, and distributes what " +
      "is left to the members. The second general assembly receives their report and the original " +
      "legal personality certificate goes back to the RCA.",
  },
  {
    key: "audit",
    title: "RCA audits the grounds",
    actor: "rca" as const,
    description:
      "The RCA verifies that the members really resolved on it, that the money is accounted for, " +
      "and that a cooperative which is still trading is not simply being abandoned. Nothing can " +
      "be struck off before this concludes.",
  },
  {
    key: "struck_off",
    title: "RCA strikes the cooperative off",
    actor: "rca" as const,
    description:
      "The final decision. The cooperative leaves the active register, its operating permit is " +
      "revoked, and any field visit still queued against it is cancelled.",
  },
] as const;

/** A formation is the same chain without the liquidation and the audit. */
export const FORMATION_STAGES = [
  {
    key: "filed",
    title: "Application filed",
    actor: "cooperative" as const,
    description:
      "The founding members apply, naming the proposed cooperative, its purpose, its membership " +
      "and its share capital, and attach the documents the RCA checklist requires.",
  },
  {
    key: "sector",
    title: "Sector cooperative officer reviews",
    actor: "sector" as const,
    description:
      "The officer for the sector checks the application against the formation criteria and " +
      "either forwards it, returns it for more information, or rejects it.",
  },
  {
    key: "district",
    title: "District cooperative officer reviews",
    actor: "district" as const,
    description: "The district office reviews what the sector forwarded and decides whether it goes to the RCA.",
  },
  {
    key: "rca",
    title: "RCA registers the cooperative",
    actor: "rca" as const,
    description:
      "Final approval puts the cooperative on the register and issues its first operating permit, " +
      "valid for one year. An RCA maturity audit then decides whether it becomes permanent.",
  },
] as const;

/**
 * An issue reported by a member climbs the same chain, but what happens at the
 * end is different: nothing is registered and nothing is struck off — the RCA
 * rules on it and says what is to be done.
 */
export const ISSUE_STAGES = [
  {
    key: "filed",
    title: "Issue reported",
    actor: "cooperative" as const,
    description:
      "A member reports what they have seen, with enough detail for somebody to act on it. The " +
      "response window depends on how serious the category is.",
  },
  {
    key: "sector",
    title: "Sector cooperative officer reviews",
    actor: "sector" as const,
    description:
      "The officer for the sector looks into it first — they are closest to the cooperative and " +
      "can often settle it without escalating. They forward it, return it for more detail, or " +
      "close it with a reason.",
  },
  {
    key: "district",
    title: "District cooperative officer reviews",
    actor: "district" as const,
    description:
      "Anything the sector cannot settle, or should not settle alone, goes to the district office.",
  },
  {
    key: "rca",
    title: "RCA rules on it",
    actor: "rca" as const,
    description:
      "The RCA decides what is to be done — an audit, a field visit, a direction to the " +
      "cooperative, or a finding that the complaint does not hold.",
  },
] as const;

interface RequestFacts {
  requestType: string;
  status: string;
  currentStage: string;
  createdAt: string | null;
  dissolutionStage: string | null;
  assemblyHeldOn: string | null;
  secondAssemblyHeldOn: string | null;
  assetsDistributed: boolean;
  certificateReturned: boolean;
  liquidatorName: string | null;
  reviews: Array<{ stage: string; decision: string; reviewedAt?: string; reviewed_at?: string }>;
  audits: Array<{ status: string; recommendation?: string | null; concludedAt?: string | null; concluded_at?: string | null }>;
}

export function buildRequestProcess(facts: RequestFacts): {
  stages: RequestStage[];
  currentStageKey: string | null;
  percentComplete: number;
  nextAction: string | null;
  blockedBy: string | null;
} {
  const isDissolution = facts.requestType === "dissolution";
  const isIssue = facts.requestType === "issue_report";
  const definitions = isDissolution
    ? DISSOLUTION_STAGES
    : isIssue
      ? ISSUE_STAGES
      : FORMATION_STAGES;

  const approvedAt = (stage: string) =>
    facts.reviews.find((r) => r.stage === stage && r.decision === "approved")?.reviewedAt ??
    facts.reviews.find((r) => r.stage === stage && r.decision === "approved")?.reviewed_at ??
    null;
  const rejectedAt = (stage: string) =>
    facts.reviews.find((r) => r.stage === stage && r.decision === "rejected")?.reviewedAt ??
    facts.reviews.find((r) => r.stage === stage && r.decision === "rejected")?.reviewed_at ??
    null;
  const returnedAt = (stage: string) =>
    facts.reviews.find((r) => r.stage === stage && r.decision === "returned")?.reviewedAt ??
    facts.reviews.find((r) => r.stage === stage && r.decision === "returned")?.reviewed_at ??
    null;

  const concludedAudit = facts.audits.find((a) => a.status === "passed" || a.status === "failed");
  const openAudit = facts.audits.find((a) => a.status === "scheduled" || a.status === "in_progress");

  const terminal = ["approved", "rejected", "withdrawn"].includes(facts.status);

  const stages: RequestStage[] = definitions.map((definition, index) => {
    const stage: RequestStage = {
      key: definition.key,
      order: index + 1,
      title: definition.title,
      description: definition.description,
      actor: definition.actor,
      state: "pending",
    };

    switch (definition.key) {
      case "committee_meeting":
      case "first_assembly":
        // Both are proved by the filing itself: the route refuses a dissolution
        // that does not carry the assembly attendance, the vote and the
        // appointed liquidator, so a request that exists had them.
        stage.state = "done";
        stage.completedAt = facts.assemblyHeldOn ?? facts.createdAt;
        if (definition.key === "first_assembly" && facts.liquidatorName) {
          stage.detail = `${facts.liquidatorName} was appointed liquidator.`;
        }
        break;

      case "filed":
        stage.state = "done";
        stage.completedAt = facts.createdAt;
        break;

      case "sector":
      case "district": {
        const rejected = rejectedAt(definition.key);
        const approved = approvedAt(definition.key);
        const returned = returnedAt(definition.key);
        if (rejected) {
          stage.state = "failed";
          stage.completedAt = rejected;
          stage.detail = "Rejected at this level.";
        } else if (approved) {
          stage.state = "done";
          stage.completedAt = approved;
        } else if (facts.currentStage === definition.key && !terminal) {
          stage.state = "current";
          if (returned) {
            stage.detail =
              "Returned to the applicant for more information. It stays at this level until they resubmit.";
          }
        }
        break;
      }

      case "liquidation": {
        const complete = facts.dissolutionStage === "complete";
        if (complete) {
          stage.state = "done";
          stage.completedAt = facts.secondAssemblyHeldOn;
        } else if (terminal) {
          stage.state = facts.status === "approved" ? "done" : "skipped";
        } else {
          const outstanding: string[] = [];
          if (!facts.assetsDistributed) outstanding.push("assets not yet distributed");
          if (!facts.certificateReturned) outstanding.push("original certificate not yet returned");
          if (!facts.secondAssemblyHeldOn) outstanding.push("second assembly not yet held");

          // The liquidator starts work as soon as the first assembly appoints
          // them — they do not wait for the sector officer — so this genuinely
          // runs alongside the review chain. But a stepper showing two "current"
          // steps reads as a bug, and only one of them is what the case is
          // actually waiting on. So this counts as CURRENT only once the request
          // has reached the RCA, which is the point at which an unfinished
          // liquidation is the thing blocking the strike-off. Before then it is
          // pending, with the outstanding items named so the cooperative knows
          // what to be getting on with in the meantime.
          stage.state = facts.currentStage === "rca" ? "current" : "pending";
          stage.detail =
            (outstanding.length ? `Outstanding: ${outstanding.join("; ")}.` : "In progress.") +
            (facts.currentStage === "rca"
              ? ""
              : " The liquidator can begin as soon as the assembly appoints them; this does not" +
                " wait for the review chain.");
        }
        break;
      }

      case "audit":
        if (concludedAudit) {
          stage.state = concludedAudit.recommendation === "refuse_dissolution" ? "failed" : "done";
          stage.completedAt = concludedAudit.concludedAt ?? concludedAudit.concluded_at ?? null;
          stage.detail =
            concludedAudit.recommendation === "refuse_dissolution"
              ? "The audit found the grounds do not hold."
              : "The audit found the grounds hold.";
        } else if (openAudit) {
          stage.state = "current";
          stage.detail = "An RCA audit is open on this request.";
        } else if (facts.currentStage === "rca" && !terminal && isDissolution) {
          stage.state = "blocked";
          stage.blockedReason =
            "The RCA has not opened its audit yet. The request cannot be decided until it has.";
        }
        break;

      case "rca":
      case "struck_off": {
        const rejected = rejectedAt("rca");
        if (facts.status === "approved") {
          stage.state = "done";
          stage.completedAt = approvedAt("rca");
          stage.detail = isDissolution
            ? "The cooperative has been struck off and its permit revoked."
            : isIssue
              ? "The RCA has ruled on the report and said what is to be done."
              : "The cooperative is on the register and holds its first operating permit.";
        } else if (rejected) {
          stage.state = "failed";
          stage.completedAt = rejected;
        } else if (facts.currentStage === "rca" && !terminal) {
          // A dissolution at the RCA cannot be decided until both the audit and
          // the liquidation are finished, so it is blocked rather than merely
          // waiting on an officer. An issue report has no such precondition —
          // the RCA can rule on it the moment it arrives.
          const waitingOn: string[] = [];
          if (isDissolution && !concludedAudit) waitingOn.push("the RCA audit to conclude");
          if (isDissolution && facts.dissolutionStage !== "complete") {
            waitingOn.push("the liquidation to be completed and the certificate returned");
          }
          if (waitingOn.length) {
            stage.state = "blocked";
            stage.blockedReason = `Waiting on ${waitingOn.join(" and ")}.`;
          } else {
            stage.state = "current";
          }
        }
        break;
      }
    }

    return stage;
  });

  if (facts.status === "withdrawn") {
    for (const stage of stages) {
      if (stage.state !== "done") stage.state = "skipped";
    }
  }

  const finished = stages.filter((s) => ["done", "skipped", "failed"].includes(s.state)).length;
  const current = stages.find((s) => s.state === "current" || s.state === "blocked") ?? null;

  const nextActions: Record<string, string> = {
    committee_meeting: "Convene the general assembly that will put dissolution to the members.",
    first_assembly: "Hold the assembly, appoint the liquidator and the monitoring committee.",
    filed: "File the request with the assembly minutes and the asset inventory.",
    sector: "Awaiting the sector cooperative officer's review.",
    district: "Awaiting the district cooperative officer's review.",
    liquidation:
      "The liquidator recovers loans, pays creditors and distributes what remains; then record " +
      "the second assembly and return the original certificate.",
    audit: "The RCA opens and concludes its audit of the grounds.",
    rca: "Awaiting the RCA's decision.",
    struck_off: "Awaiting the RCA's final decision.",
  };

  return {
    stages,
    currentStageKey: current?.key ?? null,
    percentComplete: Math.round((finished / stages.length) * 100),
    nextAction: current ? nextActions[current.key] ?? null : null,
    blockedBy: current?.blockedReason ?? null,
  };
}
