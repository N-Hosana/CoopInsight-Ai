import { callAIService } from "./aiClient";
import { query } from "../config/db";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN AUDIT BUILT FROM WHAT THE AI SERVICE ACTUALLY FINDS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Monthly audit page showed stored rows from earlier runs, so it said the
 * same thing every visit. This audit is computed when it is asked for, for the
 * cooperative and month chosen, from five independent readings of the records:
 *
 *   operations   functionality + engagement index for THAT month, and the month
 *                before, so a decline shows (analytics/monthly_audit.py)
 *   money        transaction anomalies — robust z-scores and an Isolation
 *                Forest over the district's transactions (analytics/anomalies.py),
 *                limited to the 12 months up to the audited month
 *   outlook      income and expense forecast for the next three months
 *   members      each member's engagement band (analytics/engagement.py)
 *   peers        percentile against the district's other cooperatives
 *
 * Each reading becomes a 0–100 sub-score with its weight shown, and every
 * finding names the model it came from. Nothing is invented: if the service
 * cannot measure a part, that part is left out of the score and the result
 * says so. The same records audited for the same month give the same answer —
 * as an audit should — while a different month, new records, or a new anomaly
 * give a different one, and each run is compared with the previous one.
 */

export type FindingSeverity = "high" | "medium" | "low";

export interface Finding {
  severity: FindingSeverity;
  area: "Operations" | "Governance" | "Records" | "Members" | "Finances" | "Peers" | "Outlook";
  title: string;
  evidence: string;
  source: string;
  action?: string;
}

export interface AuditPart {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  note: string;
}

export interface AuditResult {
  cooperativeId: string;
  cooperativeName: string;
  sector: string | null;
  period: string;
  periodLabel: string;
  score: number | null;
  band: "sound" | "needs_attention" | "at_risk" | "critical" | "not_measurable";
  verdict: string;
  parts: AuditPart[];
  findings: Finding[];
  strengths: string[];
  previousPeriod: { period: string; score: number | null; band: string | null } | null;
  sinceLastRun: { runAt: string; score: number | null; band: string; period: string } | null;
  evidenceQuality: number | null;
  sources: string[];
  unreachable: string[];
  runAt: string;
}

const WEIGHTS = { operations: 0.4, money: 0.2, members: 0.2, peers: 0.1, outlook: 0.1 };

const SEVERITY: Record<string, FindingSeverity> = { critical: "high", warning: "medium", info: "low", high: "high", medium: "medium", low: "low" };

const COMPONENT_AREA: Record<string, Finding["area"]> = {
  trading: "Operations",
  meeting: "Governance",
  record_keeping: "Records",
  recordKeeping: "Records",
  membership: "Members",
  engagement: "Members",
};

const round = (v: number) => Math.round(v * 10) / 10;
const rwf = (v: number) => `RWF ${Math.round(v).toLocaleString("en-US")}`;

export const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

const previousMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthEnd = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59));
};

function bandOf(score: number | null): AuditResult["band"] {
  if (score == null) return "not_measurable";
  if (score >= 75) return "sound";
  if (score >= 55) return "needs_attention";
  if (score >= 35) return "at_risk";
  return "critical";
}

const BAND_WORDS: Record<AuditResult["band"], string> = {
  sound: "Sound",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  critical: "Critical",
  not_measurable: "Not measurable",
};
export const bandWords = (b: string) => BAND_WORDS[b as AuditResult["band"]] ?? b;

/** "Measured 0% — at least 30% expected", in the unit the issue is measured in. */
function evidenceOf(issue: { value: number | null; threshold: number | null; unit?: string }): string {
  if (issue.value == null) return "Recorded in the cooperative's books for the period.";
  const show = (v: number) =>
    issue.unit === "ratio" ? `${Math.round(v * 100)}%`
      : issue.unit === "RWF" ? rwf(v)
      : `${v}${issue.unit ? ` ${issue.unit}` : ""}`;
  if (issue.threshold == null || issue.threshold === issue.value) return `Measured ${show(issue.value)}.`;
  // A threshold of 0 for money means "anything at all was expected".
  if (issue.threshold === 0) return `Measured ${show(issue.value)} — some activity was expected.`;
  const word = issue.value < issue.threshold ? "at least" : "at most";
  return `Measured ${show(issue.value)} — ${word} ${show(issue.threshold)} expected.`;
}

