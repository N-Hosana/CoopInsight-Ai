import { query } from "../config/db";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A COOPERATIVE'S INSIGHTS, IN PLAIN LANGUAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The AI Insights page gave a manager five tabs of model output — anomaly
 * tables, engagement scores, benchmarks, model performance — under a headline
 * score that was a constant. None of it answered what a manager opens the page
 * to learn: how is my cooperative doing, what is wrong, and what do I do next?
 *
 * This reads the cooperative's own records and answers those three questions:
 *
 *   headline     one sentence and the latest audit score
 *   areas        five areas (trading, meetings, records, membership,
 *                participation), each rated good / watch / problem with the
 *                reason in a sentence
 *   priorities   what to fix, most serious first, each with why it matters,
 *                what to do, and the page where it is done
 *   strengths    what is going well, so the page is not only a list of faults
 *
 * It is about ONE cooperative — the manager's own. Nothing here compares named
 * cooperatives; the only outside reference is the district average, a number.
 */

export type Level = "good" | "watch" | "problem";
export type Severity = "critical" | "major" | "minor";

export interface Priority {
  code: string;
  severity: Severity;
  title: string;
  why: string;
  action: string;
  link: string;
  linkLabel: string;
}

const n = (v: unknown) => Number(v ?? 0);
const rwf = (v: unknown) => `${Math.round(n(v)).toLocaleString("en-US")} RWF`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const level = (score: number | null | undefined): Level =>
  score == null ? "watch" : score >= 70 ? "good" : score >= 50 ? "watch" : "problem";

/**
 * Each audit finding, said the way a manager would say it, with the remedy.
 * The code stays on the item so the manager and the sector officer can refer
 * to the same thing.
 */
