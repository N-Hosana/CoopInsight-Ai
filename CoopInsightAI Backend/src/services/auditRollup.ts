/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MONTHLY AUDIT, ROLLED UP TO SECTOR AND DISTRICT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The audit scores cooperatives one at a time. A sector officer and the district
 * office need a different answer: is this *sector* in trouble, and is the trouble
 * the same everywhere? Twelve cooperatives each missing an assembly is not twelve
 * problems, it is one — nobody in the sector is being told to hold them.
 *
 * Everything here is computed from the persisted cooperative rows for a period,
 * so a roll-up of a past month is reproducible and needs nothing from the AI
 * service. The rules are stated as constants below so they can be argued with.
 */

export interface AuditRowInput {
  cooperative_id: string;
  cooperative_name: string;
  cooperative_sector: string | null;
  member_count: string | number | null;
  functionality_score: string | number | null;
  engagement_score: string | number | null;
  composite_score: string | number | null;
  band: Band;
  visit_recommended: boolean;
  signals: {
    components?: Record<string, number>;
    engagementDetail?: {
      membersOnRegister?: number;
      contributorsLastQuarter?: number;
      attendeesLastQuarter?: number;
    };
    dormant?: boolean;
    evidenceQuality?: number;
    flaggedOnSilenceAlone?: boolean;
    permitExpiresOn?: string | null;
    permitType?: string | null;
    issues?: AuditIssue[];
  } | null;
}

export type Band = "healthy" | "monitor" | "at_risk" | "critical";
type Severity = "critical" | "major" | "minor";

export interface AuditIssue {
  code: string;
  component: string;
  severity: Severity;
  title: string;
  value: number | null;
  threshold: number | null;
  unit: string;
}

export interface PreviousRow {
  composite: number;
  band: Band;
}

export type VisitState = "open" | "completed";

// ── Rules ────────────────────────────────────────────────────────────────────

/** A finding is systemic when at least this share of the group carries it… */
export const SYSTEMIC_PREVALENCE = 0.4;
/** …and at least this many cooperatives, so two of three is not a "pattern". */
export const SYSTEMIC_MIN_COOPERATIVES = 3;
/** A cooperative this many standard deviations below its peers is an outlier. */
export const OUTLIER_Z = -1.5;
/** Minimum group size before a standard deviation means anything. */
export const OUTLIER_MIN_GROUP = 4;

const BAND_RANK: Record<Band, number> = { critical: 0, at_risk: 1, monitor: 2, healthy: 3 };
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };
const COMPONENTS = ["trading", "meeting", "recordKeeping", "membership"] as const;
const PERMIT_WARNING_DAYS = 60;

export type RiskRating = "stable" | "elevated" | "high" | "severe";

export interface Highlight {
  severity: Severity | "info";
  text: string;
}

export interface Rollup {
  level: "district" | "sector";
  name: string;
  cooperatives: number;
  members: number;
  composite: {
    mean: number;
    memberWeightedMean: number;
    median: number;
    p25: number;
    p75: number;
    iqr: number;
    stdDev: number;
    min: number;
    max: number;
  };
  functionalityMean: number;
  engagementMean: number;
  components: Record<(typeof COMPONENTS)[number], number | null>;
  weakestComponent: { name: string; mean: number } | null;
  bands: Record<"healthy" | "monitor" | "atRisk" | "critical", number>;
  atRiskRatio: number;
  dormancyRate: number;
  engagement: { contributionBreadth: number | null; attendanceBreadth: number | null };
  evidence: { meanQuality: number | null; flaggedOnSilence: number; silenceShare: number };
  permits: { expired: number; expiringSoon: number; missing: number };
  visits: { recommended: number; open: number; completed: number; coverage: number | null };
  trend: {
    pairedCooperatives: number;
    meanDelta: number | null;
    improved: number;
    deteriorated: number;
    newlyCritical: string[];
  };
  issues: Array<{
    code: string;
    title: string;
    component: string;
    severity: Severity;
    cooperatives: number;
    prevalence: number;
    systemic: boolean;
    affected: string[];
  }>;
  issuesCoded: boolean;
  outliers: Array<{ cooperativeId: string; name: string; composite: number; zScore: number }>;
  riskRating: RiskRating;
  highlights: Highlight[];
  // Filled in for a sector when it is placed against the district.
  rank?: number;
  deviationFromDistrict?: number;
}

