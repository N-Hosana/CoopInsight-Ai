import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../services/api";
import { downloadPdf } from "../services/pdf";
import { Card } from "./Card";
import { Button } from "./Button";
import { AiAudit } from "./AiAudit";
import { MemberEngagement } from "./MemberEngagement";
import { AlertOctagon, AlertTriangle, Brain, CheckCircle2, Download, Info, TrendingDown, TrendingUp, X } from "lucide-react";

/**
 * Insights for those who supervise cooperatives: a sector officer sees their
 * sector, the district office sees the district sector by sector, and the RCA
 * and administrators see everything. The page answers, in order: how are the
 * cooperatives doing as a group, what problems do they share, where is it
 * worst, and which cooperatives need attention first. Choosing a cooperative
 * opens its own findings and its members' engagement.
 */

type Level = "good" | "watch" | "problem";
type Severity = "critical" | "major" | "minor";
type Band = "healthy" | "monitor" | "at_risk" | "critical";

interface Group {
  name: string;
  cooperatives: number;
  assessed: number;
  members: number;
  averageScore: number | null;
  level: Level;
  atRisk: number;
  topProblem: { title: string; cooperatives: number } | null;
}

interface CooperativeRow {
  id: string;
  name: string;
  sector: string | null;
  district: string | null;
  members: number;
  score: number | null;
  band: Band | null;
  change: number | null;
  period: string | null;
  findings: number;
  urgent: number;
  mainProblem: string | null;
}

interface Brief {
  scope: {
    level: "sector" | "district" | "overall";
    name: string;
    sector: string | null;
    district: string | null;
    districts: string[];
    sectors: Array<{ district: string; sector: string }>;
  };
  headline: {
    sentence: string;
    averageScore: number | null;
    level: Level;
    change: number | null;
    latestPeriod: string | null;
    cooperatives: number;
    assessed: number;
  };
  standing: { healthy: number; monitor: number; atRisk: number; critical: number; notAssessed: number };
  areas: Array<{ key: string; label: string; about: string; score: number | null; level: Level; sentence: string }>;
  commonProblems: Array<{
    code: string;
    severity: Severity;
    title: string;
    why: string;
    action: string;
    cooperatives: number;
    share: number;
    widespread: boolean;
    affected: Array<{ id: string; name: string }>;
  }>;
  cooperatives: CooperativeRow[];
  groups: { districts: Group[]; sectors: Group[] };
  numbers: {
    members: number;
    savings: number;
    incomeLast3Months: number;
    expenseLast3Months: number;
    cooperativesRecordingTransactions: number;
    payingShare: number | null;
    attendanceShare: number | null;
  };
  alerts: {
    open: number;
    latest: Array<{ id: string; type: string; severity: string | null; title: string; summary: string; generated_at: string; cooperative_name: string }>;
  };
  method: string;
}

interface CooperativeBrief {
  cooperative: { id: string; name: string; sector: string };
  headline: { sentence: string; score: number | null; band: string | null; comparison: string | null };
  areas: Array<{ key: string; label: string; score: number | null; level: Level; sentence: string }>;
  priorities: Array<{ code: string; severity: Severity; title: string; why: string; action: string }>;
  strengths: string[];
}

const LEVEL: Record<Level, { label: string; bar: string; badge: string }> = {
  good: { label: "Good", bar: "bg-[#2D6A4F]", badge: "bg-[#2D6A4F]/10 text-[#1B4332]" },
  watch: { label: "Watch", bar: "bg-[#D4A574]", badge: "bg-[#D4A574]/15 text-[#8A6233]" },
  problem: { label: "Problem", bar: "bg-red-600", badge: "bg-red-100 text-red-700" },
};

