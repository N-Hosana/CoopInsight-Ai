import { Fragment, useEffect, useState } from "react";
import { api } from "../services/api";
import { Card } from "./Card";
import { AlertTriangle, AlertOctagon, Info, ChevronDown, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";

/**
 * The monthly audit rolled up to sector and district level.
 *
 * The cooperative standings answer "which cooperative is failing". This answers
 * the questions a sector officer and the district office are accountable for:
 * how is the sector doing as a whole, how does it sit against the district, and
 * which failures recur across cooperatives — because a finding carried by half
 * the sector has a sector-level cause, and visiting each cooperative in turn
 * will not fix it.
 */

type Severity = "critical" | "major" | "minor" | "info";
type RiskRating = "stable" | "elevated" | "high" | "severe";

interface RollupIssue {
  code: string;
  title: string;
  component: string;
  severity: Exclude<Severity, "info">;
  cooperatives: number;
  prevalence: number;
  systemic: boolean;
  affected: string[];
}

interface Rollup {
  level: "district" | "sector";
  name: string;
  cooperatives: number;
  members: number;
  composite: {
    mean: number; memberWeightedMean: number; median: number; p25: number; p75: number;
    iqr: number; stdDev: number; min: number; max: number;
  };
  functionalityMean: number;
  engagementMean: number;
  components: Record<string, number | null>;
  weakestComponent: { name: string; mean: number } | null;
  bands: { healthy: number; monitor: number; atRisk: number; critical: number };
  atRiskRatio: number;
  dormancyRate: number;
  engagement: { contributionBreadth: number | null; attendanceBreadth: number | null };
  evidence: { meanQuality: number | null; flaggedOnSilence: number; silenceShare: number };
  permits: { expired: number; expiringSoon: number; missing: number };
  visits: { recommended: number; open: number; completed: number; coverage: number | null };
  trend: { pairedCooperatives: number; meanDelta: number | null; improved: number; deteriorated: number; newlyCritical: string[] };
  issues: RollupIssue[];
  issuesCoded: boolean;
  outliers: Array<{ cooperativeId: string; name: string; composite: number; zScore: number }>;
  riskRating: RiskRating;
  highlights: Array<{ severity: Severity; text: string }>;
  rank?: number;
  deviationFromDistrict?: number;
}

interface RollupResponse {
  period: string;
  previousPeriod: string | null;
  viewer: { level: string; sector: string | null };
  district: Rollup;
  sectors: Rollup[];
  runs: Array<{
    scope: "district" | "sector"; sector: string | null; run_by_level: string | null;
    run_by_name: string | null; cooperatives_assessed: number; visits_raised: number; created_at: string;
  }>;
  method: { systemicPrevalence: number; systemicMinCooperatives: number; outlierZ: number; riskRating: string };
}

const RISK_STYLES: Record<RiskRating, string> = {
  stable: "bg-green-100 text-green-800",
  elevated: "bg-blue-100 text-blue-800",
  high: "bg-amber-100 text-amber-800",
  severe: "bg-red-100 text-red-700",
};

const SEVERITY_STYLES: Record<Severity, { row: string; badge: string; Icon: typeof Info }> = {
  critical: { row: "border-red-200 bg-red-50 text-red-900", badge: "bg-red-100 text-red-700", Icon: AlertOctagon },
  major: { row: "border-amber-200 bg-amber-50 text-amber-900", badge: "bg-amber-100 text-amber-800", Icon: AlertTriangle },
  minor: { row: "border-gray-200 bg-gray-50 text-gray-800", badge: "bg-gray-100 text-gray-700", Icon: Info },
  info: { row: "border-blue-100 bg-blue-50 text-blue-900", badge: "bg-blue-100 text-blue-800", Icon: Info },
};

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const label = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();
const signed = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}`);

function RiskBadge({ rating }: { rating: RiskRating }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${RISK_STYLES[rating]}`}>
      {rating}
    </span>
  );
}

function Metric({ name, value, sub }: { name: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{name}</p>
      <p className="text-lg font-semibold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 tabular-nums">{sub}</p>}
    </div>
  );
}