/** Ask the AI service; a failure is recorded, never thrown. */
async function ask<T = any>(path: string, unreachable: string[], label: string, method = "GET", body?: object): Promise<T | null> {
  try {
    const r = await callAIService(path, method, body, 20000);
    // FastAPI reports an error as a body holding only `detail`.
    const failed = !r || typeof r !== "object" || (Object.keys(r).length === 1 && "detail" in r);
    if (!failed) return r as T;
    unreachable.push(label);
    return null;
  } catch {
    unreachable.push(label);
    return null;
  }
}

export async function runAiAudit(cooperativeId: string, period: string): Promise<AuditResult> {
  const unreachable: string[] = [];
  const prev = previousMonth(period);
  const end = monthEnd(period);
  const yearBefore = new Date(end.getTime() - 365 * 86_400_000);

  const [current, before, anomalies, engagement, benchmarks, income, expense, coop] = await Promise.all([
    ask(`/monthly-audit/${cooperativeId}?period=${period}`, unreachable, "functionality audit"),
    ask(`/monthly-audit/${cooperativeId}?period=${prev}`, [], "previous month"),
    ask(`/anomalies/detect`, unreachable, "anomaly detector", "POST", { cooperativeId }),
    ask(`/member-engagement?cooperativeId=${cooperativeId}`, unreachable, "engagement model"),
    ask(`/benchmarks?cooperativeId=${cooperativeId}`, unreachable, "peer benchmarks"),
    ask(`/forecasts?cooperativeId=${cooperativeId}&metric=income&horizon=3m`, [], "income forecast"),
    ask(`/forecasts?cooperativeId=${cooperativeId}&metric=expense&horizon=3m`, [], "expense forecast"),
    query(`SELECT name, sector FROM cooperatives WHERE id = $1`, [cooperativeId]).then((r) => r.rows[0]),
  ]);

  // Engagement, peer standing and the forecast are only ever computed for
  // today. For a month long past, say so — and leave the forecast out, since a
  // projection made today says nothing about how that month went.
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const recent = period >= previousMonth(thisMonth);
  const asOf = recent ? "" : " · today's data";

  const findings: Finding[] = [];
  const strengths: string[] = [];
  const sources = new Set<string>();
  const parts: AuditPart[] = [];

  // ── 1. Operations: the functionality + engagement index for this month ───
  const row = current?.result ?? null;
  const prevRow = before?.result ?? null;
  if (row) {
    sources.add(`${current.model_name ?? "cooperative_functionality_auditor"}`);
    parts.push({
      key: "operations",
      label: "Operating and governing",
      weight: WEIGHTS.operations,
      score: round(row.compositeScore),
      note: `Trading ${Math.round(row.components.trading)} · Meetings ${Math.round(row.components.meeting)} · Records ${Math.round(row.components.recordKeeping)} · Members ${Math.round(row.components.membership)}`,
    });
    for (const issue of row.issues ?? []) {
      findings.push({
        severity: SEVERITY[issue.severity] ?? "medium",
        area: COMPONENT_AREA[issue.component] ?? "Operations",
        title: issue.title,
        evidence: evidenceOf(issue),
        source: "Functionality audit",
      });
    }
    if (row.dormant) {
      findings.unshift({
        severity: "high",
        area: "Operations",
        title: "No trading recorded for six months or more — the cooperative may have stopped operating",
        evidence: `Last transaction ${row.monthsSinceLastTransaction ?? "never"} month(s) before the end of ${monthLabel(period)}.`,
        source: "Functionality audit",
        action: "Visit the cooperative and confirm whether it is still operating.",
      });
    }
    if (prevRow && prevRow.compositeScore - row.compositeScore >= 10) {
      findings.push({
        severity: prevRow.compositeScore - row.compositeScore >= 20 ? "high" : "medium",
        area: "Operations",
        title: `Sharp decline since ${monthLabel(prev)}`,
        evidence: `Operating score fell from ${round(prevRow.compositeScore)} to ${round(row.compositeScore)} in one month (trading ${prevRow.components.trading} → ${row.components.trading}, meetings ${prevRow.components.meeting} → ${row.components.meeting}).`,
        source: "Functionality audit",
        action: "Ask the manager what changed this month.",
      });
    }
    if (row.components.recordKeeping >= 85) strengths.push(`Books and documents are kept up to date (records ${row.components.recordKeeping}/100).`);
    if (row.components.meeting >= 85) strengths.push(`The cooperative is governing itself — meetings and assemblies held (${row.components.meeting}/100).`);
    if (row.flaggedOnSilenceAlone) {
      findings.push({
        severity: "low",
        area: "Records",
        title: "Much of this result rests on missing records rather than recorded activity",
        evidence: `Only ${Math.round((row.evidenceQuality ?? 0) * 100)}% of the operating measures could be taken from records (${(row.unmeasured ?? []).join(", ") || "—"} not measured).`,
        source: "Functionality audit",
        action: "Check whether the cooperative is using the system before drawing conclusions.",
      });
    }
  }

  // ── 2. Money: anomalies in the year up to the audited month ───────────────
  if (anomalies) {
    sources.add(anomalies.method ? `anomaly detector (${anomalies.method})` : "anomaly detector");
    const inWindow = (anomalies.anomalies ?? []).filter((a: any) => {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(`${a.summary ?? ""} ${a.detail ?? ""}`);
      if (!m) return true; // structural checks carry no date — they describe the books as a whole
      const d = new Date(`${m[1]}T12:00:00Z`);
      return d <= end && d >= yearBefore;
    });
    const weightOf = { critical: 25, warning: 10, info: 2 } as Record<string, number>;
    const penalty = inWindow.reduce((s: number, a: any) => s + (weightOf[a.severity] ?? 5), 0);
    parts.push({
      key: "money",
      label: "Unusual transactions",
      weight: WEIGHTS.money,
      score: Math.max(0, 100 - penalty),
      note: `${inWindow.length} flagged of ${anomalies.evaluated} · last 12 months`,
    });
    const serious = inWindow.filter((a: any) => a.severity !== "info");
    for (const a of serious.slice(0, 6)) {
      findings.push({
        severity: SEVERITY[a.severity] ?? "medium",
        area: "Finances",
        title: a.title,
        evidence: a.summary,
        source: a.model_name ?? "Anomaly detector",
        action: "Check the entry against its receipt or bank statement.",
      });
    }
    const minor = inWindow.length - serious.length;
    if (minor > 0) {
      findings.push({
        severity: "low",
        area: "Finances",
        title: `${minor} transaction(s) outside the district's usual pattern`,
        evidence: "Amount, timing or direction unusual for the district, but within plausible bounds. Worth a glance at the next books review.",
        source: "Anomaly detector (Isolation Forest)",
      });
    }
    if (!inWindow.length) strengths.push("No unusual transactions in the last 12 months.");
  }

  // ── 3. Members: engagement bands ──────────────────────────────────────────
  const members = engagement?.engagement ?? [];
  if (members.length) {
    sources.add(engagement.model_name ?? "engagement model");
    const atRisk = members.filter((m: any) => m.band === "at_risk").length;
    const high = members.filter((m: any) => m.band === "high").length;
    const avg = members.reduce((s: number, m: any) => s + Number(m.overallScore), 0) / members.length;
    parts.push({
      key: "members",
      label: "Member engagement",
      weight: WEIGHTS.members,
      score: round(avg),
      note: `${high} high · ${members.length - atRisk - high} moderate · ${atRisk} at risk${asOf}`,
    });
    const share = atRisk / members.length;
    if (share >= 0.5) {
      findings.push({
        severity: share >= 0.7 ? "high" : "medium",
        area: "Members",
        title: `${Math.round(share * 100)}% of members are at risk of disengaging`,
        evidence: `${atRisk} of ${members.length} members rarely attend or contribute.`,
        source: engagement.model_name ?? "Engagement model",
        action: "Hold a members' meeting on why participation has fallen; contact the least active members directly.",
      });
    } else if (share <= 0.2) {
      strengths.push(`Members are engaged — only ${atRisk} of ${members.length} at risk.`);
    }
  }

  // ── 4. Peers ──────────────────────────────────────────────────────────────
  const marks = benchmarks?.benchmarks ?? [];
  if (marks.length) {
    sources.add(benchmarks.model_name ?? "peer benchmarks");
    const avg = marks.reduce((s: number, b: any) => s + Number(b.percentile), 0) / marks.length;
    parts.push({
      key: "peers",
      label: "Standing among peers",
      weight: WEIGHTS.peers,
      score: round(avg),
      note: `vs ${benchmarks.peerCount} cooperatives${asOf}`,
    });
    for (const b of marks) {
      if (b.percentile <= 25) {
        findings.push({
          severity: "medium",
          area: "Peers",
          title: `${b.metric} is in the bottom quarter of the district`,
          evidence: `${b.yourValue}${b.unit} against a district average of ${b.averageCooperative}${b.unit}.`,
          source: "Peer benchmarks",
        });
      } else if (b.percentile >= 85) {
        strengths.push(`${b.metric} is among the best in the district (${b.yourValue}${b.unit}, average ${b.averageCooperative}${b.unit}).`);
      }
    }
    const falling = marks.filter((b: any) => b.trend === "down");
    if (falling.length >= Math.ceil(marks.length * 0.6)) {
      findings.push({
        severity: "low",
        area: "Peers",
        title: `${falling.length} of ${marks.length} measures are trending down`,
        evidence: falling.map((b: any) => b.metric).join(", ") + ".",
        source: "Peer benchmarks",
      });
    }
  }

  // ── 5. Outlook: the next three months ─────────────────────────────────────
  const sum = (f: any) => (f?.forecast ?? []).reduce((s: number, p: any) => s + Number(p.value), 0);
  if (!recent) {
    // No outlook part for a past month.
  } else if (income?.forecast?.length && expense?.forecast?.length) {
    sources.add(income.model_name ?? "forecaster");
    const net = sum(income) - sum(expense);
    const inc = sum(income);
    const margin = inc > 0 ? net / inc : -1;
    parts.push({
      key: "outlook",
      label: "Three-month outlook",
      weight: WEIGHTS.outlook,
      score: Math.round(Math.max(0, Math.min(100, 50 + margin * 100))),
      note: `Next 3 months: in ${rwf(inc)} · out ${rwf(sum(expense))}`,
    });
    if (net < 0) {
      findings.push({
        severity: net < -0.2 * Math.max(inc, 1) ? "high" : "medium",
        area: "Outlook",
        title: "Spending is projected to exceed income over the next three months",
        evidence: `Projected deficit of ${rwf(-net)} on current trends.`,
        source: income.model_name ?? "Forecaster",
        action: "Review planned spending with the board before it is committed.",
      });
    }
  } else {
    const why = income?.note || expense?.note;
    if (why) parts.push({ key: "outlook", label: "Three-month outlook", weight: WEIGHTS.outlook, score: null, note: why });
  }

  // ── The score: weighted over the parts that could be measured ─────────────
  const measured = parts.filter((p) => p.score != null);
  const totalWeight = measured.reduce((s, p) => s + p.weight, 0);
  const score = totalWeight ? round(measured.reduce((s, p) => s + p.weight * (p.score as number), 0) / totalWeight) : null;
  const band = bandOf(score);

  const order: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const highs = findings.filter((f) => f.severity === "high").length;

  // ── Compared with the last time this cooperative was audited ──────────────
  const last = await query(
    // An earlier audit of the same month first (a re-audit after records
    // changed); otherwise the most recent audit of any month.
    `SELECT run_at, score, band, period FROM ai_audits WHERE cooperative_id = $1
      ORDER BY (period = $2) DESC, run_at DESC LIMIT 1`,
    [cooperativeId, period]
  ).catch(() => ({ rows: [] as any[] }));

  const name = coop?.name ?? row?.cooperativeName ?? "The cooperative";
  const verdict =
    score == null
      ? `${name} could not be audited: the AI service could not measure enough of its records.`
      : `${name} is rated ${BAND_WORDS[band].toLowerCase()} (${score}/100) for ${monthLabel(period)}, with ` +
        `${findings.length} finding${findings.length === 1 ? "" : "s"}${highs ? `, ${highs} of them serious` : ""}.` +
        (prevRow && row ? ` Its operating score was ${round(prevRow.compositeScore)} the month before.` : "");

  return {
    cooperativeId,
    cooperativeName: name,
    sector: coop?.sector ?? row?.sector ?? null,
    period,
    periodLabel: monthLabel(period),
    score,
    band,
    verdict,
    parts,
    findings,
    strengths: strengths.slice(0, 5),
    previousPeriod: prevRow ? { period: prev, score: round(prevRow.compositeScore), band: prevRow.band } : null,
    sinceLastRun: last.rows[0]
      ? { runAt: new Date(last.rows[0].run_at).toISOString(), score: last.rows[0].score != null ? Number(last.rows[0].score) : null, band: last.rows[0].band, period: last.rows[0].period }
      : null,
    evidenceQuality: row?.evidenceQuality ?? null,
    sources: [...sources],
    unreachable,
    runAt: new Date().toISOString(),
  };
}