const SEVERITY: Record<Severity, { label: string; box: string; Icon: typeof Info; icon: string }> = {
  critical: { label: "Urgent", box: "border-red-200 bg-red-50", Icon: AlertOctagon, icon: "text-red-600" },
  major: { label: "Important", box: "border-[#D4A574]/40 bg-[#D4A574]/15", Icon: AlertTriangle, icon: "text-[#8A6233]" },
  minor: { label: "Minor", box: "border-gray-200 bg-gray-50", Icon: Info, icon: "text-gray-500" },
};

const BAND: Record<Band, { label: string; badge: string; bar: string }> = {
  healthy: { label: "Healthy", badge: "bg-[#2D6A4F]/10 text-[#1B4332]", bar: "bg-[#2D6A4F]" },
  monitor: { label: "Worth watching", badge: "bg-[#D4A574]/15 text-[#8A6233]", bar: "bg-[#D4A574]" },
  at_risk: { label: "At risk", badge: "bg-[#D4A574]/25 text-[#7A5530]", bar: "bg-[#B8865A]" },
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", bar: "bg-red-600" },
};

const rwf = (v: number) => `${Math.round(v).toLocaleString()} RWF`;
const monthLabel = (ym: string | null) =>
  ym ? new Date(`${ym}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400">–</span>;
  if (value === 0) return <span className="text-gray-500">0</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${value > 0 ? "text-[#2D6A4F]" : "text-red-600"}`}>
      {value > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {value > 0 ? "+" : ""}{value}
    </span>
  );
}

