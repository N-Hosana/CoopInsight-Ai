import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { Card } from "./Card";
import {
  AlertTriangle,
  Brain,
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Info,
  PiggyBank,
  TrendingUp,
  Users,
  Building2,
} from "lucide-react";

/**
 * A member's AI insights: their own progress first, their cooperative second.
 *
 * The page every other role sees is about cooperatives — anomalies, benchmarks,
 * model performance — and it used to show a member the whole district. A
 * member's questions are personal: am I saving regularly, am I turning up, how
 * is my loan going, and is my cooperative sound? Everything here comes from
 * `/ai/me` (their own records) and the AI endpoints, which now return only
 * their own cooperative's output. No other member is ever named.
 */

type Tone = "positive" | "warning" | "info";

interface PersonalInsight {
  id: string;
  category: "savings" | "attendance" | "loans" | "dividends" | "cooperative";
  tone: Tone;
  title: string;
  detail: string;
}

interface MyData {
  member: { name: string; cooperativeName: string; memberSince: string | null; former: boolean };
  summary: {
    savings: number;
    savingsLast3Months: number;
    savingsPrevious3Months: number;
    monthsSavedOf6: number;
    savingsPercentile: number | null;
    cooperativeMedianSavings: number | null;
    attendanceRate: number | null;
    cooperativeAttendanceRate: number | null;
    activitiesAttended: number;
    activitiesInvited: number;
    loanBalance: number;
    lastDividend: { amount: number; period: string } | null;
    cooperativeBand: string | null;
  };
  savingsTrend: Array<{ month: string; amount: number }>;
  insights: PersonalInsight[];
  method: string;
}

interface CoopInsight {
  id: string;
  type: string;
  severity: string | null;
  title: string;
  summary: string;
  generated_at: string;
}

interface Engagement {
  own: { overallScore: number; band?: string } | null;
  stats: { members: number; average: number | null; median: number | null; yourPercentile: number | null } | null;
}

const TONE: Record<Tone, { box: string; Icon: typeof Info; icon: string }> = {
  warning: { box: "border-amber-200 bg-amber-50", Icon: AlertTriangle, icon: "text-amber-600" },
  positive: { box: "border-green-200 bg-green-50", Icon: CheckCircle2, icon: "text-green-700" },
  info: { box: "border-blue-100 bg-blue-50", Icon: Info, icon: "text-blue-700" },
};

const CATEGORY_LABEL: Record<PersonalInsight["category"], string> = {
  savings: "Savings",
  attendance: "Participation",
  loans: "Loans",
  dividends: "Dividends",
  cooperative: "Your cooperative",
};

