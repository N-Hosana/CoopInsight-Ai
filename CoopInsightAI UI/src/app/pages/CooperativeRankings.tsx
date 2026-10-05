import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Download,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

/**
 * The three things a cooperative is ranked on.
 *
 * There were five. Two of them — `growth` and `scale` — were dropped: growth is
 * a financial question and now sits inside Finances, and scale measured how old
 * and how rich a cooperative already was rather than how it performed, which
 * flattered established cooperatives over new ones doing better work. Savings
 * per member is still shown as context; it no longer moves the rank.
 */
type DimensionKey = "finances" | "engagement" | "activities";

/** One of the measures that makes up a pillar, as the AI service declares it. */
interface PillarMeasure {
  key: string;
  label: string;
  weight: number;
  description: string;
  unit: string;
}

interface Standing {
  cooperativeId: string;
  name: string;
  sector: string;
  type: string;
  memberCount: number;
  rank: number;
  previousRank: number | null;
  rankChange: number | null;
  compositeScore: number;
  band: "leading" | "solid" | "needs_support" | "at_risk";
  scores: Record<DimensionKey, number | null>;
  /** Percentile per underlying measure, so a pillar score can be taken apart. */
  measureScores: Record<string, number>;
  unmeasured: string[];
  evidence: {
    income: number;
    expense: number;
    surplus: number;
    surplusPerMember: number;
    savingsGrowthPerMember: number | null;
    contributors: number;
    contributorShare: number;
    activitiesScheduled: number;
    activitiesCompleted: number;
    activitiesPer10Members: number | null;
    attendanceRate: number | null;
    completionRate: number | null;
    savingsPerMember: number;
  };
}

interface LeagueTable {
  period: string | null;
  previousPeriod: string | null;
  availablePeriods: string[];
  standings: Standing[];
  districtAverage: Record<DimensionKey, number>;
  districtAverageMeasures?: Record<string, number>;
  weights: Record<DimensionKey, number>;
  dimensions: Record<DimensionKey, string>;
  dimensionDescriptions: Record<DimensionKey, string>;
  pillarMeasures?: Record<DimensionKey, PillarMeasure[]>;
  note?: string;
  reachable?: boolean;
}

/**
 * Column order. Taken from the weights the service actually returned rather
 * than hardcoded, so adding or reweighting a pillar on the AI side cannot leave
 * this table showing a stale set of columns.
 */
const dimensionOrder = (table: LeagueTable | null): DimensionKey[] => {
  const fallback: DimensionKey[] = ["finances", "engagement", "activities"];
  if (!table?.weights) return fallback;
  const keys = Object.keys(table.weights) as DimensionKey[];
  return keys.length ? keys.sort((a, b) => table.weights[b] - table.weights[a]) : fallback;
};

const BAND_STYLES: Record<string, { label: string; chip: string; bar: string }> = {
  leading: { label: "Leading", chip: "bg-green-100 text-green-800", bar: "bg-green-600" },
  solid: { label: "Solid", chip: "bg-blue-100 text-blue-800", bar: "bg-blue-600" },
  needs_support: { label: "Needs support", chip: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  at_risk: { label: "At risk", chip: "bg-red-100 text-red-700", bar: "bg-red-600" },
};

const MEDAL = ["🥇", "🥈", "🥉"];

const formatPeriod = (p: string | null) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const money = (v: number) => `RWF ${Math.round(v).toLocaleString()}`;

function RankMovement({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="text-xs text-gray-400">new</span>;
  }
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Minus className="w-3 h-3" /> held
      </span>
    );
  }
  const up = change > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? "text-green-700" : "text-red-600"}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? `+${change}` : change}
    </span>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span title="Not measurable this month — excluded from the composite" className="text-gray-300">
        —
      </span>
    );
  }
  const tone =
    value >= 75 ? "text-green-700" : value >= 50 ? "text-blue-700" : value >= 30 ? "text-amber-700" : "text-red-600";
  return <span className={`font-medium ${tone}`}>{value.toFixed(0)}</span>;
}

/**
 * `embedded` is set when this is rendered as a tab of District Monitoring,
 * which owns the page heading. Without it the tab carries two titles.
 */
