import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { downloadPdf } from "../services/pdf";
import { Card } from "./Card";
import { Button } from "./Button";
import { MyInsights } from "./MyInsights";
import { MemberEngagement } from "./MemberEngagement";
import { AlertOctagon, AlertTriangle, ArrowRight, Brain, CheckCircle2, Download, Info, TrendingDown, TrendingUp } from "lucide-react";

/**
 * A manager's AI insights: their own cooperative, and their own record.
 *
 * The page every role used to share was five tabs of model output under a
 * headline score that was a constant (87) with invented fallback text. A
 * manager wants three answers, in this order: how is my cooperative doing,
 * what is wrong, what do I do next. This page gives exactly that, for their
 * own cooperative only, with each thing to fix linked to where it is fixed.
 * A second tab shows their own standing as a member.
 */

type Level = "good" | "watch" | "problem";
type Severity = "critical" | "major" | "minor";

interface Brief {
  cooperative: { id: string; name: string; sector: string };
  headline: {
    sentence: string;
    score: number | null;
    band: string | null;
    period: string | null;
    change: number | null;
    districtAverage: number | null;
    comparison: string | null;
  };
  areas: Array<{ key: string; label: string; about: string; score: number | null; level: Level; sentence: string; findings: number }>;
  priorities: Array<{ code: string; severity: Severity; title: string; why: string; action: string; link: string; linkLabel: string }>;
  strengths: string[];
  numbers: {
    members: number;
    activeMembers: number;
    savings: number;
    incomeLast3Months: number;
    expenseLast3Months: number;
    incomeChange: number | null;
    loansOutstanding: number;
    overdueLoans: number;
    payingShare: number | null;
    attendanceShare: number | null;
    upcomingActivities: number;
  };
  alerts: Array<{ id: string; type: string; severity: string | null; title: string; summary: string; generated_at: string }>;
  method: string;
}

