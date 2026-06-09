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

  useEffect(() => {
    localStorage.setItem(
      "coopinsight_dashboard",
      JSON.stringify({
        timestamp: new Date().toISOString(),
      })
    );
  }, []);

  if (user?.role === "manager") {
    return <ManagerDashboard announcements={systemAnnouncements} />;
  }

  if (user?.role === "government") {
    return <GovernmentDashboard announcements={systemAnnouncements} />;
  }

  if (user?.role === "member") {
    return <MemberDashboard user={user} announcements={systemAnnouncements} />;
  }

  return <AdminDashboard announcements={systemAnnouncements} />;
}

function ManagerDashboard({ announcements }: { announcements: SystemAnnouncement[] }) {
  const navigate = useNavigate();

  const summaryCards = [
    { title: "Total Members", value: "145", change: "+8%", trend: "up", icon: Users },
    { title: "Monthly Revenue", value: "12,450,000RWF", change: "+15%", trend: "up", icon: DollarSign },
    { title: "Total Savings", value: "8,230,000RWF", change: "+12%", trend: "up", icon: PiggyBank },
    { title: "Active Loans", value: "3,120,000RWF", change: "+5%", trend: "up", icon: CreditCard },
  ];

  const managerTrendData = [
    { month: "Jan", revenue: 105, savings: 72 },
    { month: "Feb", revenue: 120, savings: 80 },
    { month: "Mar", revenue: 135, savings: 88 },
    { month: "Apr", revenue: 150, savings: 97 },
    { month: "May", revenue: 162, savings: 105 },
    { month: "Jun", revenue: 175, savings: 112 },
  ];

  const recentActivities = [
    { member: "Jean Uwimana", action: "Contribution Payment", amount: "50,000RWF", time: "2 hours ago" },
    { member: "Marie Mukamana", action: "Loan Disbursement", amount: "200,000RWF", time: "5 hours ago" },
    { member: "Peter Habimana", action: "Savings Deposit", amount: "75,000RWF", time: "1 day ago" },
  ];

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
          <p className="text-gray-600 mt-1">Green Valley Farmers Cooperative</p>
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
                <span className="text-sm font-medium text-green-600">{card.change}</span>
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
              <LineChart data={managerTrendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
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
            <div className="p-3 bg-yellow-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900">Loan Payment Due</p>
              <p className="text-xs text-gray-600">3 members tomorrow</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900">Meeting Reminder</p>
              <p className="text-xs text-gray-600">May 5, 10:00 AM</p>
            </div>
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
          {recentActivities.map((activity, index) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}

function GovernmentDashboard({ announcements }: { announcements: SystemAnnouncement[] }) {
  const nationalStats = [
    { label: "Total Cooperatives", value: "2,847", icon: Building2 },
    { label: "Total Members", value: "145,832", icon: Users },
    { label: "Compliant", value: "93%", icon: CheckCircle },
    { label: "Avg Performance", value: "84/100", icon: BarChart3 },
  ];

  const topPerformers = [
    { name: "Green Valley Farmers", district: "Huye", score: 94 },
    { name: "Sunrise Dairy Coop", district: "Nyagatare", score: 92 },
    { name: "Terimbere Coffee", district: "Huye", score: 89 },
  ];

  const complianceIssues = [
    { cooperative: "Imbaraga Crafts", issue: "Missing Financial Report", severity: "High" },
    { cooperative: "Abadahemuka Dairy", issue: "Incomplete Member Registry", severity: "Medium" },
  ];

  const governmentTrendData = [
    { month: "Jan", score: 76, compliance: 82 },
    { month: "Feb", score: 79, compliance: 84 },
    { month: "Mar", score: 82, compliance: 86 },
    { month: "Apr", score: 85, compliance: 88 },
    { month: "May", score: 87, compliance: 90 },
    { month: "Jun", score: 89, compliance: 92 },
  ];

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Government Monitoring Dashboard</h1>
        <p className="text-gray-600 mt-1">National cooperative performance overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {nationalStats.map((stat) => {
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Cooperative Performance Trend</h2>
          <div className="h-72 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={governmentTrendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Area type="monotone" dataKey="score" stroke="#2563EB" fill="#BFDBFE" fillOpacity={0.6} />
                <Area type="monotone" dataKey="compliance" stroke="#16A34A" fill="#A7F3D0" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Performing Cooperatives</h2>
          <div className="space-y-3">
            {topPerformers.map((coop, index) => (
              <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{coop.name}</p>
                  <p className="text-sm text-gray-600">{coop.district}</p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-[#2563EB]">{coop.score}</span>
                  <p className="text-xs text-gray-500">Performance</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Alerts</h2>
          <div className="space-y-3">
            {complianceIssues.map((issue, index) => (
              <div
                key={index}
                className="p-4 border-l-4 border-red-500 bg-red-50 rounded-r-lg"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{issue.cooperative}</p>
                    <p className="text-sm text-gray-700">{issue.issue}</p>
                  </div>
                  <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">
                    {issue.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sector Distribution</h2>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
          <p className="text-gray-500">Sector Analysis Chart</p>
        </div>
      </div>
    </div>
  );
}

function MemberDashboard({ user, announcements }: { user: any; announcements: SystemAnnouncement[] }) {
  const memberData = {
    contributions: "1,250,000RWF",
    dividend: "85,000RWF",
    savings: "450,000RWF",
    loanBalance: "200,000RWF",
  };

  const performanceMetrics = {
    score: 87,
    engagement: 92,
    loanRepayment: 100,
    savingsGrowth: 15,
    participationRate: 89,
  };

  const performanceData = [
    { month: "Jan", score: 72, engagement: 78, savings: 35 },
    { month: "Feb", score: 75, engagement: 82, savings: 42 },
    { month: "Mar", score: 79, engagement: 86, savings: 48 },
    { month: "Apr", score: 83, engagement: 89, savings: 56 },
    { month: "May", score: 87, engagement: 92, savings: 65 },
    { month: "Jun", score: 89, engagement: 94, savings: 72 },
  ];

  const activityHistory = [
    { date: "2026-04-15", activity: "Monthly Meeting", participation: "Attended" },
    { date: "2026-04-01", activity: "Training Workshop", participation: "Attended" },
    { date: "2026-03-20", activity: "Production Day", participation: "Attended" },
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

      <div className="grid grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-green-50 rounded-lg inline-block mb-3">
            <DollarSign className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Total Contributions</p>
          <p className="text-2xl font-bold text-gray-900">{memberData.contributions}</p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-blue-50 rounded-lg inline-block mb-3">
            <TrendingUp className="w-6 h-6 text-blue-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Dividend Earned</p>
          <p className="text-2xl font-bold text-gray-900">{memberData.dividend}</p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-purple-50 rounded-lg inline-block mb-3">
            <PiggyBank className="w-6 h-6 text-purple-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Savings Balance</p>
          <p className="text-2xl font-bold text-gray-900">{memberData.savings}</p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="p-3 bg-orange-50 rounded-lg inline-block mb-3">
            <CreditCard className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-sm text-gray-600 mb-1">Loan Balance</p>
          <p className="text-2xl font-bold text-gray-900">{memberData.loanBalance}</p>
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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity Participation History</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Activity</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Participation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {activityHistory.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{item.date}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{item.activity}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                      {item.participation}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ announcements }: { announcements: SystemAnnouncement[] }) {
  const summaryCards = [
    { title: "Total Cooperatives", value: "2,847", change: "+12%", trend: "up", icon: Building2 },
    { title: "Total Members", value: "145,832", change: "+8%", trend: "up", icon: Users },
    { title: "Total Activities", value: "12,450", change: "+15%", trend: "up", icon: Activity },
    { title: "Total Revenue", value: "456,000,000RWF", change: "+24%", trend: "up", icon: DollarSign },
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
        "3 cooperatives are ready for expansion based on their consistent performance.",
    },
  ];

  return (
    <div className="space-y-6">
      <SystemAnnouncements announcements={announcements} />

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
                <span className="text-sm font-medium text-green-600">{card.change}</span>
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
