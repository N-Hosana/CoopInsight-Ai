import { query } from "../config/db";
import { REMEDIES, Level, Severity } from "./cooperativeBrief";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * INSIGHTS FOR THE PEOPLE WHO SUPERVISE COOPERATIVES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A manager's insights are about one cooperative. An officer's are about many,
 * and the questions change with it: how are the cooperatives I supervise doing
 * as a whole, which ones need me first, and is a problem one cooperative's or
 * everybody's?
 *
 *   sector officer     the cooperatives of their sector
 *   district office    the district, sector by sector
 *   RCA, admin, GM     everything, district by district and sector by sector
 *
 * Every figure is read from the cooperatives' own records and each one's latest
 * monthly audit. Nothing is estimated: a cooperative that has never been
 * audited is counted as "not assessed", not given a score.
 */

export type OversightLevel = "sector" | "district" | "overall";

export interface OversightScope {
  level: OversightLevel;
  /** Fixed for a sector officer; an optional filter for everyone above. */
  sector: string | null;
  /** An optional filter, for the overall view only. */
  district: string | null;
}

type Band = "healthy" | "monitor" | "at_risk" | "critical";

/** A problem is widespread when this share of the group has it, and at least this many. */
const WIDESPREAD_SHARE = 0.4;
const WIDESPREAD_MIN = 3;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
const BAND_RANK: Record<Band, number> = { critical: 0, at_risk: 1, monitor: 2, healthy: 3 };

const AREAS: Array<{ key: string; label: string; component?: string; about: string }> = [
  { key: "trading", label: "Trading", component: "trading", about: "Is money coming in and going out, and is it being recorded?" },
  { key: "meetings", label: "Meetings and assemblies", component: "meeting", about: "Are cooperatives meeting and holding their general assemblies?" },
  { key: "records", label: "Records and permits", component: "recordKeeping", about: "Are books, documents, boards and permits in order?" },
  { key: "membership", label: "Membership", component: "membership", about: "Are registers stable, or are members leaving?" },
  { key: "participation", label: "Member participation", about: "Are members paying in and turning up?" },
];

