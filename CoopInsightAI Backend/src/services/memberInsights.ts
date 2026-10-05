import { query } from "../config/db";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PERSONAL INSIGHTS — ONE MEMBER'S PROGRESS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The AI Insights page gave a member the district's anomalies and the
 * cooperatives' recommendations: true, but about other people. A member wants
 * to know how *they* are doing — are they saving regularly, turning up, keeping
 * up with their loan — and how their cooperative is doing, in that order.
 *
 * Everything here is computed from the member's own records, with the
 * cooperative used only as an anonymous yardstick (median, average): no other
 * member is ever named. The rules are stated in the code so a member can be
 * told exactly why an insight appeared.
 */

export type Tone = "positive" | "warning" | "info";
export type Category = "savings" | "attendance" | "loans" | "dividends" | "cooperative";

export interface PersonalInsight {
  id: string;
  category: Category;
  tone: Tone;
  title: string;
  detail: string;
}

const WINDOW_MONTHS = 6;
const QUIET_SAVINGS_DAYS = 45; // more than a month and a half without saving
const LOAN_DUE_SOON_DAYS = 30;

const n = (v: unknown) => Number(v ?? 0);
const rwf = (v: number) => `${Math.round(v).toLocaleString("en-RW")} RWF`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (v: string | Date) =>
  new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export async function memberInsights(memberId: string) {
  const memberRes = await query(
    `SELECT m.id, m.full_name, m.membership_date, m.total_savings, m.total_contributions,
            m.status, m.deleted_at, m.cooperative_id, c.name AS cooperative_name
       FROM members m JOIN cooperatives c ON c.id = m.cooperative_id
      WHERE m.id = $1`,
    [memberId]
  );
  const member = memberRes.rows[0];
  if (!member) return null;
  const coopId = member.cooperative_id as string;

  const [monthly, lastContribution, coopSavings, attendance, coopAttendance, missed, upcoming, loans, dividends, audit, coopAlerts] =
    await Promise.all([
      // Savings by month over the last six COMPLETE months, gaps included. The
      // month in progress is left out: a day into October, it would read as a
      // month with nothing saved and a quarter that had "dropped".
      query(
        `SELECT TO_CHAR(m, 'YYYY-MM') AS month,
                COALESCE((SELECT SUM(amount) FROM member_contributions mc
                           WHERE mc.member_id = $1 AND mc.type = 'savings'
                             -- A balance brought forward is not a deposit made that month.
                             AND mc.notes IS DISTINCT FROM 'Opening balance (reconciliation)'
                             AND DATE_TRUNC('month', mc.date) = m), 0) AS amount
           FROM GENERATE_SERIES(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${WINDOW_MONTHS} months',
                                DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month', INTERVAL '1 month') AS m
          ORDER BY m`,
        [memberId]
      ),
      query(`SELECT MAX(date) AS d FROM member_contributions WHERE member_id = $1`, [memberId]),
      query(
        `SELECT total_savings FROM members
          WHERE cooperative_id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [coopId]
      ),
      query(
        `SELECT COUNT(*) AS invited, COUNT(*) FILTER (WHERE ap.attended) AS attended
           FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
          WHERE ap.member_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed'
            AND a.date >= CURRENT_DATE - INTERVAL '${WINDOW_MONTHS} months'`,
        [memberId]
      ),
      query(
        `SELECT COUNT(*) AS invited, COUNT(*) FILTER (WHERE ap.attended) AS attended
           FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
          WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed'
            AND a.date >= CURRENT_DATE - INTERVAL '${WINDOW_MONTHS} months'`,
        [coopId]
      ),
      // The member's most recent registrations, newest first, to spot a run of absences.
      query(
        `SELECT a.title, a.date, ap.attended
           FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
          WHERE ap.member_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed'
          ORDER BY a.date DESC LIMIT 5`,
        [memberId]
      ),
      query(
        `SELECT a.id, a.title, a.type, a.date, a.location,
                EXISTS (SELECT 1 FROM activity_participants ap
                         WHERE ap.activity_id = a.id AND ap.member_id = $2) AS registered
           FROM activities a
          WHERE a.cooperative_id = $1 AND a.deleted_at IS NULL AND a.status IN ('planned','ongoing')
            AND a.date >= CURRENT_DATE AND a.date <= CURRENT_DATE + INTERVAL '45 days'
          ORDER BY a.date LIMIT 5`,
        [coopId, memberId]
      ),
      query(
        `SELECT id, amount, balance, purpose, due_at, status,
                COALESCE((SELECT SUM(r.amount) FROM loan_repayments r WHERE r.loan_id = l.id), 0) AS paid
           FROM loan_records l
          WHERE member_id = $1 AND status IN ('active','overdue')
          ORDER BY due_at`,
        [memberId]
      ),
      query(
        `SELECT amount, period, paid_at FROM dividend_records
          WHERE member_id = $1 ORDER BY paid_at DESC NULLS LAST LIMIT 1`,
        [memberId]
      ),
      query(
        `SELECT TO_CHAR(period, 'YYYY-MM') AS period, band, composite_score
           FROM cooperative_monthly_audits
          WHERE cooperative_id = $1 ORDER BY period DESC LIMIT 1`,
        [coopId]
      ),
      query(
        `SELECT COUNT(*) AS n FROM ai_insights
          WHERE cooperative_id = $1 AND resolved = false AND severity IN ('critical','high')
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [coopId]
      ),
    ]);

  const insights: PersonalInsight[] = [];
  const add = (i: PersonalInsight) => insights.push(i);

  // ── Savings ──────────────────────────────────────────────────────────────
  const months = monthly.rows.map((r) => ({ month: r.month as string, amount: n(r.amount) }));
  const monthsSaved = months.filter((m) => m.amount > 0).length;
  const last3 = months.slice(-3).reduce((a, m) => a + m.amount, 0);
  const prev3 = months.slice(0, 3).reduce((a, m) => a + m.amount, 0);
  const savings = n(member.total_savings);
  const lastSaved = lastContribution.rows[0]?.d ? new Date(lastContribution.rows[0].d) : null;
  const daysSinceSaving = lastSaved ? Math.floor((Date.now() - lastSaved.getTime()) / 86_400_000) : null;

  const peerSavings = coopSavings.rows.map((r) => n(r.total_savings)).sort((a, b) => a - b);
  const median = peerSavings.length ? peerSavings[Math.floor(peerSavings.length / 2)] : null;
  const percentile = peerSavings.length
    ? peerSavings.filter((v) => v <= savings).length / peerSavings.length
    : null;

  if (monthsSaved === WINDOW_MONTHS) {
    add({
      id: "savings-streak", category: "savings", tone: "positive",
      title: `You have saved every month for ${WINDOW_MONTHS} months`,
      detail: "Regular saving is the strongest sign of a member in good standing — and what a loan application is judged on.",
    });
  } else if (monthsSaved > 0) {
    add({
      id: "savings-regularity", category: "savings", tone: monthsSaved >= 4 ? "info" : "warning",
      title: `You saved in ${monthsSaved} of the last ${WINDOW_MONTHS} months`,
      detail: monthsSaved >= 4
        ? "Close to a full record. A deposit every month, however small, keeps it unbroken."
        : "Gaps in saving weaken your record. Even a small monthly deposit counts as a month saved.",
    });
  }

  if (daysSinceSaving == null) {
    add({
      id: "savings-none", category: "savings", tone: "warning",
      title: "No savings have been recorded for you yet",
      detail: "If you have been paying in, ask your manager to record it — your savings are what the cooperative owes back to you.",
    });
  } else if (daysSinceSaving > QUIET_SAVINGS_DAYS) {
    add({
      id: "savings-quiet", category: "savings", tone: "warning",
      title: `Nothing saved since ${day(lastSaved!)}`,
      detail: `That is ${daysSinceSaving} days. Your balance stands at ${rwf(savings)}.`,
    });
  }

  if (prev3 > 0 || last3 > 0) {
    const change = prev3 > 0 ? (last3 - prev3) / prev3 : 1;
    if (change >= 0.1) {
      add({
        id: "savings-up", category: "savings", tone: "positive",
        title: `You saved ${pct(change)} more in the last three months`,
        detail: `${rwf(last3)} against ${rwf(prev3)} in the three months before.`,
      });
    } else if (change <= -0.1) {
      add({
        id: "savings-down", category: "savings", tone: "warning",
        title: `Your saving has dropped by ${pct(-change)}`,
        detail: `${rwf(last3)} in the last three months against ${rwf(prev3)} before. If something has changed, your manager can help you plan.`,
      });
    }
  }

  if (median != null && percentile != null && peerSavings.length >= 3) {
    add({
      id: "savings-peers", category: "savings", tone: savings >= median ? "positive" : "info",
      title: savings >= median
        ? `Your savings are above the typical member's in ${member.cooperative_name}`
        : `Your savings are below the typical member's in ${member.cooperative_name}`,
      detail: `${rwf(savings)} against a median of ${rwf(median)}; you are ahead of ${pct(percentile)} of members. No other member is named here.`,
    });
  }

  // ── Attendance ───────────────────────────────────────────────────────────
  const invited = n(attendance.rows[0].invited);
  const attended = n(attendance.rows[0].attended);
  const coopInvited = n(coopAttendance.rows[0].invited);
  const coopRate = coopInvited ? n(coopAttendance.rows[0].attended) / coopInvited : null;
  const rate = invited ? attended / invited : null;

  if (rate != null) {
    const ahead = coopRate != null && rate >= coopRate;
    add({
      id: "attendance-rate", category: "attendance", tone: rate >= 0.75 ? "positive" : rate >= 0.5 ? "info" : "warning",
      title: `You attended ${attended} of ${invited} activities in the last ${WINDOW_MONTHS} months`,
      detail:
        `An attendance rate of ${pct(rate)}` +
        (coopRate != null ? `, against ${pct(coopRate)} across the cooperative — ${ahead ? "above" : "below"} the average.` : "."),
    });
  }
  const recent = missed.rows;
  const run = recent.findIndex((r) => r.attended);
  const missedInARow = run === -1 ? recent.length : run;
  if (missedInARow >= 2) {
    add({
      id: "attendance-missed", category: "attendance", tone: "warning",
      title: `You missed the last ${missedInARow} activities you were registered for`,
      detail: `Most recently "${recent[0].title}" on ${day(recent[0].date)}. Assemblies are where members vote on how the cooperative is run.`,
    });
  }
  for (const a of upcoming.rows.slice(0, 2)) {
    add({
      id: `upcoming-${a.id}`, category: "attendance", tone: "info",
      title: `Coming up: ${a.title} on ${day(a.date)}`,
      detail: (a.registered ? "You are registered." : "You are not registered yet — ask your manager to add you.") +
        (a.location ? ` At ${a.location}.` : ""),
    });
  }

  // ── Loans ────────────────────────────────────────────────────────────────
  for (const l of loans.rows) {
    const due = new Date(l.due_at);
    const daysToDue = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
    const progress = n(l.amount) ? n(l.paid) / n(l.amount) : 0;
    if (daysToDue < 0) {
      add({
        id: `loan-overdue-${l.id}`, category: "loans", tone: "warning",
        title: `Your loan for ${l.purpose} is overdue`,
        detail: `${rwf(n(l.balance))} was due on ${day(due)}. Speak to your manager about a repayment plan before it affects your standing.`,
      });
    } else {
      add({
        id: `loan-progress-${l.id}`, category: "loans", tone: daysToDue <= LOAN_DUE_SOON_DAYS ? "warning" : "info",
        title: `You have repaid ${pct(progress)} of your loan for ${l.purpose}`,
        detail: `${rwf(n(l.balance))} remaining, due ${day(due)}` +
          (daysToDue <= LOAN_DUE_SOON_DAYS ? ` — in ${daysToDue} day(s).` : "."),
      });
    }
  }

  // ── Dividends ────────────────────────────────────────────────────────────
  const dividend = dividends.rows[0];
  if (dividend) {
    add({
      id: "dividend-last", category: "dividends", tone: "positive",
      title: `You received a dividend of ${rwf(n(dividend.amount))} for ${dividend.period}`,
      detail: dividend.paid_at ? `Paid on ${day(dividend.paid_at)}. Dividends follow the cooperative's surplus and your share in it.` : "Recorded, awaiting payment.",
    });
  }

  // ── Your cooperative ─────────────────────────────────────────────────────
  const latest = audit.rows[0];
  if (latest) {
    const phrasing: Record<string, [Tone, string]> = {
      healthy: ["positive", "is operating well"],
      monitor: ["info", "is operating, with some areas being watched"],
      at_risk: ["warning", "has been flagged as at risk"],
      critical: ["warning", "has been flagged for urgent attention"],
    };
    const [tone, words] = phrasing[latest.band] ?? ["info", "has been assessed"];
    add({
      id: "coop-audit", category: "cooperative", tone,
      title: `${member.cooperative_name} ${words}`,
      detail: `In the ${latest.period} monthly audit it scored ${Math.round(n(latest.composite_score))}/100 on trading, meetings, record-keeping and member participation.`,
    });
  }
  const alerts = n(coopAlerts.rows[0].n);
  if (alerts > 0) {
    add({
      id: "coop-alerts", category: "cooperative", tone: "warning",
      title: `${alerts} open alert(s) about ${member.cooperative_name}'s finances`,
      detail: "These are listed below under your cooperative's insights. The manager and the sector officer are following them up.",
    });
  }

  // Warnings first, then good news, then information.
  const order: Record<Tone, number> = { warning: 0, positive: 1, info: 2 };
  insights.sort((a, b) => order[a.tone] - order[b.tone]);

  return {
    member: {
      id: member.id,
      name: member.full_name,
      cooperativeId: coopId,
      cooperativeName: member.cooperative_name,
      memberSince: member.membership_date,
      former: !!member.deleted_at,
    },
    summary: {
      savings,
      totalContributions: n(member.total_contributions),
      savingsLast3Months: last3,
      savingsPrevious3Months: prev3,
      monthsSavedOf6: monthsSaved,
      savingsPercentile: percentile,
      cooperativeMedianSavings: median,
      attendanceRate: rate,
      cooperativeAttendanceRate: coopRate,
      activitiesAttended: attended,
      activitiesInvited: invited,
      loanBalance: loans.rows.reduce((a, l) => a + n(l.balance), 0),
      lastDividend: dividend ? { amount: n(dividend.amount), period: dividend.period } : null,
      cooperativeBand: latest?.band ?? null,
    },
    savingsTrend: months,
    upcoming: upcoming.rows,
    insights,
    method:
      `Computed from your own records over the last ${WINDOW_MONTHS} months. The cooperative ` +
      "is used only as an anonymous comparison (median savings, average attendance); no other member is named.",
  };
}