export const REMEDIES: Record<string, Omit<Priority, "code" | "severity">> = {
  "TRD-001": { title: "No income or expenses have been recorded for months", why: "With nothing recorded the cooperative looks as though it has stopped operating, and is put on the sector officer's visit list.", action: "Record the cooperative's sales, income and expenses, including the months that were missed.", link: "/transactions/new", linkLabel: "Record transactions" },
  "TRD-002": { title: "No transactions recorded recently", why: "A gap of three months or more reads as the cooperative going quiet.", action: "Enter the income and expenses since the last recorded date.", link: "/transactions/new", linkLabel: "Record transactions" },
  "TRD-003": { title: "Income is recorded in only some months", why: "Irregular records make it impossible to tell a slow month from a missing one.", action: "Record income every month, even when it is small.", link: "/transactions/new", linkLabel: "Record transactions" },
  "TRD-004": { title: "No income recorded for the last month", why: "Either nothing was earned or it was not entered; the records cannot tell which.", action: "Enter last month's income, or record that there was none.", link: "/transactions/new", linkLabel: "Record transactions" },
  "GOV-001": { title: "No ordinary general assembly in the last 12 months", why: "The RCA requires an ordinary general assembly in March and in October. Missing both is a compliance failure.", action: "Call the general assembly, and record the ones already held as meetings marked done.", link: "/activities/new", linkLabel: "Plan an assembly" },
  "GOV-002": { title: "Only one of the two required general assemblies was held", why: "The RCA requires one in March and one in October.", action: "Record the assembly that was held, or call the one that is due.", link: "/activities/new", linkLabel: "Plan an assembly" },
  "GOV-003": { title: "No meeting of any kind in six months", why: "A cooperative that does not meet is not being governed by its members.", action: "Hold a members' meeting and record it with its attendance.", link: "/activities/new", linkLabel: "Plan a meeting" },
  "GOV-004": { title: "Most planned activities were not carried out", why: "Activities planned and not held, or held and not marked done, count against the cooperative.", action: "Mark each activity as done or cancelled, and take attendance for those held.", link: "/activities", linkLabel: "Open activities" },
  "REC-001": { title: "No balance sheet has ever been filed", why: "A balance sheet is expected every year; without one nobody can see what the cooperative owns and owes.", action: "File the balance sheet for the last financial year.", link: "/balance-sheets/new", linkLabel: "File a balance sheet" },
  "REC-002": { title: "The balance sheet is out of date", why: "The last one filed is more than a year old.", action: "File the balance sheet for the most recent financial year.", link: "/balance-sheets/new", linkLabel: "File a balance sheet" },
  "REC-003": { title: "Very few documents are on file", why: "Bylaws, the certificate and assembly minutes are what an inspection asks for first.", action: "Upload the governing documents and recent minutes.", link: "/cooperative-documents", linkLabel: "Open documents" },
  "REC-004": { title: "The Board of Directors is not fully recorded", why: "The board has five seats: President, Vice President, Secretary and two advisors.", action: "Record the name and phone of each board member.", link: "/cooperative-profile", linkLabel: "Update the board" },
  "PRM-001": { title: "No operating permit is on record", why: "A cooperative without a permit in force is trading without a licence.", action: "Apply for the operating permit.", link: "/permits", linkLabel: "Open permits" },
  "PRM-002": { title: "The operating permit has expired", why: "The cooperative is trading without a licence until it is renewed.", action: "Renew the permit now.", link: "/permits", linkLabel: "Open permits" },
  "PRM-003": { title: "The operating permit expires soon", why: "It runs out in less than 60 days.", action: "Start the renewal before it lapses.", link: "/permits", linkLabel: "Open permits" },
  "MEM-001": { title: "The member register is empty", why: "A cooperative needs its members on the register for anything else to be recorded.", action: "Add the members.", link: "/members/new", linkLabel: "Add a member" },
  "MEM-002": { title: "Many members are suspended or inactive", why: "A large inactive share means the register does not reflect who is really taking part.", action: "Review each inactive member: reinstate them or process their exit.", link: "/members", linkLabel: "Open members" },
  "MEM-003": { title: "More members left than joined this year", why: "Members leaving is the earliest sign of a cooperative in difficulty.", action: "Speak to those who left or are leaving and find out why.", link: "/members", linkLabel: "Open members" },
  "MEM-004": { title: "Members have open requests to leave", why: "Each request must go to a general assembly and be settled.", action: "Deal with the open requests.", link: "/rca-services", linkLabel: "Open requests" },
  "ENG-001": { title: "No member has paid a contribution in three months", why: "Contributions are the clearest sign that members still back the cooperative.", action: "Record the contributions collected, or follow up on why none came in.", link: "/contributions/new", linkLabel: "Record contributions" },
  "ENG-002": { title: "Few members are paying contributions", why: "Fewer than three in ten members paid anything in the last three months.", action: "Record all contributions collected and follow up with those not paying.", link: "/contributions/new", linkLabel: "Record contributions" },
  "ENG-003": { title: "Activities were held but no attendance was recorded", why: "Without attendance there is no evidence that members took part.", action: "Open each activity that was held and mark who attended.", link: "/activities", linkLabel: "Open activities" },
  "ENG-004": { title: "Few members attend activities", why: "Fewer than three in ten members attended anything in the last three months.", action: "Check attendance is being marked, and ask members what would bring them.", link: "/activities", linkLabel: "Open activities" },
  "ENG-005": { title: "No activity has been offered to members in three months", why: "Members cannot take part in a cooperative that organises nothing.", action: "Plan a meeting or a training and register the members for it.", link: "/activities/new", linkLabel: "Plan an activity" },
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

const AREAS: Array<{ key: string; label: string; component?: string; about: string }> = [
  { key: "trading", label: "Trading", component: "trading", about: "Is money coming in and going out, and is it being recorded?" },
  { key: "meetings", label: "Meetings and assemblies", component: "meeting", about: "Is the cooperative meeting and holding its general assemblies?" },
  { key: "records", label: "Records and permit", component: "recordKeeping", about: "Are the books, documents, board and permit in order?" },
  { key: "membership", label: "Membership", component: "membership", about: "Is the register stable, or are members leaving?" },
  { key: "participation", label: "Member participation", about: "Are members paying in and turning up?" },
];

export async function cooperativeBrief(cooperativeId: string) {
  const coopRes = await query(`SELECT id, name, sector, district FROM cooperatives WHERE id = $1`, [cooperativeId]);
  const coop = coopRes.rows[0];
  if (!coop) return null;

  const [auditRes, districtRes, money, people, loans, live, alerts] = await Promise.all([
    query(
      `SELECT TO_CHAR(period, 'YYYY-MM') AS period, functionality_score, engagement_score, composite_score,
              band, signals
         FROM cooperative_monthly_audits WHERE cooperative_id = $1 ORDER BY period DESC LIMIT 2`,
      [cooperativeId]
    ),
    // The district average: a number to stand against, no cooperative named.
    query(
      `SELECT AVG(composite_score) AS average, COUNT(*) AS cooperatives FROM (
         SELECT DISTINCT ON (a.cooperative_id) a.composite_score
           FROM cooperative_monthly_audits a JOIN cooperatives c ON c.id = a.cooperative_id
          WHERE c.deleted_at IS NULL ORDER BY a.cooperative_id, a.period DESC) latest`
    ),
    query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='income'  AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' AND date < DATE_TRUNC('month', CURRENT_DATE)), 0) AS income_recent,
         COALESCE(SUM(amount) FILTER (WHERE type='expense' AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' AND date < DATE_TRUNC('month', CURRENT_DATE)), 0) AS expense_recent,
         COALESCE(SUM(amount) FILTER (WHERE type='income'  AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '6 months' AND date < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'), 0) AS income_before,
         COALESCE(SUM(amount) FILTER (WHERE type='expense' AND date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '6 months' AND date < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'), 0) AS expense_before,
         MAX(date) AS last_entry
         FROM transactions WHERE cooperative_id = $1 AND status = 'completed'`,
      [cooperativeId]
    ),
    query(
      `SELECT
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL) AS members,
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active') AS active,
         (SELECT COALESCE(SUM(total_savings), 0) FROM members WHERE cooperative_id = $1 AND deleted_at IS NULL) AS savings,
         (SELECT COUNT(DISTINCT mc.member_id) FROM member_contributions mc JOIN members m ON m.id = mc.member_id
           WHERE m.cooperative_id = $1 AND m.deleted_at IS NULL
             AND mc.date >= CURRENT_DATE - INTERVAL '3 months'
             AND mc.notes IS DISTINCT FROM 'Opening balance (reconciliation)') AS payers,
         (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
           WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed'
             AND a.date >= CURRENT_DATE - INTERVAL '6 months') AS invited,
         (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
           WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed' AND ap.attended
             AND a.date >= CURRENT_DATE - INTERVAL '6 months') AS attended,
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND membership_date >= CURRENT_DATE - INTERVAL '12 months') AS joined,
         (SELECT COUNT(*) FROM members WHERE cooperative_id = $1 AND archived_at >= CURRENT_DATE - INTERVAL '12 months') AS left_coop`,
      [cooperativeId]
    ),
    query(
      `SELECT COALESCE(SUM(balance) FILTER (WHERE status IN ('active','overdue')), 0) AS outstanding,
              COUNT(*) FILTER (WHERE status IN ('active','overdue')) AS open_loans,
              COUNT(*) FILTER (WHERE status = 'overdue' OR (status = 'active' AND due_at < CURRENT_DATE)) AS overdue,
              COALESCE(SUM(balance) FILTER (WHERE status = 'overdue' OR (status = 'active' AND due_at < CURRENT_DATE)), 0) AS overdue_amount
         FROM loan_records WHERE cooperative_id = $1`,
      [cooperativeId]
    ),
    query(
      `SELECT
         (SELECT COUNT(*) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND status = 'planned' AND date < CURRENT_DATE) AS unrecorded_activities,
         (SELECT COUNT(*) FROM activities a WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL
            AND a.status = 'completed' AND a.date >= CURRENT_DATE - INTERVAL '6 months'
            AND NOT EXISTS (SELECT 1 FROM activity_participants ap WHERE ap.activity_id = a.id AND ap.attended)) AS no_attendance,
         (SELECT COUNT(*) FROM activities WHERE cooperative_id = $1 AND deleted_at IS NULL
            AND status IN ('planned','ongoing') AND date >= CURRENT_DATE) AS upcoming`,
      [cooperativeId]
    ),
    query(
      `SELECT id, type, severity, title, summary, generated_at FROM ai_insights
        WHERE cooperative_id = $1 AND resolved = false AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, generated_at DESC LIMIT 6`,
      [cooperativeId]
    ),
  ]);

  const audit = auditRes.rows[0] ?? null;
  const previous = auditRes.rows[1] ?? null;
  const m = money.rows[0];
  const p = people.rows[0];
  const l = loans.rows[0];
  const lv = live.rows[0];
  const districtAverage = districtRes.rows[0]?.average != null ? Math.round(n(districtRes.rows[0].average)) : null;

  const issues: Array<{ code: string; severity: Severity; title: string }> =
    Array.isArray(audit?.signals?.issues) ? audit.signals.issues : [];
  const components: Record<string, number> = audit?.signals?.components ?? {};
  const members = n(p.members);
  const payingShare = pct(n(p.payers), members);
  const attendanceShare = pct(n(p.attended), n(p.invited));

  // ── Priorities ────────────────────────────────────────────────────────────
  const priorities: Priority[] = issues
    .filter((i) => REMEDIES[i.code])
    .map((i) => ({ code: i.code, severity: i.severity, ...REMEDIES[i.code] }));

  // Things true today that the last audit could not yet know.
  if (n(lv.unrecorded_activities) > 0 && !priorities.some((x) => x.code === "GOV-004")) {
    priorities.push({
      code: "NOW-ACT", severity: "major",
      title: `${n(lv.unrecorded_activities)} planned activit${n(lv.unrecorded_activities) === 1 ? "y has" : "ies have"} passed without being marked done or cancelled`,
      why: "An activity left as planned after its date counts as not having happened.",
      action: "Open each one and mark it done (then take attendance) or cancelled.",
      link: "/activities", linkLabel: "Open activities",
    });
  }
  if (n(lv.no_attendance) > 0 && !priorities.some((x) => x.code === "ENG-003")) {
    priorities.push({
      code: "NOW-ATT", severity: "major",
      title: `${n(lv.no_attendance)} activit${n(lv.no_attendance) === 1 ? "y" : "ies"} held with no attendance marked`,
      why: "Attendance is the evidence that members took part.",
      action: "Open each activity and tick who attended.",
      link: "/activities", linkLabel: "Open activities",
    });
  }
  if (n(l.overdue) > 0) {
    priorities.push({
      code: "NOW-LOAN", severity: "major",
      title: `${n(l.overdue)} loan${n(l.overdue) === 1 ? " is" : "s are"} overdue (${rwf(l.overdue_amount)})`,
      why: "Overdue loans are money the cooperative may not get back.",
      action: "Agree a repayment plan with each member and record repayments as they come in.",
      link: "/financials", linkLabel: "Open loans",
    });
  }
  priorities.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  // ── Areas ─────────────────────────────────────────────────────────────────
  const areaIssues = (component: string) => issues.filter((i: any) => i.component === component);
  const participationScore = audit ? Math.round(n(audit.engagement_score)) : null;
  const areas = AREAS.map((a) => {
    const score = a.component != null ? (components[a.component] != null ? Math.round(n(components[a.component])) : null) : participationScore;
    const found = a.component ? areaIssues(a.component) : areaIssues("engagement");
    let sentence: string;
    switch (a.key) {
      case "trading": {
        const net = n(m.income_recent) - n(m.expense_recent);
        sentence = m.last_entry
          ? `In the last three full months: ${rwf(m.income_recent)} in, ${rwf(m.expense_recent)} out — a ${net >= 0 ? "surplus" : "deficit"} of ${rwf(Math.abs(net))}.`
          : "No income or expenses have been recorded yet.";
        break;
      }
      case "meetings":
        sentence = found.length
          ? found.map((i) => REMEDIES[i.code]?.title ?? i.title).join(". ") + "."
          : `Meetings and assemblies are being held and recorded. ${n(lv.upcoming)} activit${n(lv.upcoming) === 1 ? "y is" : "ies are"} planned ahead.`;
        break;
      case "records":
        sentence = found.length
          ? found.map((i) => REMEDIES[i.code]?.title ?? i.title).join(". ") + "."
          : "The balance sheet, documents, board and permit are in order.";
        break;
      case "membership":
        sentence = `${members} members, ${n(p.active)} active. In the last 12 months ${n(p.joined)} joined and ${n(p.left_coop)} left.`;
        break;
      default:
        sentence =
          `${n(p.payers)} of ${members} members paid a contribution in the last three months` +
          (payingShare != null ? ` (${payingShare}%)` : "") +
          (attendanceShare != null ? `, and members attended ${attendanceShare}% of the activity places they were registered for.` : ".");
    }
    return { key: a.key, label: a.label, about: a.about, score, level: level(score), sentence, findings: found.length };
  });

  // ── Strengths ─────────────────────────────────────────────────────────────
  const strengths: string[] = [];
  // Short, and not a repeat of the area sentences shown beside them.
  const solid = areas.filter((a) => a.level === "good" && a.findings === 0).map((a) => a.label.toLowerCase());
  if (solid.length) strengths.push(`In good order: ${solid.join(", ")}.`);
  if (n(m.income_recent) > n(m.expense_recent)) strengths.push("The cooperative earned more than it spent over the last three months.");
  if (payingShare != null && payingShare >= 70) strengths.push(`${payingShare}% of members paid a contribution in the last three months.`);
  if (attendanceShare != null && attendanceShare >= 70) strengths.push(`Members attended ${attendanceShare}% of the activities they were registered for.`);
  if (n(l.open_loans) > 0 && n(l.overdue) === 0) strengths.push(`All ${n(l.open_loans)} open loans are within their due dates.`);

  // ── Headline ──────────────────────────────────────────────────────────────
  const score = audit ? Math.round(n(audit.composite_score)) : null;
  const change = audit && previous ? Math.round(n(audit.composite_score) - n(previous.composite_score)) : null;
  const critical = priorities.filter((x) => x.severity === "critical").length;
  const bandWords: Record<string, string> = {
    healthy: "is in good health",
    monitor: "is operating, with some areas to watch",
    at_risk: "is at risk and needs attention",
    critical: "needs urgent attention",
  };
  const headline = audit
    ? `${coop.name} ${bandWords[audit.band] ?? "has been assessed"}. ` +
      (priorities.length
        ? `There ${priorities.length === 1 ? "is 1 thing" : `are ${priorities.length} things`} to put right${critical ? `, ${critical} of them urgent` : ""}.`
        : "Nothing needs putting right at the moment.")
    : `${coop.name} has not been through a monthly audit yet, so there is no overall score. What can be read from the records is below.`;

  const incomeChange = n(m.income_before) > 0 ? Math.round(((n(m.income_recent) - n(m.income_before)) / n(m.income_before)) * 100) : null;

  return {
    cooperative: { id: coop.id, name: coop.name, sector: coop.sector },
    headline: {
      sentence: headline,
      score,
      band: audit?.band ?? null,
      period: audit?.period ?? null,
      change,
      districtAverage,
      comparison:
        score != null && districtAverage != null
          ? score >= districtAverage
            ? `${score - districtAverage} point(s) above the district average of ${districtAverage}.`
            : `${districtAverage - score} point(s) below the district average of ${districtAverage}.`
          : null,
    },
    areas,
    priorities,
    strengths: strengths.slice(0, 5),
    numbers: {
      members,
      activeMembers: n(p.active),
      savings: n(p.savings),
      incomeLast3Months: n(m.income_recent),
      expenseLast3Months: n(m.expense_recent),
      incomeChange,
      loansOutstanding: n(l.outstanding),
      overdueLoans: n(l.overdue),
      payingShare,
      attendanceShare,
      upcomingActivities: n(lv.upcoming),
    },
    alerts: alerts.rows,
    method:
      "Worked out from this cooperative's own records and its latest monthly audit. " +
      "Each area is scored 0-100: 70 and above is good, 50-69 is worth watching, below 50 is a problem. " +
      "The district average is the only outside figure used; no other cooperative is named.",
  };
}
