import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { downloadPdf } from "../services/pdf";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { MoreInfo } from "../components/MoreInfo";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
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

// The app's own palette: forest green for good standing, gold for "needs
// support". Red is kept for the one band that needs someone to act.
const BAND_STYLES: Record<string, { label: string; chip: string; bar: string }> = {
  leading: { label: "Leading", chip: "bg-[#2D6A4F] text-white", bar: "bg-[#2D6A4F]" },
  solid: { label: "Solid", chip: "bg-[#2D6A4F]/10 text-[#1B4332]", bar: "bg-[#2D6A4F]/60" },
  needs_support: { label: "Needs support", chip: "bg-[#D4A574]/25 text-[#7A5530]", bar: "bg-[#D4A574]" },
  at_risk: { label: "At risk", chip: "bg-red-50 text-red-700 ring-1 ring-red-200", bar: "bg-red-600" },
};

/** RWF 1.2M / RWF 350K — a column of figures should be scannable. */
const short = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1_000 ? `${Math.round(a / 1_000)}K` : `${Math.round(a)}`;
  return `${v < 0 ? "−" : ""}RWF ${s}`;
};

/**
 * What a cooperative actually did in each category this month — the figure a
 * treasurer or officer recognises — with the comparative score beneath it.
 */
function Figure({ d, s }: { d: DimensionKey; s: Standing }) {
  const e = s.evidence;
  const score = s.scores[d];
  let main: string;
  let muted = false;
  if (d === "finances") {
    main = e.income || e.expense ? `${e.surplus >= 0 ? "+" : ""}${short(e.surplus)}` : "No entries";
    muted = !e.income && !e.expense;
  } else if (d === "engagement") {
    main = `${e.contributorShare}% paying`;
  } else {
    main = e.activitiesScheduled ? `${e.activitiesCompleted} of ${e.activitiesScheduled} held` : "None planned";
    muted = !e.activitiesScheduled;
  }
  return (
    <div className="text-right">
      <p className={`font-medium tabular-nums ${muted ? "text-gray-400" : "text-gray-900"}`}>{main}</p>
      <p className="text-[11px] tabular-nums text-gray-400">{score === null ? "not scored" : `score ${score.toFixed(0)}`}</p>
    </div>
  );
}

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
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? "text-[#2D6A4F]" : "text-[#9A6B3A]"}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? `+${change}` : change}
    </span>
  );
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

  /** The league table as a PDF. */
  const exportCsv = () => {
    if (!table) return;
    downloadPdf({
      title: "District League Table",
      subtitle: `Period ${table.period}`,
      narrative: [
        "Cooperatives are ranked on a composite of the dimensions shown, each scored as a percentile within the district. " +
          "A dimension with no data is left out of a cooperative's composite rather than counted as zero, and shows as n/a.",
      ],
      summary: [
        { label: "Cooperatives ranked", value: String(table.standings.length) },
        { label: "Top of the table", value: table.standings[0]?.name ?? "-" },
      ],
      sections: [
        {
          title: "Standings",
          columns: ["Rank", "Cooperative", "Sector", "Members", "Composite", ...dimensions.map((d) => table.dimensions[d]), "Previous rank", "Band"],
          rows: table.standings.map((s) => [
            s.rank, s.name, s.sector, s.memberCount, s.compositeScore,
            ...dimensions.map((d) => (s.scores[d] === null ? "n/a" : s.scores[d])),
            s.previousRank ?? "n/a", BAND_STYLES[s.band]?.label ?? s.band,
          ]),
        },
      ],
      signatories: ["Prepared by", "Reviewed by"],
    }).catch((err: any) => alert(err?.message ?? "The PDF could not be produced."));
  };

  if (loading && !table) {
    return <p className="text-gray-500">Computing the district league table…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={embedded ? "sr-only" : undefined}>
          <h1 className="text-2xl font-semibold text-gray-900">District League Table</h1>
          <p className="text-gray-600 mt-1">How Gasabo's cooperatives compare this month. Open a row for its figures.</p>
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
              Download PDF
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
                              <Figure d={d} s={s} />
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
                                <p className="mt-4 text-xs text-gray-500">
                                  Not scored this month: {s.unmeasured.join(", ")}.
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

          {/* How it is scored — folded, at the foot of the page. */}
          <MoreInfo title="How scores work">
            <ul className="grid gap-2 sm:grid-cols-3">
              {dimensions.map((d) => (
                <li key={d} className="rounded-lg border border-gray-100 bg-white p-3">
                  <p className="flex justify-between text-sm font-medium text-gray-900">
                    {table.dimensions[d]} <span className="text-gray-500">{Math.round(table.weights[d] * 100)}%</span>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                    {(table.pillarMeasures?.[d] ?? []).map((m) => (
                      <li key={m.key} className="flex justify-between gap-2" title={m.description}>
                        <span>{m.label}</span>
                        <span>{Math.round(m.weight * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="text-xs">
              Scores compare each cooperative with the others this month (0–100). Missing data is left out, not scored
              zero. Savings held per member is shown for context but not scored.
            </p>
          </MoreInfo>
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