function Highlights({ items }: { items: Rollup["highlights"] }) {
  return (
    <ul className="space-y-2">
      {items.map((h, i) => {
        const s = SEVERITY_STYLES[h.severity];
        return (
          <li key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${s.row}`}>
            <s.Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{h.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ComponentBars({ r, benchmark }: { r: Rollup; benchmark?: Rollup }) {
  return (
    <div className="space-y-2">
      {Object.entries(r.components).map(([k, v]) => {
        const b = benchmark?.components[k];
        return (
          <div key={k}>
            <div className="flex justify-between text-xs text-gray-600">
              <span className="capitalize">{label(k)}</span>
              <span className="tabular-nums">
                {v ?? "—"}
                {b != null && v != null && (
                  <span className={v < b ? "text-red-600" : "text-gray-400"}> ({signed(Math.round((v - b) * 10) / 10)} vs district)</span>
                )}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-gray-200">
              <div
                className={`h-2 rounded-full ${v != null && v < 50 ? "bg-amber-500" : "bg-[#2D6A4F]"}`}
                style={{ width: `${Math.min(100, v ?? 0)}%` }}
              />
              {b != null && (
                <div className="absolute top-[-3px] h-3.5 w-0.5 bg-gray-700" style={{ left: `${Math.min(100, b)}%` }} title="District mean" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssueTable({ issues, total, showAffected }: { issues: RollupIssue[]; total: number; showAffected: boolean }) {
  if (!issues.length) return <p className="text-sm text-gray-500">No coded findings.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-3">Code</th>
            <th className="py-2 pr-3">Finding</th>
            <th className="py-2 pr-3">Component</th>
            <th className="py-2 pr-3">Severity</th>
            <th className="py-2 pr-3 text-right">Affected</th>
            <th className="py-2 pr-3 text-right">Prevalence</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.code} className={`border-b border-gray-100 align-top ${i.systemic ? "bg-red-50/60" : ""}`}>
              <td className="py-2 pr-3 font-mono text-xs text-gray-900">{i.code}</td>
              <td className="py-2 pr-3 text-gray-900">
                {i.title}
                {i.systemic && (
                  <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Systemic</span>
                )}
                {showAffected && i.affected.length > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">{i.affected.join(", ")}</p>
                )}
              </td>
              <td className="py-2 pr-3 capitalize text-gray-600">{label(i.component)}</td>
              <td className="py-2 pr-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[i.severity].badge}`}>{i.severity}</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{i.cooperatives}/{total}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{pct(i.prevalence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The full technical profile of one sector, or of the district. */
function RollupDetail({ r, benchmark, showNames }: { r: Rollup; benchmark?: Rollup; showNames: boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          name="Composite (member-wtd)"
          value={r.composite.memberWeightedMean}
          sub={`unweighted μ ${r.composite.mean}`}
        />
        <Metric name="Median [IQR]" value={r.composite.median} sub={`${r.composite.p25}–${r.composite.p75} (${r.composite.iqr})`} />
        <Metric name="Std dev σ" value={r.composite.stdDev} sub={`range ${r.composite.min}–${r.composite.max}`} />
        <Metric name="At risk + critical" value={pct(r.atRiskRatio)} sub={`${r.bands.atRisk + r.bands.critical} of ${r.cooperatives}`} />
        <Metric name="Dormancy rate" value={pct(r.dormancyRate)} />
        <Metric
          name="MoM Δ composite"
          value={signed(r.trend.meanDelta)}
          sub={r.trend.pairedCooperatives ? `${r.trend.pairedCooperatives} paired · ↑${r.trend.improved} ↓${r.trend.deteriorated} bands` : "no prior month"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
            Functionality components (0–100){benchmark && " · marker = district mean"}
          </p>
          <ComponentBars r={r} benchmark={benchmark} />
          <p className="mt-3 text-xs text-gray-600">
            Functionality μ {r.functionalityMean} · Engagement μ {r.engagementMean}
            {r.weakestComponent && <> · weakest: <strong className="capitalize">{label(r.weakestComponent.name)}</strong></>}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 content-start">
          <Metric name="Contribution breadth" value={pct(r.engagement.contributionBreadth)} sub="pooled, last quarter" />
          <Metric name="Attendance breadth" value={pct(r.engagement.attendanceBreadth)} sub="pooled, last quarter" />
          <Metric
            name="Permits"
            value={r.permits.expired + r.permits.missing}
            sub={`${r.permits.expired} expired · ${r.permits.missing} none · ${r.permits.expiringSoon} <60d`}
          />
          <Metric
            name="Visit coverage"
            value={pct(r.visits.coverage)}
            sub={`${r.visits.open} open · ${r.visits.completed} done / ${r.visits.recommended} rec.`}
          />
          <Metric
            name="Evidence quality"
            value={pct(r.evidence.meanQuality)}
            sub={`${r.evidence.flaggedOnSilence} flagged on silence`}
          />
          <Metric
            name="Bands H / M / R / C"
            value={`${r.bands.healthy}/${r.bands.monitor}/${r.bands.atRisk}/${r.bands.critical}`}
            sub={`${r.cooperatives} coops · ${r.members} members`}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Issue register</p>
        {r.issuesCoded ? (
          <IssueTable issues={r.issues} total={r.cooperatives} showAffected={showNames} />
        ) : (
          <p className="text-sm text-gray-500">
            This month was audited before findings were coded. Re-run the audit for this period to
            populate the issue register.
          </p>
        )}
      </div>

      {showNames && r.outliers.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Statistical outliers (z ≤ −1.5 against peers)</p>
          <div className="flex flex-wrap gap-2">
            {r.outliers.map((o) => (
              <span key={o.cooperativeId} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-900">
                {o.name} · {o.composite} · z = {o.zScore}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function AuditRollup({ period }: { period: string }) {
  const [data, setData] = useState<RollupResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get<{ data: RollupResponse | null }>(`/audits/monthly/rollup${period ? `?period=${period}` : ""}`)
      .then((res) => {
        setData(res.data);
        // A sector officer has one sector; open it.
        if (res.data?.viewer.sector && res.data.sectors[0]) setOpen(res.data.sectors[0].name);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the sector and district roll-up."))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <p className="text-gray-500">Computing sector and district results…</p>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-gray-500">No audit has been run yet.</p>;

  const sectorView = !!data.viewer.sector;
  const { district } = data;

  return (
    <div className="space-y-6">
      {/* District */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              District level{sectorView && " · benchmark"}
            </p>
            <h3 className="text-lg font-semibold text-gray-900">{district.name}</h3>
            <p className="text-sm text-gray-500">
              {district.cooperatives} cooperatives · {district.members} members ·{" "}
              {data.sectors.length === 1 && sectorView ? "" : `${data.sectors.length} sectors · `}
              {data.previousPeriod ? `compared with ${data.previousPeriod}` : "no earlier month to compare"}
            </p>
          </div>
          <RiskBadge rating={district.riskRating} />
        </div>
        <div className="mt-4">
          <Highlights items={district.highlights} />
        </div>
        <div className="mt-5">
          <RollupDetail r={district} showNames={!sectorView} />
        </div>
      </Card>

      {/* Sectors */}
      <Card className="p-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">Sector level</p>
        <h3 className="text-lg font-semibold text-gray-900">
          {sectorView ? `${data.viewer.sector} sector` : "Sectors, weakest first"}
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-2" />
                <th className="py-2 pr-3">Rank</th>
                <th className="py-2 pr-3">Sector</th>
                <th className="py-2 pr-3 text-right">Coops</th>
                <th className="py-2 pr-3 text-right">Wtd μ</th>
                <th className="py-2 pr-3 text-right">Δ district</th>
                <th className="py-2 pr-3 text-right">σ</th>
                <th className="py-2 pr-3 text-right">At risk</th>
                <th className="py-2 pr-3 text-right">Dormant</th>
                <th className="py-2 pr-3 text-right">MoM Δ</th>
                <th className="py-2 pr-3">Weakest</th>
                <th className="py-2 pr-3 text-right">Systemic</th>
                <th className="py-2 pr-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {[...data.sectors]
                .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                .map((s) => {
                  const isOpen = open === s.name;
                  const systemic = s.issues.filter((i) => i.systemic).length;
                  return (
                    <Fragment key={s.name}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : s.name)}
                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="py-2 pr-2 text-gray-400">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-gray-500">{s.rank}</td>
                        <td className="py-2 pr-3 font-medium text-gray-900">{s.name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.cooperatives}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold">{s.composite.memberWeightedMean}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${(s.deviationFromDistrict ?? 0) < 0 ? "text-red-600" : "text-green-700"}`}>
                          {signed(s.deviationFromDistrict)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.composite.stdDev}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pct(s.atRiskRatio)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pct(s.dormancyRate)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {s.trend.meanDelta != null && s.trend.meanDelta < 0 && <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                            {s.trend.meanDelta != null && s.trend.meanDelta > 0 && <TrendingUp className="h-3.5 w-3.5 text-green-700" />}
                            {signed(s.trend.meanDelta)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 capitalize text-gray-600">
                          {s.weakestComponent ? `${label(s.weakestComponent.name)} (${s.weakestComponent.mean})` : "—"}
                        </td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${systemic ? "font-semibold text-red-700" : ""}`}>{systemic}</td>
                        <td className="py-2 pr-3"><RiskBadge rating={s.riskRating} /></td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={13} className="bg-gray-50/60 px-4 py-5">
                            <div className="space-y-5">
                              <Highlights items={s.highlights} />
                              <RollupDetail r={s} benchmark={district} showNames />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Runs and method */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-gray-900">Audit runs for {data.period}</h3>
        {data.runs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No runs recorded for this period (it predates the run log).</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {data.runs.map((r, i) => (
              <li key={i}>
                {new Date(r.created_at).toLocaleString()} — {r.scope === "sector" ? `${r.sector} sector` : "whole district"}, run
                at <strong>{r.run_by_level ?? "—"}</strong> level by {r.run_by_name ?? "unknown"} ·{" "}
                {r.cooperatives_assessed} assessed · {r.visits_raised} visits raised
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 border-t border-gray-200 pt-3 text-xs text-gray-500">
          Method: composite = 0.6 × functionality + 0.4 × engagement, per cooperative. Sector and
          district figures are member-weighted means; breadth is pooled (Σ contributors ÷ Σ members).
          A finding is <strong>systemic</strong> when ≥ {Math.round(data.method.systemicPrevalence * 100)}% of
          the group and ≥ {data.method.systemicMinCooperatives} cooperatives carry it. Outliers are
          z ≤ {data.method.outlierZ} against the group (n ≥ 4). MoM Δ is paired on cooperatives audited in
          both months. Risk rating — {data.method.riskRating}.
        </p>
      </Card>
    </div>
  );
}