const LEVEL: Record<Level, { label: string; bar: string; badge: string }> = {
  good: { label: "Good", bar: "bg-[#2D6A4F]", badge: "bg-green-100 text-green-800" },
  watch: { label: "Watch", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-800" },
  problem: { label: "Problem", bar: "bg-red-600", badge: "bg-red-100 text-red-700" },
};

const SEVERITY: Record<Severity, { label: string; box: string; Icon: typeof Info; icon: string }> = {
  critical: { label: "Urgent", box: "border-red-200 bg-red-50", Icon: AlertOctagon, icon: "text-red-600" },
  major: { label: "Important", box: "border-amber-200 bg-amber-50", Icon: AlertTriangle, icon: "text-amber-600" },
  minor: { label: "When you can", box: "border-gray-200 bg-gray-50", Icon: Info, icon: "text-gray-500" },
};

const BAND_LABEL: Record<string, string> = {
  healthy: "Healthy",
  monitor: "Worth watching",
  at_risk: "At risk",
  critical: "Critical",
};

const rwf = (v: number) => `${Math.round(v).toLocaleString()} RWF`;
const monthLabel = (ym: string | null) =>
  ym ? new Date(`${ym}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

export function ManagerInsights() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"cooperative" | "members" | "me">("cooperative");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ data: Brief }>("/ai/cooperative-brief")
      .then((res) => setBrief(res.data))
      .catch((err: any) => setError(err?.message ?? "Could not load your cooperative's insights."))
      .finally(() => setLoading(false));
  }, []);

  const exportPdf = () => {
    if (!brief) return;
    downloadPdf({
      title: "Cooperative Insights",
      subtitle: brief.headline.period ? `Based on the ${monthLabel(brief.headline.period)} audit and current records` : "Based on current records",
      narrative: [brief.headline.sentence, ...(brief.headline.comparison ? [brief.headline.comparison] : [])],
      summary: [
        { label: "Overall score", value: brief.headline.score != null ? `${brief.headline.score} / 100` : "Not assessed" },
        { label: "Rating", value: brief.headline.band ? BAND_LABEL[brief.headline.band] ?? brief.headline.band : "Not assessed" },
        { label: "Members", value: String(brief.numbers.members) },
        { label: "Things to put right", value: String(brief.priorities.length) },
      ],
      sections: [
        {
          title: "How each area is doing",
          columns: ["Area", "Score", "Rating", "What the records show"],
          rows: brief.areas.map((a) => [a.label, a.score ?? "-", LEVEL[a.level].label, a.sentence]),
        },
        {
          title: "What to put right, most serious first",
          columns: ["Priority", "What", "Why it matters", "What to do"],
          rows: brief.priorities.map((p) => [SEVERITY[p.severity].label, p.title, p.why, p.action]),
        },
        ...(brief.strengths.length ? [{ title: "What is going well", paragraphs: brief.strengths }] : []),
      ],
    }).catch((err: any) => alert(err?.message ?? "The PDF could not be produced."));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Brain className="h-8 w-8 text-[#2D6A4F]" />
            Insights
          </h1>
          <p className="mt-1 text-gray-600">
            How {brief?.cooperative.name ?? "your cooperative"} is doing, what needs putting right, and where to do it.
          </p>
        </div>
        {tab === "cooperative" && brief && (
          <Button variant="secondary" onClick={exportPdf}>
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-gray-200 p-1">
        {([["cooperative", "My cooperative"], ["members", "Members' engagement"], ["me", "My own record"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === id ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "me" && <MyInsights embedded />}

      {tab === "members" && (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="font-semibold text-gray-900">How engaged each member is</h2>
            <p className="text-sm text-gray-600">From attendance at activities and how regularly each member pays contributions.</p>
          </div>
          <MemberEngagement />
        </Card>
      )}

      {tab === "cooperative" && loading && <p className="text-gray-500">Reading your cooperative's records…</p>}
      {tab === "cooperative" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {tab === "cooperative" && brief && (
        <>
          {/* 1. The answer, in a sentence */}
          <div className="rounded-xl bg-gradient-to-r from-[#2D6A4F] to-[#1B5E20] p-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-2xl">
                <p className="text-lg font-semibold leading-snug">{brief.headline.sentence}</p>
                {brief.headline.comparison && <p className="mt-2 text-sm text-white/85">{brief.headline.comparison}</p>}
                {brief.headline.period && (
                  <p className="mt-2 text-xs text-white/70">
                    Score from the {monthLabel(brief.headline.period)} monthly audit; everything else from today's records.
                  </p>
                )}
              </div>
              {brief.headline.score != null && (
                <div className="text-center">
                  <p className="text-5xl font-bold tabular-nums">{brief.headline.score}</p>
                  <p className="text-sm text-white/80">out of 100</p>
                  {brief.headline.band && (
                    <p className="mt-1 rounded-full bg-white/15 px-3 py-0.5 text-xs font-medium">{BAND_LABEL[brief.headline.band] ?? brief.headline.band}</p>
                  )}
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

          {/* 2. What to do */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {brief.priorities.length ? "What to put right, most serious first" : "Nothing needs putting right"}
            </h2>
            {brief.priorities.length === 0 && (
              <Card className="flex items-center gap-3 p-5 text-sm text-gray-700">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                The latest audit raised no findings and the records are up to date.
              </Card>
            )}
            {brief.priorities.map((p, i) => {
              const s = SEVERITY[p.severity];
              return (
                <div key={`${p.code}-${i}`} className={`rounded-xl border p-4 ${s.box}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon}`} />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{s.label}</p>
                        <p className="font-semibold text-gray-900">{p.title}</p>
                        <p className="mt-1 text-sm text-gray-700">{p.why}</p>
                        <p className="mt-1 text-sm text-gray-900"><span className="font-medium">What to do:</span> {p.action}</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => navigate(p.link)}>
                      <span className="flex items-center gap-1.5">{p.linkLabel}<ArrowRight className="h-4 w-4" /></span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 3. Area by area */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">How each area is doing</h2>
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
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${l.badge}`}>{l.label}</span>
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

          {/* 4. What is going well, and the figures behind it */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900">What is going well</h2>
              {brief.strengths.length ? (
                <ul className="mt-3 space-y-2">
                  {brief.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-gray-500">Nothing stands out yet. Clearing the items above will change that.</p>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold text-gray-900">The figures</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                {[
                  ["Members", `${brief.numbers.members} (${brief.numbers.activeMembers} active)`],
                  ["Members' savings held", rwf(brief.numbers.savings)],
                  ["Income, last 3 full months", rwf(brief.numbers.incomeLast3Months) + (brief.numbers.incomeChange != null ? ` (${brief.numbers.incomeChange >= 0 ? "+" : ""}${brief.numbers.incomeChange}% on the 3 before)` : "")],
                  ["Expenses, last 3 full months", rwf(brief.numbers.expenseLast3Months)],
                  ["Loans owed by members", brief.numbers.loansOutstanding ? `${rwf(brief.numbers.loansOutstanding)} (${brief.numbers.overdueLoans} overdue)` : "None"],
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
          </div>

          {/* 5. What the models flagged */}
          {brief.alerts.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Flagged in your records</h2>
              <p className="-mt-2 text-sm text-gray-600">
                Entries or patterns in {brief.cooperative.name}'s records that differ from what is normal for it. Each is worth a look; not every one is a problem.
              </p>
              <Card className="divide-y divide-gray-100">
                {brief.alerts.map((a) => (
                  <button key={a.id} onClick={() => navigate(`/ai-insights/${a.id}`)} className="block w-full p-4 text-left hover:bg-gray-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">{a.type}</span>
                      {a.severity && ["critical", "high"].includes(a.severity) && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">needs a look</span>
                      )}
                      <span className="text-xs text-gray-400">{new Date(a.generated_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 font-medium text-gray-900">{a.title}</p>
                    <p className="text-sm text-gray-600">{a.summary}</p>
                  </button>
                ))}
              </Card>
            </div>
          )}

          <p className="text-xs text-gray-500">{brief.method}</p>
        </>
      )}
    </div>
  );
}
