import {
  Users,
  Activity,
  DollarSign,
  TrendingUp,
  Lightbulb,
  Target,
  AlertCircle,
  PiggyBank,
  CreditCard,
  Plus,
  FileText,
  Bell,
  BarChart3,
  Building2,
  CheckCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { SystemAnnouncements, SystemAnnouncement } from "../components/SystemAnnouncements";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export function Dashboard() {
  const { user } = useAuth();
  const [systemAnnouncements] = useState<SystemAnnouncement[]>([
    {
      id: "maintenance-notice",
      type: "info",
      title: "System Maintenance Notice",
      message: "Scheduled maintenance on May 25, 2026 from 2:00 AM to 4:00 AM UTC. System will be temporarily unavailable.",
      dismissible: true,
    },
    {
      id: "security-update",
      type: "success",
      title: "Security Update Completed",
      message: "Your account has been updated with the latest security patches. No action required.",
      dismissible: true,
    },
  ]);

  const [stats, setStats] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [financialTrends, setFinancialTrends] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(
      "coopinsight_dashboard",
      JSON.stringify({
        timestamp: new Date().toISOString(),
      })
    );

    const fetchDashboard = async () => {
      try {
        const [statsRes, activitiesRes, alertsRes, trendsRes] = await Promise.all([
          api.get<any>("/dashboard/stats"),
          api.get<any>("/dashboard/recent-activity"),
          api.get<any>("/dashboard/alerts"),
          api.get<any>("/dashboard/financial-trends?months=6").catch(() => ({ data: [] })),
        ]);
        setStats((statsRes as any)?.data ?? statsRes);
        setActivities((activitiesRes as any)?.data ?? []);
        // Income, expenses and savings by month, from the same records as the
        // Financials page. This was always set to [], so the chart showed six
        // invented months.
        setFinancialTrends((trendsRes as any)?.data ?? []);
        setNotifications((alertsRes as any)?.data ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  if (user?.role === "manager") {
    return (
      <ManagerDashboard
        announcements={systemAnnouncements}
        stats={stats}
        activities={activities}
        financialTrends={financialTrends}
        notifications={notifications}
        loading={loading}
        error={error}
      />
    );
  }

  if (user?.role === "government") {
    return <GovernmentDashboard announcements={systemAnnouncements} />;
  }

  if (user?.role === "member") {
    return <MemberDashboard user={user} announcements={systemAnnouncements} />;
  }

  return (
    <AdminDashboard
      announcements={systemAnnouncements}
      stats={stats}
      activities={activities}
      financialTrends={financialTrends}
      notifications={notifications}
      loading={loading}
      error={error}
    />
  );
}

const rwf = (v: number | null | undefined) => `${Math.round(Number(v ?? 0)).toLocaleString()} RWF`;

/**
 * The money cards, from /dashboard/stats. Each is the same figure the
 * Financials page shows for the same thing, and each caption is a fact from
 * the same records — not a decorative percentage.
 */
function moneyCards(stats: any, loading: boolean) {
  const prev = Number(stats?.previousMonthRevenue ?? 0);
  const now = Number(stats?.monthlyRevenue ?? 0);
  const change = prev > 0 ? Math.round(((now - prev) / prev) * 100) : null;
  return [
    {
      title: "Total Members",
      value: loading ? "..." : (stats?.totalMembers ?? 0).toLocaleString(),
      change: loading ? "" : `${stats?.newMembersThisMonth ?? 0} joined this month`,
      trend: "up",
      icon: Users,
    },
    {
      title: "Income this month",
      value: loading ? "..." : rwf(now),
      change: loading ? "" : change == null ? `last month ${rwf(prev)}` : `${change >= 0 ? "+" : ""}${change}% on last month (${rwf(prev)})`,
      trend: "up",
      icon: DollarSign,
    },
    {
      title: "Total Savings",
      value: loading ? "..." : rwf(stats?.totalSavings),
      change: loading ? "" : `${rwf(stats?.savingsThisMonth)} paid in this month`,
      trend: "up",
      icon: PiggyBank,
    },
    {
      title: "Loans outstanding",
      value: loading ? "..." : rwf(stats?.activeLoanBalance),
      change: loading ? "" : `${stats?.overdueLoans ?? 0} overdue`,
      trend: "up",
      icon: CreditCard,
    },
  ];
}

/** Monthly income, expenses and savings for the chart — empty, never invented. */
function trendSeries(trends: any[]) {
  return trends.map((t) => ({
    month: new Date(`${t.month}-01`).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    income: Math.round(t.income),
    expense: Math.round(t.expense),
    savings: Math.round(t.savings),
  }));
}

interface DashboardDataProps {
  stats: any;
  activities: any[];
  financialTrends: any[];
  notifications: any[];
  loading: boolean;
  error: string | null;
}

function ManagerDashboard({
  announcements,
  stats,
  activities,
  financialTrends,
  notifications,
  loading,
  error,
}: { announcements: SystemAnnouncement[] } & DashboardDataProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recommendation, setRecommendation] = useState<{ title: string; summary: string } | null>(null);
  useEffect(() => {
    api
      .get<any>("/ai/recommendations?limit=1")
      .then((res) => setRecommendation((res as any)?.data?.[0] ?? null))
      .catch(() => setRecommendation(null));
  }, []);

  // Every figure here is the same number the Financials page shows for the
  // same thing: Monthly Revenue was showing Total Savings, Active Loans read a
  // field that did not exist, and the small percentages were all invented.
  const summaryCards = moneyCards(stats, loading);
  const trendData = trendSeries(financialTrends);

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
          <p className="text-gray-600 mt-1">{user?.cooperativeName ?? "Your Cooperative"}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/members/new")}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Member
          </button>
          <button
            onClick={() => navigate("/transactions/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[#D4A574] text-[#1B4332] rounded-lg hover:bg-[#B8956A] transition-colors font-medium"
          >
            <FileText className="w-4 h-4" />
            Record Transaction
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-[#2D6A4F]/10 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2D6A4F]" />
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-1">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              {card.change && <p className="mt-1 text-xs text-gray-500">{card.change}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Money in and out, by month</h2>
          <p className="text-xs text-gray-500 mb-3">From the same records as the Financials page (RWF).</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Line type="monotone" dataKey="income" name="Income" stroke="#2D6A4F" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="expense" name="Expenses" stroke="#DC2626" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="savings" name="Savings paid in" stroke="#10B981" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
            <Bell className="w-5 h-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {notifications.length > 0 ? (
              notifications.slice(0, 5).map((n: any) => (
                <div
                  key={n.id}
                  className={`p-3 rounded-lg ${
                    n.type === "warning"
                      ? "bg-yellow-50"
                      : n.type === "error"
                      ? "bg-red-50"
                      : "bg-blue-50"
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">{n.title}</p>
                  <p className="text-xs text-gray-600">{n.message}</p>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-gray-400">No alerts right now.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-[#2D6A4F] to-[#1B5E20] rounded-xl p-6 text-white">
        <div className="flex items-start gap-4">
          <Lightbulb className="w-8 h-8" />
          <div>
            <h3 className="font-semibold mb-2">AI Recommendation</h3>
            <p className="text-blue-100 mb-3">
              {recommendation
                ? `${recommendation.title}: ${recommendation.summary}`
                : "Open AI insights for what the models have found in your cooperative's records."}
            </p>
            <button
              onClick={() => navigate("/ai-insights")}
              className="px-4 py-2 bg-white text-[#2D6A4F] rounded-lg hover:bg-[#2D6A4F]/10 transition-colors text-sm font-medium"
            >
              View Details
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity Feed</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {activities.length > 0 ? (
            activities.map((activity: any, index: number) => (
              <div
                key={activity.id ?? index}
                className="p-6 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {activity.cooperative_name ?? activity.title}
                    </p>
                    <p className="text-sm text-gray-600 capitalize">
                      {activity.entity_type === "member" ? "New member joined" : activity.sub_type ?? activity.entity_type}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {activity.amount != null ? `${Number(activity.amount).toLocaleString()} RWF` : activity.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {activity.created_at ? new Date(activity.created_at).toLocaleDateString() : ""}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="p-6 text-center text-sm text-gray-400">Nothing recorded recently.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GovernmentDashboard({ announcements }: { announcements: SystemAnnouncement[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [govLoading, setGovLoading] = useState(true);

  useEffect(() => {
    const fetchGovData = async () => {
      try {
        const [overviewRes, complianceRes, healthRes] = await Promise.all([
          api.get<any>("/dashboard/government/overview"),
          api.get<any>("/dashboard/government/compliance"),
          api.get<any>("/dashboard/health-overview"),
        ]);
        setOverview((overviewRes as any)?.data ?? overviewRes);
        setCompliance((complianceRes as any)?.data ?? complianceRes);
        setHealth((healthRes as any)?.data ?? healthRes);
      } catch (err) {
        console.error("Government dashboard fetch error:", err);
      } finally {
        setGovLoading(false);
      }
    };
    fetchGovData();
  }, []);

  const statCards = [
    { label: "Total Cooperatives", value: govLoading ? "…" : (overview?.totalCooperatives ?? 0).toLocaleString(), icon: Building2 },
    { label: "Total Members",      value: govLoading ? "…" : (overview?.totalMembers ?? 0).toLocaleString(),      icon: Users },
    { label: "Compliance Rate",    value: govLoading ? "…" : `${compliance?.overallComplianceRate ?? 0}%`,        icon: CheckCircle },
    { label: "Avg Health Score",   value: govLoading ? "…" : `${Math.round(overview?.averageHealthScore ?? 0)}/100`, icon: BarChart3 },
  ];

  const topPerformers: any[] = health?.topPerformers ?? [];
  const atRisk: any[] = compliance?.nonCompliantList ?? health?.atRisk ?? [];

  const sectorData = (overview?.breakdownBySector ?? []).map((s: any) => ({
    sector: s.sector,
    count: parseInt(s.count) || 0,
  }));

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      {/*
        All three oversight tiers share this dashboard and all three carry the
        role `government`, so titling it "RCA Monitoring" told a sector officer
        in Remera that they were looking at the national agency's desk. The
        title now names whose desk it actually is, and the subtitle names the
        scope they can actually see.
      */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {user?.oversightLevel === "sector"
            ? `${user?.sector ?? "Sector"} Sector Monitoring`
            : user?.oversightLevel === "district"
              ? "Gasabo District Monitoring"
              : user?.oversightLevel === "rca"
                ? "RCA Monitoring — Gasabo Portfolio"
                : "Cooperative Monitoring"}
        </h1>
        <p className="text-gray-600 mt-1">
          {user?.oversightLevel === "sector"
            ? `Cooperatives registered in ${user?.sector ?? "your"} sector — performance overview`
            : "Gasabo District — cooperative performance overview"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 bg-[#2D6A4F]/10 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2D6A4F]" />
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Performing Cooperatives</h2>
          <div className="space-y-3">
            {topPerformers.length > 0 ? topPerformers.map((coop: any, index: number) => (
              <div
                key={coop.id ?? index}
                onClick={() => navigate(`/cooperatives/${coop.id}`)}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-[#2D6A4F]/10 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{coop.name}</p>
                  <p className="text-sm text-gray-600">{coop.sector} Sector</p>
                </div>
                <div className="text-right">
                  <span className={`text-xl font-bold ${coop.health_score >= 70 ? "text-green-600" : "text-yellow-600"}`}>
                    {Math.round(coop.health_score ?? 0)}
                  </span>
                  <p className="text-xs text-gray-500">Health Score</p>
                </div>
              </div>
            )) : (
              <p className="text-gray-400 text-sm text-center py-6">Loading cooperatives…</p>
            )}
          </div>

          {sectorData.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-4">Cooperatives by Sector</h2>
              <div className="space-y-2">
                {sectorData.map((s: any) => (
                  <div key={s.sector} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-28 truncate">{s.sector}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-blue-500 h-3 rounded-full"
                        style={{ width: `${Math.min((s.count / Math.max(...sectorData.map((x: any) => x.count), 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-6 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Alerts</h2>
          <div className="space-y-3">
            {atRisk.length > 0 ? atRisk.slice(0, 6).map((coop: any, index: number) => (
              <div
                key={coop.id ?? index}
                onClick={() => navigate(`/cooperatives/${coop.id}`)}
                className="p-4 border-l-4 border-red-500 bg-red-50 rounded-r-lg cursor-pointer hover:bg-red-100 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{coop.name}</p>
                    <p className="text-xs text-gray-700">{coop.sector} Sector</p>
                  </div>
                  <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium whitespace-nowrap">
                    Score: {Math.round(coop.health_score ?? 0)}
                  </span>
                </div>
              </div>
            )) : (
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-green-700 font-medium">All cooperatives compliant</p>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-200 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Fully Compliant (≥70)</span>
              <span className="font-semibold text-green-600">{compliance?.fullyCompliant ?? "…"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Partially Compliant (40–69)</span>
              <span className="font-semibold text-yellow-600">{compliance?.partiallyCompliant ?? "…"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Non-Compliant (&lt;40)</span>
              <span className="font-semibold text-red-600">{compliance?.nonCompliant ?? "…"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Health Score Distribution</h2>
          <button
            onClick={() => navigate("/government")}
            className="text-sm text-[#2D6A4F] hover:underline"
          >
            Full monitoring →
          </button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Excellent (≥80)", count: health?.distribution?.excellent ?? 0, color: "bg-green-500" },
            { label: "Good (60–79)",    count: health?.distribution?.good ?? 0,      color: "bg-blue-500"  },
            { label: "Fair (40–59)",    count: health?.distribution?.fair ?? 0,      color: "bg-yellow-500"},
            { label: "Poor (<40)",      count: health?.distribution?.poor ?? 0,      color: "bg-red-500"   },
          ].map((band) => (
            <div key={band.label} className="text-center p-4 bg-gray-50 rounded-xl">
              <div className={`w-10 h-10 ${band.color} rounded-full mx-auto mb-2 flex items-center justify-center`}>
                <span className="text-white text-sm font-bold">{band.count}</span>
              </div>
              <p className="text-xs text-gray-600">{band.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A member's dashboard: their own standing, nothing about other members.
 *
 * It used to show "Recent Cooperative Activity" — other members joining, other
 * people's transactions — beside a performance score, chart and rates that were
 * all hardcoded (87/100, "Excellent standing member"), and it downloaded the
 * whole member list to find the member's own row. Everything here now comes
 * from the member's own record: `/ai/me` for the figures and the savings trend,
 * `/members/me/history` for what they have done lately.
 */
interface HistoryEntry {
  kind: string;
  id: string;
  at: string;
  amount: number | null;
  title: string;
  flow: "in" | "out" | null;
}

const HISTORY_ICON: Record<string, { Icon: typeof Activity; tone: string }> = {
  contribution: { Icon: PiggyBank, tone: "bg-green-50 text-green-700" },
  repayment: { Icon: CreditCard, tone: "bg-green-50 text-green-700" },
  loan: { Icon: CreditCard, tone: "bg-purple-50 text-purple-700" },
  dividend: { Icon: DollarSign, tone: "bg-orange-50 text-orange-700" },
  attended: { Icon: CheckCircle, tone: "bg-[#2D6A4F]/10 text-[#2D6A4F]" },
  missed: { Icon: AlertCircle, tone: "bg-amber-50 text-amber-700" },
  registered: { Icon: Activity, tone: "bg-blue-50 text-blue-700" },
  status: { Icon: Users, tone: "bg-gray-100 text-gray-700" },
  joined: { Icon: Users, tone: "bg-gray-100 text-gray-700" },
};

function MemberDashboard({ user, announcements }: { user: any; announcements: SystemAnnouncement[] }) {
  const navigate = useNavigate();
  const [mine, setMine] = useState<any>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.get<any>("/ai/me"),
      api.get<{ data: HistoryEntry[]; pagination: { total: number } }>("/members/me/history?limit=6"),
    ])
      .then(([me, hist]) => {
        if (me.status === "fulfilled") {
          setMine(me.value?.data ?? null);
          if (!me.value?.data) setNote(me.value?.message ?? null);
        }
        if (hist.status === "fulfilled") {
          setHistory(hist.value.data ?? []);
          setHistoryTotal(hist.value.pagination?.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  const s = mine?.summary;
  const rwf = (v: number | null | undefined) => `${Math.round(Number(v ?? 0)).toLocaleString()} RWF`;
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const trend = (mine?.savingsTrend ?? []).map((m: { month: string; amount: number }) => ({
    month: new Date(`${m.month}-01`).toLocaleDateString(undefined, { month: "short" }),
    savings: m.amount,
  }));
  const topInsights = (mine?.insights ?? []).filter((i: any) => i.category !== "cooperative").slice(0, 2);

  const tiles = [
    { label: "My savings", value: loading ? "…" : rwf(s?.savings), sub: s?.savingsPercentile != null ? `ahead of ${pct(s.savingsPercentile)} of members` : "", Icon: PiggyBank, tone: "bg-purple-50 text-purple-600" },
    { label: "Months saved", value: loading ? "…" : s ? `${s.monthsSavedOf6} of 6` : "—", sub: "last six complete months", Icon: TrendingUp, tone: "bg-green-50 text-green-600" },
    { label: "My attendance", value: loading ? "…" : pct(s?.attendanceRate), sub: s?.activitiesInvited ? `${s.activitiesAttended} of ${s.activitiesInvited} activities` : "no activities yet", Icon: Activity, tone: "bg-[#2D6A4F]/10 text-[#2D6A4F]" },
    { label: "Loan owed", value: loading ? "…" : s?.loanBalance ? rwf(s.loanBalance) : "None", sub: s?.lastDividend ? `last dividend ${rwf(s.lastDividend.amount)}` : "", Icon: CreditCard, tone: "bg-orange-50 text-orange-600" },
  ];

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      <div>
        <h1 className="text-3xl font-bold text-gray-900">My dashboard</h1>
        <p className="text-gray-600 mt-1">
          {user?.name} · {mine?.member?.cooperativeName ?? user?.cooperativeName ?? "No cooperative"}
        </p>
      </div>

      {note && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{note}</div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className={`p-3 rounded-lg inline-block mb-3 ${t.tone}`}>
              <t.Icon className="w-6 h-6" />
            </div>
            <p className="text-sm text-gray-600 mb-1">{t.label}</p>
            <p className="text-2xl font-bold text-gray-900">{t.value}</p>
            {t.sub && <p className="text-xs text-gray-500 mt-1">{t.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">My savings, month by month</h2>
          <p className="text-xs text-gray-500 mb-4">What you paid in as savings in each of the last six complete months.</p>
          <div className="h-64">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: any) => `${Number(v).toLocaleString()} RWF`} />
                  <Line type="monotone" dataKey="savings" stroke="#2D6A4F" strokeWidth={3} dot={{ r: 3 }} name="Savings" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-16 text-center text-sm text-gray-400">{loading ? "Loading…" : "No savings recorded yet."}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">How I am doing</h3>
              <button onClick={() => navigate("/ai-insights")} className="text-sm text-[#2D6A4F] hover:underline">
                All insights →
              </button>
            </div>
            {topInsights.length ? (
              <ul className="space-y-3">
                {topInsights.map((i: any) => (
                  <li key={i.id} className="text-sm">
                    <p className={`font-medium ${i.tone === "warning" ? "text-amber-800" : i.tone === "positive" ? "text-green-800" : "text-gray-900"}`}>
                      {i.title}
                    </p>
                    <p className="text-gray-600">{i.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">{loading ? "…" : "Nothing to report yet."}</p>
            )}
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-3">Coming up</h3>
            {(mine?.upcoming ?? []).length ? (
              <ul className="space-y-2">
                {mine.upcoming.slice(0, 3).map((a: any) => (
                  <li key={a.id} className="text-sm">
                    <p className="font-medium text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(a.date).toLocaleDateString()} · {a.registered ? "you are registered" : "not registered yet"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">{loading ? "…" : "Nothing scheduled in the next weeks."}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">My recent activity</h2>
          <button onClick={() => navigate("/members/me?tab=history")} className="text-sm text-[#2D6A4F] hover:underline">
            View all{historyTotal ? ` (${historyTotal})` : ""} →
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {history.length > 0 ? (
            history.map((e) => {
              const look = HISTORY_ICON[e.kind] ?? HISTORY_ICON.status;
              return (
                <div key={`${e.kind}-${e.id}`} className="py-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${look.tone}`}>
                    <look.Icon className="w-4 h-4" />
                  </div>
                  <p className="flex-1 text-sm text-gray-900">{e.title}</p>
                  <p className="text-xs text-gray-400">{new Date(e.at).toLocaleDateString()}</p>
                </div>
              );
            })
          ) : (
            <p className="text-gray-400 text-sm text-center py-8">{loading ? "Loading…" : "Nothing recorded for you yet."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// financialTrends and notifications are part of DashboardDataProps but the admin
// view does not render them; they are consumed by the manager/member dashboards.
function AdminDashboard({
  announcements,
  stats,
  loading,
  error,
}: { announcements: SystemAnnouncement[] } & DashboardDataProps) {
  const summaryCards = [
    {
      title: "Total Cooperatives",
      value: loading ? "..." : (stats?.totalCooperatives ?? 0).toLocaleString(),
      change: loading ? "" : `${stats?.activeCooperatives ?? 0} active`,
      trend: "up",
      icon: Building2,
    },
    {
      title: "Total Members",
      value: loading ? "..." : (stats?.totalMembers ?? 0).toLocaleString(),
      change: loading ? "" : `${stats?.newMembersThisMonth ?? 0} joined this month`,
      trend: "up",
      icon: Users,
    },
    {
      title: "Total Activities",
      value: loading ? "..." : (stats?.totalActivities ?? 0).toLocaleString(),
      change: loading ? "" : `${stats?.completionRate ?? 0}% completed`,
      trend: "up",
      icon: Activity,
    },
    {
      // Was showing total savings under the "revenue" label.
      title: "Total Income",
      value: loading ? "..." : `${Math.round(stats?.totalIncome ?? 0).toLocaleString()} RWF`,
      change: loading ? "" : `${Math.round(stats?.monthlyRevenue ?? 0).toLocaleString()} RWF this month`,
      trend: "up",
      icon: DollarSign,
    },
  ];

  const aiInsights = [
    {
      type: "warning",
      icon: AlertCircle,
      title: "Low Activity Alert",
      message:
        "Production activities have decreased by 15% this week. Recommend scheduling a production meeting.",
    },
    {
      type: "recommendation",
      icon: Target,
      title: "Growth Opportunity",
      message:
        `${stats?.growingCooperatives ?? 3} cooperatives are ready for expansion based on their consistent performance.`,
    },
  ];

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>

      <div className="grid grid-cols-4 gap-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-[#2D6A4F]/10 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2D6A4F]" />
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-1">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              {card.change && <p className="mt-1 text-xs text-gray-500">{card.change}</p>}
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">AI-Powered Insights</h2>
        <div className="space-y-4">
          {aiInsights.map((insight, index) => {
            const Icon = insight.icon;
            const bgColor = insight.type === "warning" ? "bg-yellow-50" : "bg-blue-50";
            const iconColor = insight.type === "warning" ? "text-yellow-600" : "text-blue-600";

            return (
              <div key={index} className={`p-4 ${bgColor} rounded-lg`}>
                <div className="flex gap-3">
                  <Icon className={`w-5 h-5 ${iconColor} mt-1`} />
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">{insight.title}</h3>
                    <p className="text-sm text-gray-700">{insight.message}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Overview</h2>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
          <p className="text-gray-500">Platform Analytics Chart</p>
        </div>
      </div>
    </div>
  );
}
