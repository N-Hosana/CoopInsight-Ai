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
  AreaChart,
  Area,
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
        const [statsRes, activitiesRes, alertsRes] = await Promise.all([
          api.get<any>("/dashboard/stats"),
          api.get<any>("/dashboard/recent-activity"),
          api.get<any>("/dashboard/alerts"),
        ]);
        setStats((statsRes as any)?.data ?? statsRes);
        setActivities((activitiesRes as any)?.data ?? []);
        setFinancialTrends([]);
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

  const summaryCards = [
    {
      title: "Total Members",
      value: loading ? "..." : (stats?.totalMembers ?? 0).toLocaleString(),
      change: loading ? "" : `+${stats?.monthlyGrowth ?? 0}%`,
      trend: "up",
      icon: Users,
    },
    {
      title: "Monthly Revenue",
      value: loading ? "..." : `${(stats?.totalSavings ?? 0).toLocaleString()}RWF`,
      change: loading ? "" : `+${stats?.monthlyGrowth ?? 0}%`,
      trend: "up",
      icon: DollarSign,
    },
    {
      title: "Total Savings",
      value: loading ? "..." : `${(stats?.totalSavings ?? 0).toLocaleString()}RWF`,
      change: loading ? "" : "+12%",
      trend: "up",
      icon: PiggyBank,
    },
    {
      title: "Active Loans",
      value: loading ? "..." : `${(stats?.totalLoans ?? 0).toLocaleString()}RWF`,
      change: loading ? "" : "+5%",
      trend: "up",
      icon: CreditCard,
    },
  ];

  const trendData =
    financialTrends.length > 0
      ? financialTrends.map((t: any) => ({
          month: t.month,
          revenue: t.income,
          savings: t.savings,
        }))
      : [
          { month: "Jan", revenue: 105, savings: 72 },
          { month: "Feb", revenue: 120, savings: 80 },
          { month: "Mar", revenue: 135, savings: 88 },
          { month: "Apr", revenue: 150, savings: 97 },
          { month: "May", revenue: 162, savings: 105 },
          { month: "Jun", revenue: 175, savings: 112 },
        ];

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
                <div className="p-3 bg-blue-50 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2563EB]" />
                </div>
                {card.change && (
                  <span className="text-sm font-medium text-green-600">{card.change}</span>
                )}
              </div>
              <p className="text-sm text-gray-600 mb-1">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Trends</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Line type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="savings" stroke="#10B981" strokeWidth={3} dot={{ r: 3 }} />
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
              <>
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-900">Loan Payment Due</p>
                  <p className="text-xs text-gray-600">3 members tomorrow</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-gray-900">Meeting Reminder</p>
                  <p className="text-xs text-gray-600">May 5, 10:00 AM</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-[#2563EB] to-[#1d4ed8] rounded-xl p-6 text-white">
        <div className="flex items-start gap-4">
          <Lightbulb className="w-8 h-8" />
          <div>
            <h3 className="font-semibold mb-2">AI Recommendation</h3>
            <p className="text-blue-100 mb-3">
              Member engagement is 23% above average. Consider expanding training programs to maintain growth momentum.
            </p>
            <button
              onClick={() => navigate("/ai-insights")}
              className="px-4 py-2 bg-white text-[#2563EB] rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
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
            [
              { member: "Jean Uwimana", action: "Contribution Payment", amount: "50,000RWF", time: "2 hours ago" },
              { member: "Marie Mukamana", action: "Loan Disbursement", amount: "200,000RWF", time: "5 hours ago" },
              { member: "Peter Habimana", action: "Savings Deposit", amount: "75,000RWF", time: "1 day ago" },
            ].map((activity, index) => (
              <div
                key={index}
                onClick={() => navigate(`/activities/${index + 1}`)}
                className="p-6 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{activity.member}</p>
                    <p className="text-sm text-gray-600">{activity.action}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{activity.amount}</p>
                    <p className="text-xs text-gray-500">{activity.time}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function GovernmentDashboard({ announcements }: { announcements: SystemAnnouncement[] }) {
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

      <div>
        <h1 className="text-3xl font-bold text-gray-900">RCA Monitoring Dashboard</h1>
        <p className="text-gray-600 mt-1">Gasabo District — cooperative performance overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2563EB]" />
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
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
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
            className="text-sm text-blue-600 hover:underline"
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

function MemberDashboard({ user, announcements }: { user: any; announcements: SystemAnnouncement[] }) {
  const navigate = useNavigate();
  const [coopStats, setCoopStats] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [memberRecord, setMemberRecord] = useState<any>(null);
  const [memLoading, setMemLoading] = useState(true);

  useEffect(() => {
    const fetchMemberData = async () => {
      try {
        const [statsRes, activityRes, membersRes] = await Promise.all([
          api.get<any>("/dashboard/stats"),
          api.get<any>("/dashboard/recent-activity?limit=5"),
          api.get<any>("/members?page=1&limit=100"),
        ]);
        setCoopStats((statsRes as any)?.data);
        setRecentActivity((activityRes as any)?.data ?? []);
        // Find this user's member record by email
        const allMembers: any[] = (membersRes as any)?.data ?? [];
        const mine = allMembers.find((m: any) => m.email === user?.email || m.full_name === user?.name);
        setMemberRecord(mine ?? null);
      } catch (err) {
        console.error("Member dashboard fetch error:", err);
      } finally {
        setMemLoading(false);
      }
    };
    fetchMemberData();
  }, [user]);

  const savings = memberRecord?.total_savings ?? memberRecord?.totalSavings ?? 0;

  const performanceMetrics = { score: 87, engagement: 92, loanRepayment: 100, savingsGrowth: 15, participationRate: 89 };

  const performanceData = [
    { month: "Jan", score: 72, engagement: 78, savings: 35 },
    { month: "Feb", score: 75, engagement: 82, savings: 42 },
    { month: "Mar", score: 79, engagement: 86, savings: 48 },
    { month: "Apr", score: 83, engagement: 89, savings: 56 },
    { month: "May", score: 87, engagement: 92, savings: 65 },
    { month: "Jun", score: 89, engagement: 94, savings: 72 },
  ];

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (score: number) => {
    if (score >= 85) return "bg-green-50";
    if (score >= 70) return "bg-yellow-50";
    return "bg-red-50";
  };

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Member Dashboard</h1>
        <p className="text-gray-600 mt-1">{user.cooperativeName}</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-green-50 rounded-lg inline-block mb-3">
            <DollarSign className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Total Members (Coop)</p>
          <p className="text-2xl font-bold text-gray-900">
            {memLoading ? "…" : (coopStats?.totalMembers ?? 0).toLocaleString()}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-blue-50 rounded-lg inline-block mb-3">
            <TrendingUp className="w-6 h-6 text-blue-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Upcoming Activities</p>
          <p className="text-2xl font-bold text-gray-900">
            {memLoading ? "…" : (coopStats?.upcomingActivities ?? 0)}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-purple-50 rounded-lg inline-block mb-3">
            <PiggyBank className="w-6 h-6 text-purple-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">My Savings</p>
          <p className="text-2xl font-bold text-gray-900">
            {memLoading ? "…" : `${Number(savings).toLocaleString()} RWF`}
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-orange-50 rounded-lg inline-block mb-3">
            <CreditCard className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Coop Total Savings</p>
          <p className="text-2xl font-bold text-gray-900">
            {memLoading ? "…" : `${(coopStats?.totalSavings ?? 0).toLocaleString()} RWF`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Analytics</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Line type="monotone" dataKey="score" stroke="#2563EB" strokeWidth={3} dot={{ r: 3 }} name="Performance Score" />
                <Line type="monotone" dataKey="engagement" stroke="#10B981" strokeWidth={3} dot={{ r: 3 }} name="Engagement %" />
                <Line type="monotone" dataKey="savings" stroke="#F59E0B" strokeWidth={3} dot={{ r: 3 }} name="Savings Growth %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          <div className={`${getScoreBg(performanceMetrics.score)} rounded-xl p-6 border border-gray-200`}>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Overall Performance Score</p>
              <p className={`text-4xl font-bold ${getScoreColor(performanceMetrics.score)}`}>{performanceMetrics.score}/100</p>
              <p className="text-xs text-gray-500 mt-2">Excellent standing member</p>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-3">
            <h3 className="font-semibold text-gray-900 mb-4">Performance Metrics</h3>

            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm text-gray-600">Engagement Rate</p>
                <p className="text-sm font-semibold text-gray-900">{performanceMetrics.engagement}%</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: `${performanceMetrics.engagement}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm text-gray-600">Loan Repayment Rate</p>
                <p className="text-sm font-semibold text-gray-900">{performanceMetrics.loanRepayment}%</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${performanceMetrics.loanRepayment}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm text-gray-600">Participation Rate</p>
                <p className="text-sm font-semibold text-gray-900">{performanceMetrics.participationRate}%</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${performanceMetrics.participationRate}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm text-gray-600">Savings Growth (YoY)</p>
                <p className="text-sm font-semibold text-gray-900">{performanceMetrics.savingsGrowth}%</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-orange-600 h-2 rounded-full" style={{ width: `${Math.min(performanceMetrics.savingsGrowth * 2, 100)}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Cooperative Activity</h2>
          <button onClick={() => navigate("/activities")} className="text-sm text-blue-600 hover:underline">
            View all →
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {recentActivity.length > 0 ? recentActivity.map((item: any, index: number) => (
            <div key={item.id ?? index} className="py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.title ?? item.description}</p>
                <p className="text-xs text-gray-500 capitalize">{item.entity_type === "member" ? "New member" : item.sub_type ?? item.entity_type}</p>
              </div>
              <div className="text-right">
                {item.amount != null && (
                  <p className="text-sm font-semibold text-gray-900">{Number(item.amount).toLocaleString()} RWF</p>
                )}
                <p className="text-xs text-gray-400">
                  {item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}
                </p>
              </div>
            </div>
          )) : (
            <p className="text-gray-400 text-sm text-center py-8">No recent activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({
  announcements,
  stats,
  activities,
  financialTrends,
  notifications,
  loading,
  error,
}: { announcements: SystemAnnouncement[] } & DashboardDataProps) {
  const summaryCards = [
    {
      title: "Total Cooperatives",
      value: loading ? "..." : (stats?.totalCooperatives ?? 0).toLocaleString(),
      change: loading ? "" : `+${stats?.monthlyGrowth ?? 0}%`,
      trend: "up",
      icon: Building2,
    },
    {
      title: "Total Members",
      value: loading ? "..." : (stats?.totalMembers ?? 0).toLocaleString(),
      change: loading ? "" : "+8%",
      trend: "up",
      icon: Users,
    },
    {
      title: "Total Activities",
      value: loading ? "..." : (activities.length).toLocaleString(),
      change: loading ? "" : "+15%",
      trend: "up",
      icon: Activity,
    },
    {
      title: "Total Revenue",
      value: loading ? "..." : `${(stats?.totalSavings ?? 0).toLocaleString()}RWF`,
      change: loading ? "" : "+24%",
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
                <div className="p-3 bg-blue-50 rounded-lg">
                  <Icon className="w-6 h-6 text-[#2563EB]" />
                </div>
                {card.change && (
                  <span className="text-sm font-medium text-green-600">{card.change}</span>
                )}
              </div>
              <p className="text-sm text-gray-600 mb-1">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
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