const n = (v: unknown) => Number(v ?? 0);
const round = (v: number) => Math.round(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const level = (score: number | null): Level => (score == null ? "watch" : score >= 70 ? "good" : score >= 50 ? "watch" : "problem");
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

interface Row {
  id: string;
  name: string;
  sector: string | null;
  district: string | null;
  members: number;
  savings: number;
  score: number | null;
  band: Band | null;
  period: string | null;
  change: number | null;
  components: Record<string, number>;
  participation: number | null;
  issues: Array<{ code: string; severity: Severity; title: string }>;
}

function summarise(name: string, rows: Row[]) {
  const assessed = rows.filter((r) => r.score != null);
  const average = mean(assessed.map((r) => r.score as number));
  const atRisk = rows.filter((r) => r.band === "at_risk" || r.band === "critical").length;
  const counts = new Map<string, number>();
  for (const r of rows) for (const code of new Set(r.issues.map((i) => i.code))) counts.set(code, (counts.get(code) ?? 0) + 1);
  const top = [...counts.entries()].filter(([code]) => REMEDIES[code]).sort((a, b) => b[1] - a[1])[0];
  return {
    name,
    cooperatives: rows.length,
    assessed: assessed.length,
    members: rows.reduce((a, r) => a + r.members, 0),
    averageScore: average != null ? round(average) : null,
    level: level(average),
    atRisk,
    topProblem: top ? { title: REMEDIES[top[0]].title, cooperatives: top[1] } : null,
  };
}

function groupBy(rows: Row[], key: (r: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([name, members]) => summarise(name, members))
    .sort((a, b) => (a.averageScore ?? 101) - (b.averageScore ?? 101) || a.name.localeCompare(b.name));
}

export async function oversightBrief(scope: OversightScope) {
  // What the viewer may choose from, before any filter of their own is applied.
  const reach: string[] = ["c.deleted_at IS NULL"];
  const reachParams: unknown[] = [];
  if (scope.level === "sector") {
    reachParams.push(scope.sector);
    reach.push(`c.sector = $${reachParams.length}`);
  }
  const places = await query(
    `SELECT DISTINCT COALESCE(c.district, 'Unrecorded') AS district, COALESCE(c.sector, 'Unrecorded') AS sector
       FROM cooperatives c WHERE ${reach.join(" AND ")} ORDER BY 1, 2`,
    reachParams
  );

  const where = [...reach];
  const params = [...reachParams];
  if (scope.level !== "sector" && scope.sector) {
    params.push(scope.sector);
    where.push(`c.sector = $${params.length}`);
  }
  if (scope.level === "overall" && scope.district) {
    params.push(scope.district);
    where.push(`c.district = $${params.length}`);
  }
  const inScope = where.join(" AND ");

  const [coops, money, people, alerts, alertCount] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.sector, c.district,
              (SELECT COUNT(*) FROM members m WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS members,
              (SELECT COALESCE(SUM(m.total_savings), 0) FROM members m WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS savings,
              la.period, la.composite_score, la.engagement_score, la.band, la.signals,
              pa.composite_score AS previous_score
         FROM cooperatives c
         LEFT JOIN LATERAL (
           SELECT TO_CHAR(a.period, 'YYYY-MM') AS period, a.composite_score, a.engagement_score, a.band, a.signals
             FROM cooperative_monthly_audits a WHERE a.cooperative_id = c.id ORDER BY a.period DESC LIMIT 1) la ON TRUE
         LEFT JOIN LATERAL (
           SELECT a.composite_score FROM cooperative_monthly_audits a
            WHERE a.cooperative_id = c.id ORDER BY a.period DESC OFFSET 1 LIMIT 1) pa ON TRUE
        WHERE ${inScope}
        ORDER BY c.name`,
      params
    ),
    query(
      `SELECT
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense,
         COUNT(DISTINCT t.cooperative_id) AS recording
         FROM transactions t JOIN cooperatives c ON c.id = t.cooperative_id
        WHERE ${inScope} AND t.status = 'completed'
          AND t.date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
          AND t.date < DATE_TRUNC('month', CURRENT_DATE)`,
      params
    ),
    query(
      `SELECT
         (SELECT COUNT(DISTINCT mc.member_id) FROM member_contributions mc
            JOIN members m ON m.id = mc.member_id JOIN cooperatives c ON c.id = m.cooperative_id
           WHERE ${inScope} AND m.deleted_at IS NULL
             AND mc.date >= CURRENT_DATE - INTERVAL '3 months'
             AND mc.notes IS DISTINCT FROM 'Opening balance (reconciliation)') AS payers,
         (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
            JOIN cooperatives c ON c.id = a.cooperative_id
           WHERE ${inScope} AND a.deleted_at IS NULL AND a.status = 'completed'
             AND a.date >= CURRENT_DATE - INTERVAL '6 months') AS invited,
         (SELECT COUNT(*) FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id
            JOIN cooperatives c ON c.id = a.cooperative_id
           WHERE ${inScope} AND a.deleted_at IS NULL AND a.status = 'completed' AND ap.attended
             AND a.date >= CURRENT_DATE - INTERVAL '6 months') AS attended`,
      params
    ),
    query(
      `SELECT ai.id, ai.type, ai.severity, ai.title, ai.summary, ai.generated_at,
              c.id AS cooperative_id, c.name AS cooperative_name
         FROM ai_insights ai JOIN cooperatives c ON c.id = ai.cooperative_id
        WHERE ${inScope} AND ai.resolved = false AND (ai.expires_at IS NULL OR ai.expires_at > NOW())
        ORDER BY CASE ai.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, ai.generated_at DESC
        LIMIT 8`,
      params
    ),
    query(
      `SELECT COUNT(*) AS n FROM ai_insights ai JOIN cooperatives c ON c.id = ai.cooperative_id
        WHERE ${inScope} AND ai.resolved = false AND (ai.expires_at IS NULL OR ai.expires_at > NOW())`,
      params
    ),
  ]);

  const rows: Row[] = coops.rows.map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    district: r.district,
    members: n(r.members),
    savings: n(r.savings),
    score: r.composite_score != null ? round(n(r.composite_score)) : null,
    band: r.band ?? null,
    period: r.period ?? null,
    change: r.composite_score != null && r.previous_score != null ? round(n(r.composite_score) - n(r.previous_score)) : null,
    components: r.signals?.components ?? {},
    participation: r.engagement_score != null ? n(r.engagement_score) : null,
    issues: Array.isArray(r.signals?.issues) ? r.signals.issues.filter((i: any) => REMEDIES[i.code]) : [],
  }));

  const total = rows.length;
  const assessed = rows.filter((r) => r.score != null);
  const average = mean(assessed.map((r) => r.score as number));
  const paired = assessed.filter((r) => r.change != null);
  const change = paired.length ? round(mean(paired.map((r) => r.change as number)) as number) : null;
  const standing = {
    healthy: rows.filter((r) => r.band === "healthy").length,
    monitor: rows.filter((r) => r.band === "monitor").length,
    atRisk: rows.filter((r) => r.band === "at_risk").length,
    critical: rows.filter((r) => r.band === "critical").length,
    notAssessed: total - assessed.length,
  };
  const struggling = standing.atRisk + standing.critical;

  // ── Problems shared between cooperatives ──────────────────────────────────
  const byCode = new Map<string, { severity: Severity; affected: Array<{ id: string; name: string }> }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const i of r.issues) {
      if (seen.has(i.code)) continue;
      seen.add(i.code);
      const entry = byCode.get(i.code) ?? { severity: i.severity, affected: [] };
      if (SEVERITY_RANK[i.severity] < SEVERITY_RANK[entry.severity]) entry.severity = i.severity;
      entry.affected.push({ id: r.id, name: r.name });
      byCode.set(i.code, entry);
    }
  }
  const commonProblems = [...byCode.entries()]
    .map(([code, e]) => {
      const cooperatives = e.affected.length;
      return {
        code,
        severity: e.severity,
        title: REMEDIES[code].title,
        why: REMEDIES[code].why,
        action: REMEDIES[code].action,
        cooperatives,
        share: share(cooperatives, assessed.length) ?? 0,
        widespread: assessed.length > 0 && cooperatives / assessed.length >= WIDESPREAD_SHARE && cooperatives >= WIDESPREAD_MIN,
        affected: e.affected,
      };
    })
    .sort(
      (a, b) =>
        Number(b.widespread) - Number(a.widespread) ||
        b.cooperatives - a.cooperatives ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    );

  // ── Area by area, across the group ────────────────────────────────────────
  const areas = AREAS.map((a) => {
    const scores = assessed
      .map((r) => (a.component ? r.components[a.component] : r.participation))
      .filter((v): v is number => typeof v === "number");
    const avg = mean(scores);
    const weak = scores.filter((s) => s < 50).length;
    return {
      key: a.key,
      label: a.label,
      about: a.about,
      score: avg != null ? round(avg) : null,
      level: level(avg),
      sentence: scores.length
        ? weak
          ? `${plural(weak, "cooperative is", "cooperatives are")} below 50 here, out of ${scores.length} assessed.`
          : `None of the ${scores.length} cooperatives assessed is below 50 here.`
        : "Not measured yet: no cooperative in this group has an audit covering it.",
    };
  });
  const measured = areas.filter((a) => a.score != null);
  const weakestArea = measured.length ? [...measured].sort((a, b) => (a.score as number) - (b.score as number))[0] : null;

  // ── Cooperative by cooperative ────────────────────────────────────────────
  const cooperatives = rows
    .map((r) => {
      const worst = [...r.issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
      return {
        id: r.id,
        name: r.name,
        sector: r.sector,
        district: r.district,
        members: r.members,
        score: r.score,
        band: r.band,
        change: r.change,
        period: r.period,
        findings: r.issues.length,
        urgent: r.issues.filter((i) => i.severity === "critical").length,
        mainProblem: worst ? REMEDIES[worst.code].title : null,
      };
    })
    // Most in need first; those never assessed last, since nothing is known.
    .sort(
      (a, b) =>
        Number(a.score == null) - Number(b.score == null) ||
        (a.band && b.band ? BAND_RANK[a.band] - BAND_RANK[b.band] : 0) ||
        (a.score ?? 0) - (b.score ?? 0) ||
        a.name.localeCompare(b.name)
    );

  // ── The headline ──────────────────────────────────────────────────────────
  const districts = [...new Set(places.rows.map((p) => p.district as string))];
  const chosenDistrict = scope.level === "overall" ? scope.district : null;
  const name =
    scope.sector
      ? `${scope.sector} sector`
      : chosenDistrict
        ? `${chosenDistrict} District`
        : scope.level === "district" && districts.length === 1
          ? `${districts[0]} District`
          : scope.level === "district"
            ? "the district"
            : "all districts";

  let sentence: string;
  if (!total) {
    sentence = `There are no cooperatives on the register in ${name}.`;
  } else if (!assessed.length) {
    sentence = `None of the ${plural(total, "cooperative", "cooperatives")} in ${name} has been through a monthly audit yet, so there is no score to report. Run the monthly audit to get one.`;
  } else {
    sentence =
      `There ${total === 1 ? "is" : "are"} ${plural(total, "cooperative", "cooperatives")} in ${name}. ` +
      (struggling
        ? `${struggling} of the ${assessed.length} assessed ${struggling === 1 ? "is" : "are"} at risk or critical` +
          (standing.critical ? `, ${standing.critical} of them critical` : "") + "."
        : `None of the ${assessed.length} assessed is at risk.`) +
      (weakestArea && weakestArea.level !== "good" ? ` The weakest area overall is ${weakestArea.label.toLowerCase()}.` : "");
  }

  const m = money.rows[0];
  const p = people.rows[0];
  const members = rows.reduce((a, r) => a + r.members, 0);
  const periods = [...new Set(assessed.map((r) => r.period as string))].sort();

  return {
    scope: {
      level: scope.level,
      name,
      sector: scope.sector,
      district: chosenDistrict,
      // What the viewer may narrow to. A sector officer has nothing to choose.
      districts: scope.level === "overall" ? districts : [],
      sectors:
        scope.level === "sector"
          ? []
          : places.rows
              .filter((x) => !chosenDistrict || x.district === chosenDistrict)
              .map((x) => ({ district: x.district as string, sector: x.sector as string })),
    },
    headline: {
      sentence,
      averageScore: average != null ? round(average) : null,
      level: level(average),
      change,
      latestPeriod: periods.length ? periods[periods.length - 1] : null,
      cooperatives: total,
      assessed: assessed.length,
    },
    standing,
    areas,
    commonProblems,
    cooperatives,
    groups: {
      districts: scope.level === "overall" && !scope.sector && !chosenDistrict ? groupBy(rows, (r) => r.district ?? "Unrecorded") : [],
      sectors: scope.level !== "sector" && !scope.sector ? groupBy(rows, (r) => r.sector ?? "Unrecorded") : [],
    },
    numbers: {
      members,
      savings: rows.reduce((a, r) => a + r.savings, 0),
      incomeLast3Months: n(m.income),
      expenseLast3Months: n(m.expense),
      cooperativesRecordingTransactions: n(m.recording),
      payingShare: share(n(p.payers), members),
      attendanceShare: share(n(p.attended), n(p.invited)),
    },
    alerts: { open: n(alertCount.rows[0].n), latest: alerts.rows },
    method:
      "Worked out from each cooperative's own records and its most recent monthly audit. Scores are 0-100: " +
      "70 and above is good, 50-69 is worth watching, below 50 is a problem. The average counts every assessed " +
      "cooperative equally. A problem is called widespread when at least 40% of the assessed cooperatives, and " +
      "at least three, share it. Cooperatives that have never been audited are counted as not assessed.",
  };
}