// ── Statistics ───────────────────────────────────────────────────────────────

const n = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Linear-interpolated percentile (the same definition as numpy's default). */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Sample standard deviation. */
function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

const bySeverity = (a: Highlight, b: Highlight) =>
  (SEVERITY_RANK[b.severity as Severity] ?? 0) - (SEVERITY_RANK[a.severity as Severity] ?? 0);

function riskRating(weightedMean: number, atRiskRatio: number, dormancyRate: number, critical: number): RiskRating {
  if (atRiskRatio >= 0.5 || dormancyRate >= 0.3 || weightedMean < 30) return "severe";
  if (atRiskRatio >= 0.3 || weightedMean < 50) return "high";
  if (atRiskRatio >= 0.15 || critical > 0) return "elevated";
  return "stable";
}

// ── The roll-up ──────────────────────────────────────────────────────────────

export function rollup(
  level: "district" | "sector",
  name: string,
  rows: AuditRowInput[],
  previous: Map<string, PreviousRow>,
  visits: Map<string, VisitState>,
  periodEnd: Date
): Rollup {
  const count = rows.length;
  const composites = rows.map((r) => n(r.composite_score));
  const sorted = [...composites].sort((a, b) => a - b);
  const members = rows.map((r) => n(r.member_count));
  const totalMembers = members.reduce((a, b) => a + b, 0);
  const weightedMean = totalMembers
    ? rows.reduce((a, r, i) => a + composites[i] * members[i], 0) / totalMembers
    : mean(composites);
  const sd = stdDev(composites);
  const m = mean(composites);

  // Components — only over the cooperatives that carry them.
  const components = {} as Rollup["components"];
  for (const c of COMPONENTS) {
    const xs = rows
      .map((r) => r.signals?.components?.[c])
      .filter((v): v is number => typeof v === "number");
    components[c] = xs.length ? r1(mean(xs)) : null;
  }
  const weakest = COMPONENTS.filter((c) => components[c] != null).sort(
    (a, b) => (components[a] as number) - (components[b] as number)
  )[0];

  const bands = {
    healthy: rows.filter((r) => r.band === "healthy").length,
    monitor: rows.filter((r) => r.band === "monitor").length,
    atRisk: rows.filter((r) => r.band === "at_risk").length,
    critical: rows.filter((r) => r.band === "critical").length,
  };
  const atRiskRatio = count ? (bands.atRisk + bands.critical) / count : 0;
  const dormant = rows.filter((r) => r.signals?.dormant).length;
  const dormancyRate = count ? dormant / count : 0;

  // Pooled breadth: total contributors over total members, so a 200-member
  // cooperative counts for more than a 10-member one.
  let reg = 0, contrib = 0, attend = 0;
  for (const r of rows) {
    const d = r.signals?.engagementDetail;
    if (!d?.membersOnRegister) continue;
    reg += d.membersOnRegister;
    contrib += d.contributorsLastQuarter ?? 0;
    attend += d.attendeesLastQuarter ?? 0;
  }

  const qualities = rows
    .map((r) => r.signals?.evidenceQuality)
    .filter((v): v is number => typeof v === "number");
  const silence = rows.filter((r) => r.signals?.flaggedOnSilenceAlone).length;

  let expired = 0, expiring = 0, missing = 0;
  for (const r of rows) {
    const s = r.signals;
    if (!s) continue;
    if (!s.permitType) { missing++; continue; }
    if (!s.permitExpiresOn) continue;
    const days = (new Date(s.permitExpiresOn).getTime() - periodEnd.getTime()) / 86_400_000;
    if (days < 0) expired++;
    else if (days < PERMIT_WARNING_DAYS) expiring++;
  }

  const recommended = rows.filter((r) => r.visit_recommended).length;
  const open = rows.filter((r) => visits.get(r.cooperative_id) === "open").length;
  const completed = rows.filter((r) => visits.get(r.cooperative_id) === "completed").length;

  // Month-over-month, paired on the same cooperatives so a newly registered one
  // does not read as the sector improving or declining.
  const deltas: number[] = [];
  let improved = 0, deteriorated = 0;
  const newlyCritical: string[] = [];
  for (const r of rows) {
    const prev = previous.get(r.cooperative_id);
    if (!prev) continue;
    deltas.push(n(r.composite_score) - prev.composite);
    const move = BAND_RANK[r.band] - BAND_RANK[prev.band];
    if (move > 0) improved++;
    if (move < 0) deteriorated++;
    if (r.band === "critical" && prev.band !== "critical") newlyCritical.push(r.cooperative_name);
  }

  // Issues by code.
  const byCode = new Map<string, Rollup["issues"][number]>();
  let coded = false;
  for (const r of rows) {
    const issues = r.signals?.issues;
    if (!Array.isArray(issues)) continue;
    coded = true;
    const seen = new Set<string>();
    for (const i of issues) {
      if (seen.has(i.code)) continue;
      seen.add(i.code);
      const entry = byCode.get(i.code) ?? {
        code: i.code, title: i.title, component: i.component, severity: i.severity,
        cooperatives: 0, prevalence: 0, systemic: false, affected: [],
      };
      entry.cooperatives++;
      entry.affected.push(r.cooperative_name);
      if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[entry.severity]) entry.severity = i.severity;
      byCode.set(i.code, entry);
    }
  }
  const issues = [...byCode.values()]
    .map((e) => {
      const prevalence = count ? e.cooperatives / count : 0;
      return {
        ...e,
        prevalence: r3(prevalence),
        systemic: prevalence >= SYSTEMIC_PREVALENCE && e.cooperatives >= SYSTEMIC_MIN_COOPERATIVES,
      };
    })
    .sort(
      (a, b) =>
        Number(b.systemic) - Number(a.systemic) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.cooperatives - a.cooperatives
    );

  const outliers =
    count >= OUTLIER_MIN_GROUP && sd > 0
      ? rows
          .map((r, i) => ({
            cooperativeId: r.cooperative_id,
            name: r.cooperative_name,
            composite: composites[i],
            zScore: r3((composites[i] - m) / sd),
          }))
          .filter((o) => o.zScore <= OUTLIER_Z)
          .sort((a, b) => a.zScore - b.zScore)
      : [];

  const rating = riskRating(weightedMean, atRiskRatio, dormancyRate, bands.critical);
  const meanDelta = deltas.length ? r1(mean(deltas)) : null;

  // ── What to say about it ──────────────────────────────────────────────────
  const where = level === "sector" ? `${name} sector` : `the district`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const highlights: Highlight[] = [];

  if (atRiskRatio >= 0.3) {
    highlights.push({
      severity: atRiskRatio >= 0.5 ? "critical" : "major",
      text: `${bands.atRisk + bands.critical} of ${count} cooperatives in ${where} (${pct(atRiskRatio)}) are at risk or critical.`,
    });
  }
  if (dormant > 0) {
    highlights.push({
      severity: dormancyRate >= 0.3 ? "critical" : "major",
      text: `${dormant} cooperative(s) in ${where} are dormant — a dormancy rate of ${pct(dormancyRate)}.`,
    });
  }
  for (const i of issues.filter((x) => x.systemic).slice(0, 4)) {
    highlights.push({
      severity: i.severity,
      text:
        `Systemic ${i.code} (${i.title.toLowerCase()}): ${i.cooperatives} of ${count} cooperatives ` +
        `(${pct(i.prevalence)}). A shared cause is likelier than ${i.cooperatives} separate failures.`,
    });
  }
  if (weakest && components[weakest] != null && (components[weakest] as number) < 50) {
    highlights.push({
      severity: "major",
      text: `Weakest component is ${weakest.replace(/([A-Z])/g, " $1").toLowerCase()} at a mean of ${components[weakest]}/100.`,
    });
  }
  if (expired > 0) {
    highlights.push({ severity: "critical", text: `${expired} cooperative(s) are operating on an expired permit.` });
  }
  if (meanDelta != null && meanDelta <= -5) {
    highlights.push({
      severity: "major",
      text: `The composite fell by a mean of ${Math.abs(meanDelta)} points month-on-month across ${deltas.length} paired cooperatives; ${deteriorated} dropped a band.`,
    });
  }
  if (newlyCritical.length) {
    highlights.push({ severity: "critical", text: `Newly critical this month: ${newlyCritical.join(", ")}.` });
  }
  if (recommended > 0 && open + completed < recommended) {
    highlights.push({
      severity: "minor",
      text: `${recommended - open - completed} recommended visit(s) have not been raised or were cancelled.`,
    });
  }
  if (count && silence / count >= 0.3) {
    highlights.push({
      severity: "info",
      text: `${silence} of ${count} bands rest mainly on missing records (evidence quality ≤ 40%). Treat these as data gaps until visited.`,
    });
  }
  if (sd >= 20) {
    highlights.push({
      severity: "info",
      text: `Wide spread in ${where} (σ = ${r1(sd)}, IQR = ${r1(percentile(sorted, 0.75) - percentile(sorted, 0.25))}): the average hides both strong and failing cooperatives.`,
    });
  }
  if (!highlights.length) {
    highlights.push({ severity: "info", text: `No material issues in ${where} this period.` });
  }
  highlights.sort(bySeverity);

  return {
    level,
    name,
    cooperatives: count,
    members: totalMembers,
    composite: {
      mean: r1(m),
      memberWeightedMean: r1(weightedMean),
      median: r1(percentile(sorted, 0.5)),
      p25: r1(percentile(sorted, 0.25)),
      p75: r1(percentile(sorted, 0.75)),
      iqr: r1(percentile(sorted, 0.75) - percentile(sorted, 0.25)),
      stdDev: r1(sd),
      min: r1(sorted[0] ?? 0),
      max: r1(sorted[sorted.length - 1] ?? 0),
    },
    functionalityMean: r1(mean(rows.map((r) => n(r.functionality_score)))),
    engagementMean: r1(mean(rows.map((r) => n(r.engagement_score)))),
    components,
    weakestComponent: weakest ? { name: weakest, mean: components[weakest] as number } : null,
    bands,
    atRiskRatio: r3(atRiskRatio),
    dormancyRate: r3(dormancyRate),
    engagement: {
      contributionBreadth: reg ? r3(contrib / reg) : null,
      attendanceBreadth: reg ? r3(attend / reg) : null,
    },
    evidence: {
      meanQuality: qualities.length ? r3(mean(qualities)) : null,
      flaggedOnSilence: silence,
      silenceShare: count ? r3(silence / count) : 0,
    },
    permits: { expired, expiringSoon: expiring, missing },
    visits: {
      recommended,
      open,
      completed,
      coverage: recommended ? r3(Math.min(1, (open + completed) / recommended)) : null,
    },
    trend: { pairedCooperatives: deltas.length, meanDelta, improved, deteriorated, newlyCritical },
    issues,
    issuesCoded: coded,
    outliers,
    riskRating: rating,
    highlights,
  };
}