const rwf = (v: number) => `${Math.round(v).toLocaleString("en-RW")} RWF`;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const monthLabel = (ym: string) =>
  new Date(`${ym}-01`).toLocaleDateString(undefined, { month: "short" });

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Info; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export function MyInsights() {
  const navigate = useNavigate();
  const [data, setData] = useState<MyData | null>(null);
  const [notLinked, setNotLinked] = useState<string | null>(null);
  const [coopInsights, setCoopInsights] = useState<CoopInsight[]>([]);
  const [engagement, setEngagement] = useState<Engagement>({ own: null, stats: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.get<{ data: MyData | null; message?: string }>("/ai/me"),
      api.get<{ data: CoopInsight[] }>("/ai/insights?page=1&limit=20"),
      api.get<{ data: { engagement?: any[]; cooperativeStats?: Engagement["stats"] } }>("/ai/member-engagement"),
    ])
      .then(([me, coop, eng]) => {
        if (me.status === "fulfilled") {
          setData(me.value.data);
          if (!me.value.data) setNotLinked(me.value.message ?? "No personal record is linked to your account.");
        } else {
          setError((me.reason as any)?.message ?? "Could not load your insights.");
        }
        if (coop.status === "fulfilled") setCoopInsights(coop.value.data ?? []);
        if (eng.status === "fulfilled") {
          setEngagement({
            own: eng.value.data?.engagement?.[0] ?? null,
            stats: eng.value.data?.cooperativeStats ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="py-8 text-gray-500">Working out your insights…</p>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (notLinked || !data) {
    return (
      <Card className="p-8 text-center text-gray-600">
        {notLinked} Ask your cooperative manager to check that you are on the member register.
      </Card>
    );
  }

  const { summary: s } = data;
  const peak = Math.max(1, ...data.savingsTrend.map((m) => m.amount));
  const change =
    s.savingsPrevious3Months > 0
      ? (s.savingsLast3Months - s.savingsPrevious3Months) / s.savingsPrevious3Months
      : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Brain className="h-8 w-8 text-[#2D6A4F]" />
          Your insights
        </h1>
        <p className="mt-1 text-gray-600">
          How you are doing as a member of {data.member.cooperativeName}, and how the cooperative is doing.
          Only your own records are used; other members are counted, never named.
        </p>
      </div>

      {data.member.former && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          You are no longer a member of {data.member.cooperativeName}. These insights describe your record up
          to the date you left.
        </div>
      )}

      {/* Where you stand */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          icon={PiggyBank}
          label="Your savings"
          value={rwf(s.savings)}
          sub={s.savingsPercentile != null ? `ahead of ${pct(s.savingsPercentile)} of members` : undefined}
        />
        <Tile icon={CalendarClock} label="Months saved" value={`${s.monthsSavedOf6} of 6`} sub="last six complete months" />
        <Tile
          icon={Users}
          label="Attendance"
          value={pct(s.attendanceRate)}
          sub={
            s.activitiesInvited
              ? `${s.activitiesAttended} of ${s.activitiesInvited} · cooperative ${pct(s.cooperativeAttendanceRate)}`
              : "no activities recorded for you yet"
          }
        />
        <Tile
          icon={TrendingUp}
          label="Engagement score"
          value={engagement.own ? `${Math.round(engagement.own.overallScore)}/100` : "—"}
          sub={
            engagement.stats?.average != null
              ? `cooperative average ${engagement.stats.average}${engagement.stats.yourPercentile != null ? ` · ahead of ${engagement.stats.yourPercentile}%` : ""}`
              : "needs the AI service"
          }
        />
        <Tile
          icon={HandCoins}
          label="Loan owed"
          value={s.loanBalance > 0 ? rwf(s.loanBalance) : "None"}
          sub={s.lastDividend ? `last dividend ${rwf(s.lastDividend.amount)} (${s.lastDividend.period})` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Your progress */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Your progress</h2>
          {data.insights.filter((i) => i.category !== "cooperative").length === 0 && (
            <Card className="p-6 text-sm text-gray-600">Nothing to report yet — your record is too new.</Card>
          )}
          {data.insights
            .filter((i) => i.category !== "cooperative")
            .map((i) => {
              const t = TONE[i.tone];
              return (
                <div key={i.id} className={`flex items-start gap-3 rounded-xl border p-4 ${t.box}`}>
                  <t.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.icon}`} />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{CATEGORY_LABEL[i.category]}</p>
                    <p className="font-semibold text-gray-900">{i.title}</p>
                    <p className="mt-0.5 text-sm text-gray-700">{i.detail}</p>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Savings trend */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Savings, month by month</h2>
          <div className="mt-4 flex h-40 items-end gap-2">
            {data.savingsTrend.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-gray-500">
                  {m.amount ? `${Math.round(m.amount / 1000)}k` : "0"}
                </span>
                <div
                  className={`w-full rounded-t ${m.amount ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
                  style={{ height: `${Math.max(4, (m.amount / peak) * 110)}px` }}
                  title={`${m.month}: ${rwf(m.amount)}`}
                />
                <span className="text-[11px] text-gray-500">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-600">
            Last three months {rwf(s.savingsLast3Months)}
            {change != null && (
              <span className={change >= 0 ? "text-green-700" : "text-amber-700"}>
                {" "}({change >= 0 ? "+" : ""}{Math.round(change * 100)}% on the three before)
              </span>
            )}
            {s.cooperativeMedianSavings != null && <> · cooperative median balance {rwf(s.cooperativeMedianSavings)}</>}
          </p>
          <button onClick={() => navigate("/members/me")} className="mt-3 text-sm font-medium text-[#2D6A4F] hover:underline">
            Open my full record →
          </button>
        </Card>
      </div>

      {/* Your cooperative */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[#2D6A4F]" />
          {data.member.cooperativeName}
        </h2>
        {data.insights
          .filter((i) => i.category === "cooperative")
          .map((i) => {
            const t = TONE[i.tone];
            return (
              <div key={i.id} className={`flex items-start gap-3 rounded-xl border p-4 ${t.box}`}>
                <t.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.icon}`} />
                <div>
                  <p className="font-semibold text-gray-900">{i.title}</p>
                  <p className="mt-0.5 text-sm text-gray-700">{i.detail}</p>
                </div>
              </div>
            );
          })}
        {coopInsights.length === 0 ? (
          <Card className="p-5 text-sm text-gray-600">
            The AI has raised nothing about {data.member.cooperativeName} recently.
          </Card>
        ) : (
          <Card className="divide-y divide-gray-100">
            {coopInsights.map((c) => (
              <div key={c.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">{c.type}</span>
                  {c.severity && ["critical", "high"].includes(c.severity) && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{c.severity}</span>
                  )}
                  <span className="text-xs text-gray-400">{new Date(c.generated_at).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 font-medium text-gray-900">{c.title}</p>
                <p className="text-sm text-gray-600">{c.summary}</p>
              </div>
            ))}
          </Card>
        )}
      </div>

      <p className="text-xs text-gray-500">{data.method}</p>
    </div>
  );
}