function GroupTable({ title, heading, groups, onChoose }: { title: string; heading: string; groups: Group[]; onChoose: (name: string) => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
              <th className="px-4 py-2.5 font-medium">{heading}</th>
              <th className="px-4 py-2.5 font-medium">Cooperatives</th>
              <th className="px-4 py-2.5 font-medium">Members</th>
              <th className="px-4 py-2.5 font-medium">Average score</th>
              <th className="px-4 py-2.5 font-medium">At risk or critical</th>
              <th className="px-4 py-2.5 font-medium">Most common problem</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name} onClick={() => onChoose(g.name)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-[#2D6A4F]">{g.name}</td>
                <td className="px-4 py-2.5 tabular-nums">{g.cooperatives}</td>
                <td className="px-4 py-2.5 tabular-nums">{g.members.toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  {g.averageScore != null ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL[g.level].badge}`}>{g.averageScore} · {LEVEL[g.level].label}</span>
                  ) : (
                    <span className="text-gray-400">Not assessed</span>
                  )}
                </td>
                <td className={`px-4 py-2.5 tabular-nums ${g.atRisk ? "font-semibold text-red-600" : "text-gray-700"}`}>{g.atRisk}</td>
                <td className="px-4 py-2.5 text-gray-700">
                  {g.topProblem ? `${g.topProblem.title} (${g.topProblem.cooperatives})` : "None found"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** One cooperative, opened from the list: its findings and its members' engagement. */
function CooperativePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [brief, setBrief] = useState<CooperativeBrief | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setBrief(null);
    setError("");
    api
      .get<{ data: CooperativeBrief }>(`/ai/cooperative-brief?cooperativeId=${id}`)
      .then((res) => setBrief(res.data))
      .catch((err: any) => setError(err?.message ?? "This cooperative's insights could not be loaded."));
  }, [id]);

  return (
    <Card className="space-y-5 border-2 border-[#2D6A4F]/30 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cooperative</p>
          <h2 className="text-lg font-semibold text-gray-900">{brief?.cooperative.name ?? "Loading…"}</h2>
          {brief && <p className="text-sm text-gray-600">{brief.cooperative.sector} sector</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/cooperative-profile?id=${id}`)}>Open profile</Button>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {brief && (
        <>
          <div>
            <p className="font-medium text-gray-900">{brief.headline.sentence}</p>
            {brief.headline.comparison && <p className="mt-1 text-sm text-gray-600">{brief.headline.comparison}</p>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {brief.areas.map((a) => (
              <div key={a.key} className="rounded-lg border border-gray-200 p-3" title={a.sentence}>
                <p className="text-xs text-gray-600">{a.label}</p>
                <p className="mt-1 flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-gray-900">{a.score ?? "–"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL[a.level].badge}`}>{LEVEL[a.level].label}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">
              {brief.priorities.length ? "What this cooperative needs to put right" : "Nothing needs putting right"}
            </h3>
            {brief.priorities.map((p, i) => {
              const s = SEVERITY[p.severity];
              return (
                <div key={`${p.code}-${i}`} className={`flex items-start gap-3 rounded-lg border p-3 ${s.box}`}>
                  <s.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} />
                  <div className="text-sm">
                    <p className="font-semibold text-gray-900">{p.title} <span className="font-normal text-gray-500">· {s.label}</span></p>
                    <p className="text-gray-700">{p.why}</p>
                    <p className="text-gray-900"><span className="font-medium">What it should do:</span> {p.action}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">Member engagement</h3>
            <MemberEngagement cooperativeId={id} />
          </div>
        </>
      )}
    </Card>
  );
}

export function OversightInsights() {
  const [params] = useSearchParams();
  const [view, setView] = useState<"overview" | "audit">(params.get("view") === "audit" ? "audit" : "overview");
  const navigate = useNavigate();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [district, setDistrict] = useState("");
  const [sector, setSector] = useState("");
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (district) params.set("district", district);
    if (sector) params.set("sector", sector);
    const qs = params.toString();
    api
      .get<{ data: Brief }>(`/ai/oversight-brief${qs ? `?${qs}` : ""}`)
      .then((res) => setBrief(res.data))
      .catch((err: any) => setError(err?.message ?? "The insights could not be loaded."))
      .finally(() => setLoading(false));
  }, [district, sector]);

  const choose = (id: string) => {
    setSelected(id);
    // The panel sits above the list; bring it into view.
    setTimeout(() => document.getElementById("cooperative-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const exportPdf = () => {
    if (!brief) return;
    const s = brief.standing;
    downloadPdf({
      title: "Cooperative Insights",
      subtitle: `${brief.scope.name.charAt(0).toUpperCase()}${brief.scope.name.slice(1)}` +
        (brief.headline.latestPeriod ? `, audits up to ${monthLabel(brief.headline.latestPeriod)}` : ""),
      narrative: [brief.headline.sentence],
      summary: [
        { label: "Cooperatives", value: String(brief.headline.cooperatives) },
        { label: "Average score", value: brief.headline.averageScore != null ? `${brief.headline.averageScore} / 100` : "Not assessed" },
        { label: "At risk or critical", value: String(s.atRisk + s.critical) },
        { label: "Members", value: brief.numbers.members.toLocaleString() },
      ],
      sections: [
        {
          title: "Standing",
          columns: ["Healthy", "Worth watching", "At risk", "Critical", "Not assessed"],
          rows: [[s.healthy, s.monitor, s.atRisk, s.critical, s.notAssessed]],
        },
        {
          title: "Problems shared between cooperatives",
          columns: ["Problem", "Cooperatives", "Share", "Which"],
          rows: brief.commonProblems.map((p) => [
            p.title + (p.widespread ? " (widespread)" : ""),
            p.cooperatives,
            `${p.share}%`,
            p.affected.map((a) => a.name).join("; "),
          ]),
        },
        {
          title: "Area by area",
          columns: ["Area", "Average score", "Rating", "Detail"],
          rows: brief.areas.map((a) => [a.label, a.score ?? "-", LEVEL[a.level].label, a.sentence]),
        },
        ...(brief.groups.districts.length
          ? [{
              title: "By district",
              columns: ["District", "Cooperatives", "Members", "Average score", "At risk or critical"],
              rows: brief.groups.districts.map((g) => [g.name, g.cooperatives, g.members, g.averageScore ?? "-", g.atRisk]),
            }]
          : []),
        ...(brief.groups.sectors.length
          ? [{
              title: "By sector",
              columns: ["Sector", "Cooperatives", "Members", "Average score", "At risk or critical"],
              rows: brief.groups.sectors.map((g) => [g.name, g.cooperatives, g.members, g.averageScore ?? "-", g.atRisk]),
            }]
          : []),
        {
          title: "Cooperatives, most in need first",
          columns: ["Cooperative", "Sector", "Score", "Rating", "To put right", "Main problem"],
          rows: brief.cooperatives.map((c) => [
            c.name, c.sector ?? "", c.score ?? "-", c.band ? BAND[c.band].label : "Not assessed", c.findings, c.mainProblem ?? "",
          ]),
        },
      ],
    }).catch((err: any) => alert(err?.message ?? "The PDF could not be produced."));
  };

  const scope = brief?.scope;
  const sectorChoices = (scope?.sectors ?? []).filter((x) => !district || x.district === district);
  const standing = brief?.standing;
  const standingParts = standing
    ? ([
        ["Healthy", standing.healthy, BAND.healthy.bar],
        ["Worth watching", standing.monitor, BAND.monitor.bar],
        ["At risk", standing.atRisk, BAND.at_risk.bar],
        ["Critical", standing.critical, BAND.critical.bar],
        ["Not assessed", standing.notAssessed, "bg-gray-300"],
      ] as Array<[string, number, string]>)
    : [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Brain className="h-8 w-8 text-[#2D6A4F]" />
            Insights
          </h1>
          <p className="mt-1 text-gray-600">
            {view === "audit"
              ? "Audit any cooperative, or a whole sector, for any month."
              : `How the cooperatives in ${scope?.name ?? "your area"} are doing, and which need attention first.`}
          </p>
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${view === "audit" ? "hidden" : ""}`}>
          {scope && scope.districts.length > 0 && (
            <select
              value={district}
              onChange={(e) => { setDistrict(e.target.value); setSector(""); setSelected(null); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              aria-label="District"
            >
              <option value="">All districts</option>
              {scope.districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {scope && scope.level !== "sector" && (
            <select
              value={sector}
              onChange={(e) => { setSector(e.target.value); setSelected(null); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              aria-label="Sector"
            >
              <option value="">All sectors</option>
              {sectorChoices.map((x) => <option key={`${x.district}-${x.sector}`} value={x.sector}>{x.sector}</option>)}
            </select>
          )}
          {brief && (
            <Button variant="secondary" onClick={exportPdf}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          )}
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {([["overview", "Overview"], ["audit", "AI audit"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${view === id ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "audit" && <AiAudit />}

      {view === "overview" && loading && !brief && <p className="text-gray-500">Reading the cooperatives' records…</p>}
      {view === "overview" && error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {view === "overview" && brief && (
        <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
          {/* 1. The answer, in a sentence */}
          <div className="rounded-xl bg-gradient-to-r from-[#2D6A4F] to-[#1B5E20] p-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-2xl">
                <p className="text-lg font-semibold leading-snug">{brief.headline.sentence}</p>
                {brief.headline.latestPeriod && (
                  <p className="mt-2 text-xs text-white/70">
                    Scores from each cooperative's latest monthly audit (most recent: {monthLabel(brief.headline.latestPeriod)}); everything else from today's records.
                  </p>
                )}
              </div>
              {brief.headline.averageScore != null && (
                <div className="text-center">
                  <p className="text-5xl font-bold tabular-nums">{brief.headline.averageScore}</p>
                  <p className="text-sm text-white/80">average, out of 100</p>
                  {brief.headline.change != null && brief.headline.change !== 0 && (
                    <p className="mt-1 flex items-center justify-center gap-1 text-xs text-white/85">
                      {brief.headline.change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {brief.headline.change > 0 ? "+" : ""}{brief.headline.change} since the audit before
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 2. Where the cooperatives stand */}
          {brief.headline.cooperatives > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900">Where the {brief.headline.cooperatives} cooperatives stand</h2>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-gray-100">
                {standingParts.filter(([, count]) => count > 0).map(([label, count, bar]) => (
                  <div key={label} className={bar} style={{ width: `${(count / brief.headline.cooperatives) * 100}%` }} title={`${label}: ${count}`} />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {standingParts.map(([label, count, bar]) => (
                  <div key={label}>
                    <p className="text-2xl font-bold tabular-nums text-gray-900">{count}</p>
                    <p className="flex items-center gap-1.5 text-xs text-gray-600"><span className={`h-2 w-2 rounded-full ${bar}`} />{label}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 3. One cooperative, when chosen */}
          {selected && (
            <div id="cooperative-panel" className="scroll-mt-4">
              <CooperativePanel id={selected} onClose={() => setSelected(null)} />
            </div>
          )}

          {/* 4. What they have in common */}
          {brief.headline.assessed > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {brief.commonProblems.length ? "Problems found, most common first" : "No problems found"}
                </h2>
                {brief.commonProblems.length > 0 && (
                  <p className="text-sm text-gray-600">
                    A problem many cooperatives share is better dealt with once, for all of them, than one cooperative at a time.
                  </p>
                )}
              </div>
              {brief.commonProblems.length === 0 && (
                <Card className="flex items-center gap-3 p-5 text-sm text-gray-700">
                  <CheckCircle2 className="h-5 w-5 text-[#2D6A4F]" />
                  The latest audits raised no findings for these cooperatives.
                </Card>
              )}
              {brief.commonProblems.map((p) => {
                const s = SEVERITY[p.severity];
                const open = openProblem === p.code;
                return (
                  <div key={p.code} className={`rounded-xl border p-4 ${s.box}`}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon}`} />
                        <div>
                          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {s.label}
                            {p.widespread && <span className="rounded-full bg-gray-900 px-2 py-0.5 normal-case tracking-normal text-white">Widespread</span>}
                          </p>
                          <p className="font-semibold text-gray-900">{p.title}</p>
                          <p className="mt-1 text-sm text-gray-700">{p.why}</p>
                          <p className="mt-1 text-sm text-gray-900"><span className="font-medium">What each cooperative should do:</span> {p.action}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold tabular-nums text-gray-900">{p.cooperatives}</p>
                        <p className="text-xs text-gray-600">cooperative{p.cooperatives === 1 ? "" : "s"} · {p.share}%</p>
                        <button onClick={() => setOpenProblem(open ? null : p.code)} className="mt-1 text-xs font-medium text-[#2D6A4F] hover:underline">
                          {open ? "Hide" : "Show which"}
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-3">
                        {p.affected.map((a) => (
                          <button key={a.id} onClick={() => choose(a.id)} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:border-[#2D6A4F] hover:text-[#2D6A4F]">
                            {a.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 5. Area by area */}
          {brief.headline.assessed > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Area by area, across these cooperatives</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {brief.areas.map((a) => {
                  const l = LEVEL[a.level];
                  return (
                    <Card key={a.key} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{a.label}</p>
                          <p className="text-xs text-gray-500">{a.about}</p>
                        </div>
                        {a.score != null && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${l.badge}`}>{l.label}</span>}
                      </div>
                      {a.score != null && (
                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-2 flex-1 rounded-full bg-gray-200">
                            <div className={`h-2 rounded-full ${l.bar}`} style={{ width: `${Math.min(100, a.score)}%` }} />
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-gray-900">{a.score}/100</span>
                        </div>
                      )}
                      <p className="mt-3 text-sm text-gray-700">{a.sentence}</p>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* 6. District by district, sector by sector */}
          {brief.groups.districts.length > 0 && (
            <GroupTable title="District by district" heading="District" groups={brief.groups.districts} onChoose={(name) => { setDistrict(name); setSector(""); setSelected(null); }} />
          )}
          {brief.groups.sectors.length > 0 && (
            <GroupTable title="Sector by sector, weakest first" heading="Sector" groups={brief.groups.sectors} onChoose={(name) => { setSector(name); setSelected(null); }} />
          )}

          {/* 7. Cooperative by cooperative */}
          {brief.cooperatives.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Cooperatives, most in need first</h2>
                <p className="text-sm text-gray-600">Choose a cooperative to see its findings and its members' engagement.</p>
              </div>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
                      <th className="px-4 py-2.5 font-medium">Cooperative</th>
                      {scope?.level !== "sector" && <th className="px-4 py-2.5 font-medium">Sector</th>}
                      <th className="px-4 py-2.5 font-medium">Score</th>
                      <th className="px-4 py-2.5 font-medium">Rating</th>
                      <th className="px-4 py-2.5 font-medium">Change</th>
                      <th className="px-4 py-2.5 font-medium">Members</th>
                      <th className="px-4 py-2.5 font-medium">To put right</th>
                      <th className="px-4 py-2.5 font-medium">Main problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brief.cooperatives.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => choose(c.id)}
                        className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 ${selected === c.id ? "bg-[#2D6A4F]/5" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-[#2D6A4F]">{c.name}</td>
                        {scope?.level !== "sector" && <td className="px-4 py-2.5 text-gray-700">{c.sector ?? "–"}</td>}
                        <td className="px-4 py-2.5 font-semibold tabular-nums text-gray-900">{c.score ?? "–"}</td>
                        <td className="px-4 py-2.5">
                          {c.band ? (
                            <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND[c.band].badge}`}>{BAND[c.band].label}</span>
                          ) : (
                            <span className="whitespace-nowrap text-xs text-gray-500">Not assessed</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums"><Change value={c.change} /></td>
                        <td className="px-4 py-2.5 tabular-nums text-gray-700">{c.members}</td>
                        <td className="px-4 py-2.5 tabular-nums text-gray-700">
                          {c.findings}{c.urgent > 0 && <span className="ml-1 text-xs font-semibold text-red-600">({c.urgent} urgent)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700">{c.mainProblem ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {/* 8. The figures, and what the models flagged */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900">The figures, all these cooperatives together</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                {[
                  ["Members", brief.numbers.members.toLocaleString()],
                  ["Members' savings held", rwf(brief.numbers.savings)],
                  ["Income, last 3 full months", rwf(brief.numbers.incomeLast3Months)],
                  ["Expenses, last 3 full months", rwf(brief.numbers.expenseLast3Months)],
                  ["Cooperatives that recorded transactions in that time", `${brief.numbers.cooperativesRecordingTransactions} of ${brief.headline.cooperatives}`],
                  ["Members paying contributions", brief.numbers.payingShare != null ? `${brief.numbers.payingShare}% in the last 3 months` : "n/a"],
                  ["Attendance at activities", brief.numbers.attendanceShare != null ? `${brief.numbers.attendanceShare}% in the last 6 months` : "n/a"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-gray-100 pb-1.5">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="text-right font-medium text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900">Flagged in the records ({brief.alerts.open} open)</h2>
              <p className="mt-1 text-xs text-gray-500">
                Entries or patterns that differ from what is normal for the cooperative concerned. Worth a look; not every one is a problem.
              </p>
              {brief.alerts.latest.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">Nothing is flagged at the moment.</p>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {brief.alerts.latest.map((a) => (
                    <button key={a.id} onClick={() => navigate(`/ai-insights/${a.id}`)} className="block w-full py-2.5 text-left hover:bg-gray-50">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{a.cooperative_name}</span>
                        {a.severity === "critical" && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">needs a look</span>}
                        <span>{new Date(a.generated_at).toLocaleDateString()}</span>
                      </p>
                      <p className="text-sm font-medium text-gray-900">{a.title}</p>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <p className="text-xs text-gray-500">{brief.method}</p>
        </div>
      )}
    </div>
  );
}