export function CooperativeRankings({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [table, setTable] = useState<LeagueTable | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async (target?: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: LeagueTable }>(
        `/ai/rankings${target ? `?period=${target}` : ""}`
      );
      setTable(res.data);
      if (res.data.period) setPeriod(res.data.period);
      if (res.data.reachable === false) {
        setError(res.data.note ?? "The AI service is unreachable, so the league table cannot be computed.");
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load the league table.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const podium = useMemo(() => (table?.standings ?? []).slice(0, 3), [table]);
  const dimensions = useMemo(() => dimensionOrder(table), [table]);

  const exportCsv = () => {
    if (!table) return;
    const header = [
      "Rank", "Cooperative", "Sector", "Type", "Members", "Composite",
      ...dimensions.map((d) => table.dimensions[d]),
      "Previous rank", "Band",
    ];
    const rows = table.standings.map((s) => [
      s.rank, s.name, s.sector, s.type, s.memberCount, s.compositeScore,
      ...dimensions.map((d) => (s.scores[d] === null ? "n/a" : s.scores[d])),
      s.previousRank ?? "n/a", BAND_STYLES[s.band]?.label ?? s.band,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `district-league-${table.period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !table) {
    return <p className="text-gray-500">Computing the district league table…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={embedded ? "sr-only" : undefined}>
          <h1 className="text-2xl font-semibold text-gray-900">District League Table</h1>
          <p className="text-gray-600 mt-1 max-w-3xl">
            How every cooperative in Gasabo compares this month, on three things: its{" "}
            <strong>finances</strong>, its <strong>member engagement</strong>, and the{" "}
            <strong>activities</strong> it actually delivered. Every score opens into the figures
            behind it, so a cooperative that disagrees with its position can be shown exactly why it
            sits there.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {table && table.availablePeriods.length > 0 && (
            <div className="w-52">
              <Select
                label="Month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  load(e.target.value);
                }}
                options={table.availablePeriods.map((p) => ({ value: p, label: formatPeriod(p) }))}
              />
            </div>
          )}
          <Button variant="outline" onClick={() => load(period)}>
            <span className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </span>
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export CSV
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {table && table.standings.length > 0 && (
        <>
          {/* Podium */}
          <div className="grid gap-4 sm:grid-cols-3">
            {podium.map((s, i) => (
              <Card key={s.cooperativeId} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl leading-none">{MEDAL[i]}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BAND_STYLES[s.band]?.chip}`}>
                        {BAND_STYLES[s.band]?.label}
                      </span>
                    </div>
                    <p className="font-semibold text-gray-900 mt-2 leading-snug">{s.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.sector} · {s.type} · {s.memberCount} members
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-semibold text-gray-900">{s.compositeScore.toFixed(0)}</p>
                    <RankMovement change={s.rankChange} />
                  </div>
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${BAND_STYLES[s.band]?.bar}`}
                    style={{ width: `${s.compositeScore}%` }}
                  />
                </div>
              </Card>
            ))}
          </div>

          {/* Full standings */}
          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Standings — {formatPeriod(table.period)}
                </h2>
                <p className="text-sm text-gray-500">
                  {table.standings.length} cooperatives
                  {table.previousPeriod && ` · movement against ${formatPeriod(table.previousPeriod)}`}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-medium text-gray-700">#</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Cooperative</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Overall</th>
                    {dimensions.map((d) => (
                      <th
                        key={d}
                        className="px-3 py-3 text-right font-medium text-gray-700 whitespace-nowrap"
                        title={`${table.dimensionDescriptions[d]} Weight ${Math.round(table.weights[d] * 100)}%.`}
                      >
                        {table.dimensions[d]}
                        <span className="ml-1 font-normal text-gray-400">
                          {Math.round(table.weights[d] * 100)}%
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Move</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {table.standings.map((s) => {
                    const open = expanded === s.cooperativeId;
                    return (
                      <>
                        <tr
                          key={s.cooperativeId}
                          className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpanded(open ? null : s.cooperativeId)}
                        >
                          <td className="px-4 py-3 font-semibold text-gray-900">{s.rank}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{s.name}</p>
                            <p className="text-xs text-gray-500">
                              {s.sector} · {s.memberCount} members
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${BAND_STYLES[s.band]?.chip}`}>
                              {s.compositeScore.toFixed(0)}
                            </span>
                          </td>
                          {dimensions.map((d) => (
                            <td key={d} className="px-3 py-3 text-right">
                              <ScoreCell value={s.scores[d]} />
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right">
                            <RankMovement change={s.rankChange} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ChevronRight
                              className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
                            />
                          </td>
                        </tr>

                        {open && (
                          <tr key={`${s.cooperativeId}-detail`} className="bg-gray-50 border-b border-gray-200">
                            <td colSpan={dimensions.length + 5} className="px-6 py-5">
                              <p className="text-sm font-medium text-gray-900 mb-3">
                                The figures behind this month's score
                              </p>

                              {/*
                                Each pillar, broken into the measures that made
                                it, with this cooperative's percentile on each.
                                A score nobody can take apart is a score nobody
                                can argue with, and a league table that cannot
                                be argued with will not be believed.
                              */}
                              {table.pillarMeasures && (
                                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                                  {dimensions.map((d) => (
                                    <div key={d} className="rounded-xl border border-gray-200 bg-white p-3">
                                      <div className="flex items-baseline justify-between gap-2">
                                        <p className="text-sm font-medium text-gray-900">
                                          {table.dimensions[d]}
                                        </p>
                                        <span className="text-sm font-semibold text-gray-900">
                                          {s.scores[d] === null ? "—" : s.scores[d]!.toFixed(0)}
                                        </span>
                                      </div>
                                      <ul className="mt-2 space-y-1">
                                        {(table.pillarMeasures?.[d] ?? []).map((m) => (
                                          <li
                                            key={m.key}
                                            className="flex items-baseline justify-between gap-2 text-xs"
                                            title={m.description}
                                          >
                                            <span className="text-gray-600">
                                              {m.label}
                                              <span className="text-gray-400">
                                                {" "}
                                                ({Math.round(m.weight * 100)}%)
                                              </span>
                                            </span>
                                            <span className="font-medium text-gray-900">
                                              {s.measureScores?.[m.key] != null
                                                ? s.measureScores[m.key].toFixed(0)
                                                : "—"}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                                <div>
                                  <p className="text-gray-500">Income / expenses</p>
                                  <p className="font-medium text-gray-900">
                                    {money(s.evidence.income)} / {money(s.evidence.expense)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Surplus per member</p>
                                  <p className={`font-medium ${s.evidence.surplusPerMember >= 0 ? "text-gray-900" : "text-red-600"}`}>
                                    {money(s.evidence.surplusPerMember)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Savings growth per member</p>
                                  <p className="font-medium text-gray-900">
                                    {s.evidence.savingsGrowthPerMember === null
                                      ? "No prior month to compare"
                                      : money(s.evidence.savingsGrowthPerMember)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Savings held per member</p>
                                  <p className="font-medium text-gray-900">{money(s.evidence.savingsPerMember)}</p>
                                  {/* Context only - this figure does not affect the rank. */}
                                  <p className="text-[11px] text-gray-400">Context; not scored</p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Members contributing</p>
                                  <p className="font-medium text-gray-900">
                                    {s.evidence.contributors} of {s.memberCount} ({s.evidence.contributorShare}%)
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Activities completed</p>
                                  <p className="font-medium text-gray-900">
                                    {s.evidence.activitiesCompleted} of {s.evidence.activitiesScheduled} scheduled
                                    {s.evidence.completionRate !== null && ` (${s.evidence.completionRate}%)`}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Activities per 10 members</p>
                                  <p className="font-medium text-gray-900">
                                    {s.evidence.activitiesPer10Members === null
                                      ? "Nothing recorded this month"
                                      : s.evidence.activitiesPer10Members.toFixed(1)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Attendance rate</p>
                                  <p className="font-medium text-gray-900">
                                    {s.evidence.attendanceRate === null ? "No activity held" : `${s.evidence.attendanceRate}%`}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-gray-500">Previous rank</p>
                                  <p className="font-medium text-gray-900">{s.previousRank ?? "—"}</p>
                                </div>
                              </div>

                              {s.unmeasured.length > 0 && (
                                <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                  Not measurable this month: {s.unmeasured.join(", ")}. Excluded from the
                                  composite rather than scored zero, so missing records do not count as poor
                                  performance.
                                </p>
                              )}

                              <div className="mt-4">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/cooperative-profile?id=${s.cooperativeId}`);
                                  }}
                                >
                                  Open cooperative profile
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* How it is scored */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-gray-700" />
              <h2 className="text-lg font-semibold text-gray-900">How the score is built</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4 max-w-3xl">
              Three pillars, each built from named measures. Every measure is a position within the
              month's field rather than a score against a fixed target, so a small cooperative is
              compared fairly with a large one. A measure that cannot be computed is left out of a
              cooperative's score instead of counted as a zero.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dimensions.map((d) => (
                <div key={d} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900 text-sm">{table.dimensions[d]}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                      {Math.round(table.weights[d] * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{table.dimensionDescriptions[d]}</p>
                  {table.pillarMeasures?.[d] && (
                    <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                      {table.pillarMeasures[d].map((m) => (
                        <li key={m.key} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-gray-800">{m.label}</span>
                            <span className="text-gray-500">{Math.round(m.weight * 100)}%</span>
                          </div>
                          <p className="text-gray-500">{m.description}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-gray-500 mt-3">
                    District average score:{" "}
                    <span className="font-medium">
                      {Math.round(table.districtAverage[d] ?? 0).toLocaleString()}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <strong>Deliberately not scored:</strong> accumulated savings and share capital per
              member. It measures how long a cooperative has existed and how much it has banked, not
              how it is performing now, and scoring it simply ranked the oldest cooperatives highest.
              It is still shown in the figures behind each row, as context.
            </p>
            {table.note && (
              <p className="mt-4 text-xs text-gray-600 border-t border-gray-200 pt-3">{table.note}</p>
            )}
          </Card>
        </>
      )}

      {table && table.standings.length === 0 && !error && (
        <Card className="p-10 text-center">
          <Trophy className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No month can be scored yet</p>
          <p className="text-sm text-gray-500 mt-1">{table.note}</p>
        </Card>
      )}
    </div>
  );
}