/**
 * Place each sector against the district: rank by member-weighted composite and
 * the gap to the district figure in points. Adds district-level highlights about
 * the sectors themselves.
 */
export function placeSectors(district: Rollup, sectors: Rollup[]): void {
  const ranked = [...sectors].sort(
    (a, b) => a.composite.memberWeightedMean - b.composite.memberWeightedMean
  );
  ranked.forEach((s, i) => {
    s.rank = i + 1; // 1 = weakest, the order an officer works through them
    s.deviationFromDistrict = r1(s.composite.memberWeightedMean - district.composite.memberWeightedMean);
  });

  const before = district.highlights.length;
  const severe = sectors.filter((s) => s.riskRating === "severe" || s.riskRating === "high");
  if (severe.length) {
    district.highlights.unshift({
      severity: "critical",
      text:
        `${severe.length} sector(s) rated high or severe risk: ` +
        severe.map((s) => `${s.name} (${s.composite.memberWeightedMean})`).join(", ") + ".",
    });
  }
  if (sectors.length >= 2) {
    const spread = ranked[ranked.length - 1].composite.memberWeightedMean - ranked[0].composite.memberWeightedMean;
    if (spread >= 20) {
      district.highlights.push({
        severity: "major",
        text:
          `A ${r1(spread)}-point gap separates the strongest sector (${ranked[ranked.length - 1].name}) ` +
          `from the weakest (${ranked[0].name}). Oversight capacity may be unevenly spread.`,
      });
    }
  }
  if (district.highlights.length > before) {
    district.highlights = district.highlights.filter((h) => !h.text.startsWith("No material issues"));
  }
  district.highlights.sort(bySeverity);
}
