import { useState, useEffect, useMemo } from "react";
import {
  Shield, Lock, AlertTriangle, CheckCircle, Activity, User,
  FileText, Download, Send, Filter, Clock, Database, X, RefreshCw,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";
import { api } from "../services/api";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface AuditLog {
  id: number | string;
  user: string;
  role: string;
  action: string;
  target: string;
  category: string;
  timestamp: string;
  ip: string;
  status: "success" | "failed";
}

interface LoginActivity {
  user: string;
  role: string;
  lastLogin: string;
  device: string;
  location: string;
  status: "active" | "inactive";
}

interface AnomalyAlert {
  id: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  time: string;
  resolved: boolean;
}

// ─── Static data (encryption / retention stay static) ───────────────────────

const encryptionStatus = [
  { label: "Database Encryption (AES-256)", status: "active" },
  { label: "Data in Transit (TLS 1.3)", status: "active" },
  { label: "Backup Encryption", status: "active" },
  { label: "API Key Encryption", status: "active" },
  { label: "File Storage Encryption", status: "warning" },
];

const retentionPolicies = [
  { dataType: "Financial Transactions", retention: "7 years", status: "enforced" },
  { dataType: "Member Data", retention: "5 years after exit", status: "enforced" },
  { dataType: "Audit Logs", retention: "10 years", status: "enforced" },
  { dataType: "Compliance Documents", retention: "10 years", status: "enforced" },
  { dataType: "Login Activity", retention: "2 years", status: "enforced" },
];

const categoryColors: Record<string, string> = {
  financial: "bg-blue-100 text-blue-800",
  member: "bg-purple-100 text-purple-800",
  login: "bg-red-100 text-red-800",
  report: "bg-green-100 text-green-800",
  security: "bg-orange-100 text-orange-800",
};

const tabs = [
  { id: "overview", label: "Overview", icon: Shield },
  { id: "audit", label: "Audit Log", icon: FileText },
  { id: "login", label: "Login Activity", icon: Activity },
  { id: "anomalies", label: "Anomaly Alerts", icon: AlertTriangle },
  { id: "encryption", label: "Encryption & Retention", icon: Lock },
];

// ─── Helper: map raw API log shapes to AuditLog ──────────────────────────────

function mapLog(raw: any): AuditLog {
  return {
    id: raw.id ?? raw._id ?? Math.random(),
    user: raw.user_name ?? raw.user ?? "Unknown",
    role: raw.role ?? "—",
    action: raw.action ?? "",
    target: raw.details ?? raw.target ?? "",
    category: raw.category ?? (raw.action?.toLowerCase().includes("login") ? "login" : "security"),
    timestamp: raw.created_at
      ? new Date(raw.created_at).toLocaleString()
      : raw.timestamp ?? "",
    ip: raw.ip_address ?? raw.ip ?? "",
    status: raw.success === false ? "failed" : raw.status === "failed" ? "failed" : "success",
  };
}

function mapLoginActivity(raw: any): LoginActivity {
  return {
    user: raw.user_name ?? raw.user ?? "Unknown",
    role: raw.role ?? "—",
    lastLogin: raw.created_at
      ? new Date(raw.created_at).toLocaleString()
      : raw.lastLogin ?? "",
    device: raw.user_agent ?? raw.device ?? "—",
    location: raw.location ?? "—",
    status: raw.success !== false ? "active" : "inactive",
  };
}

function mapAnomaly(raw: any): AnomalyAlert {
  return {
    id: String(raw.id ?? raw._id ?? Math.random()),
    title: raw.type ?? raw.title ?? "Anomaly Detected",
    description: raw.description ?? "",
    severity: raw.severity ?? "medium",
    time: raw.detected_at
      ? new Date(raw.detected_at).toLocaleString()
      : raw.time ?? "",
    resolved: raw.resolved ?? false,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SecurityAudit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState("");

  // ─── API state ──────────────────────────────────────────────────────────
  const [allAuditLogs, setAllAuditLogs] = useState<AuditLog[]>([]);
  const [loginActivity, setLoginActivity] = useState<LoginActivity[]>([]);
  const [anomalyAlerts, setAnomalyAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsRes, anomaliesRes, loginRes] = await Promise.all([
        api.get<{ logs: any[]; total: number }>("/security/audit-logs?page=1&limit=50&action=&user_id="),
        api.get<{ anomalies: any[] }>("/security/anomalies"),
        api.get<{ activity: any[] }>("/security/login-activity"),
      ]);

      setAllAuditLogs((logsRes.logs ?? []).map(mapLog));
      setAnomalyAlerts((anomaliesRes.anomalies ?? []).map(mapAnomaly));
      setLoginActivity((loginRes.activity ?? []).map(mapLoginActivity));
    } catch (err: any) {
      setError(err?.message ?? "Failed to load security data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Admin-only guard
  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700">Access Restricted</h2>
          <p className="text-gray-500 mt-2">Security & Audit is only accessible to system administrators.</p>
        </div>
      </div>
    );
  }

  const filteredLogs = useMemo(() => {
    return allAuditLogs.filter((log) => {
      const matchCat = categoryFilter === "all" || log.category === categoryFilter;
      const matchStatus = statusFilter === "all" || log.status === statusFilter;
      const matchSearch =
        !searchQuery ||
        log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.target.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchStatus && matchSearch;
    });
  }, [allAuditLogs, categoryFilter, statusFilter, searchQuery]);

  const handleExportAuditTrail = () => {
    const csv = [
      ["ID", "User", "Role", "Action", "Target", "Category", "Timestamp", "IP", "Status"],
      ...filteredLogs.map((l) => [l.id, l.user, l.role, l.action, l.target, l.category, l.timestamp, l.ip, l.status]),
    ]
      .map((r) => r.join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSendSecurityMessage = () => {
    if (!messageText.trim()) return;
    navigate("/messages", { state: { openCompose: true, type: "broadcast", prefill: messageText } });
    setShowMessageModal(false);
    setMessageText("");
  };

  const unresolvedAnomalies = anomalyAlerts.filter((a) => !a.resolved).length;
  const failedLogins = allAuditLogs.filter((l) => l.status === "failed").length;
  const activeSessions = loginActivity.filter((l) => l.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Security & Audit</h1>
          <p className="text-gray-600 mt-1">Admin-only security monitoring, audit logs, and anomaly detection</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={handleExportAuditTrail}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
          >
            <Download className="w-4 h-4" /> Export Audit Trail
          </button>
          <button
            onClick={() => setShowMessageModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
          >
            <Send className="w-4 h-4" /> Send Security Alert
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Security Score", value: "94/100", icon: Shield, bg: "bg-green-50", color: "text-green-600" },
          { label: "Active Sessions", value: activeSessions.toString(), icon: Activity, bg: "bg-blue-50", color: "text-blue-600" },
          { label: "Failed Logins (7d)", value: failedLogins.toString(), icon: Lock, bg: "bg-red-50", color: "text-red-600" },
          { label: "Unresolved Anomalies", value: unresolvedAnomalies.toString(), icon: AlertTriangle, bg: "bg-yellow-50", color: "text-yellow-600" },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
              <div className={`${m.bg} p-3 rounded-lg inline-block mb-3`}>
                <Icon className={`w-5 h-5 ${m.color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{m.value}</p>
              <p className="text-sm text-gray-600 mt-1">{m.label}</p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200 overflow-x-auto">
          <div className="flex min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-4 font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? "text-[#2D6A4F] border-b-2 border-[#2D6A4F]"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Security Policy Status</h3>
                <div className="space-y-2">
                  {[
                    { label: "Data Encryption", ok: true },
                    { label: "Login Activity Monitoring", ok: true },
                    { label: "Audit Log Recording", ok: true },
                    { label: "Anomaly Detection", ok: true },
                    { label: "Data Retention Policy", ok: true },
                    { label: "Two-Factor Authentication", ok: false },
                    { label: "File Storage Encryption", ok: false },
                  ].map((p) => (
                    <div key={p.label} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700">{p.label}</span>
                      {p.ok ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-yellow-500" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Recent Security Events</h3>
                {loading ? (
                  <p className="text-sm text-gray-500">Loading events...</p>
                ) : (
                  <div className="space-y-2">
                    {allAuditLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <div
                          className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                            log.status === "success" ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{log.action}</p>
                          <p className="text-xs text-gray-500">
                            {log.user} · {log.timestamp}
                          </p>
                        </div>
                      </div>
                    ))}
                    {allAuditLogs.length === 0 && (
                      <p className="text-sm text-gray-500">No recent events found.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* AUDIT LOG */}
        {activeTab === "audit" && (
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="relative flex-1 min-w-48">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search logs..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="all">All Categories</option>
                <option value="financial">Financial</option>
                <option value="member">Member</option>
                <option value="login">Login</option>
                <option value="report">Report</option>
                <option value="security">Security</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
              <span className="text-sm text-gray-500">{filteredLogs.length} entries</span>
            </div>
            {loading ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="w-6 h-6 text-[#2563EB] animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {["User", "Role", "Action", "Target", "Category", "Timestamp", "IP", "Status"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                          <User className="w-3 h-3 text-gray-400" />
                          {log.user}
                        </td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{log.role}</td>
                        <td className="px-4 py-3 text-gray-900">{log.action}</td>
                        <td className="px-4 py-3 text-gray-600">{log.target}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[log.category] || "bg-gray-100 text-gray-700"}`}>
                            {log.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {log.timestamp}
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.ip}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              log.status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                          No log entries match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* LOGIN ACTIVITY */}
        {activeTab === "login" && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Login Activity Monitor</h3>
            {loading ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="w-6 h-6 text-[#2563EB] animate-spin" />
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {loginActivity.map((a, i) => (
                    <div key={i} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{a.user}</p>
                          <p className="text-xs text-gray-500 capitalize">{a.role}</p>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            a.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {a.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm text-gray-600">
                        <div>
                          <p className="text-xs text-gray-400">Last Login</p>
                          <p>{a.lastLogin}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Device</p>
                          <p className="truncate">{a.device}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Location</p>
                          <p>{a.location}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {loginActivity.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No login activity data available.</p>
                  )}
                </div>
                <div className="mt-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Failed Login Attempts</h3>
                  <div className="space-y-2">
                    {allAuditLogs.filter((l) => l.status === "failed").map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{log.target || log.action}</p>
                          <p className="text-xs text-gray-500">
                            {log.timestamp} · IP: {log.ip}
                          </p>
                        </div>
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Failed</span>
                      </div>
                    ))}
                    {allAuditLogs.filter((l) => l.status === "failed").length === 0 && (
                      <p className="text-sm text-gray-500">No failed login attempts found.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ANOMALY ALERTS */}
        {activeTab === "anomalies" && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Anomaly Detection Alerts</h3>
            {loading ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="w-6 h-6 text-[#2563EB] animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                {anomalyAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={`p-4 rounded-lg border-2 ${
                      a.severity === "high" ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-gray-900">{a.title}</h4>
                        <p className="text-sm text-gray-700 mt-0.5">{a.description}</p>
                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {a.time}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-bold ${
                            a.severity === "high" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {a.severity.toUpperCase()}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            a.resolved ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {a.resolved ? "Resolved" : "Active"}
                        </span>
                      </div>
                    </div>
                    {!a.resolved && (
                      <button
                        onClick={() => setShowMessageModal(true)}
                        className="mt-2 flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                      >
                        <Send className="w-3 h-3" /> Send Alert to Users
                      </button>
                    )}
                  </div>
                ))}
                {anomalyAlerts.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No anomaly alerts found.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ENCRYPTION & RETENTION */}
        {activeTab === "encryption" && (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Lock className="w-4 h-4" /> Data Encryption Status
              </h3>
              <div className="space-y-2">
                {encryptionStatus.map((e) => (
                  <div
                    key={e.label}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <span className="text-sm text-gray-700">{e.label}</span>
                    {e.status === "active" ? (
                      <span className="flex items-center gap-1 text-green-700 text-xs font-medium">
                        <CheckCircle className="w-4 h-4" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-yellow-700 text-xs font-medium">
                        <AlertTriangle className="w-4 h-4" /> Warning
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Database className="w-4 h-4" /> Data Retention Policy Configuration
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Data Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Retention Period</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {retentionPolicies.map((p) => (
                      <tr key={p.dataType} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.dataType}</td>
                        <td className="px-4 py-3 text-gray-700">{p.retention}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Send Security Alert Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">Send Security Alert Message</h3>
              <button onClick={() => setShowMessageModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                This message will be broadcast to all users as a security alert.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Alert Message</label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  rows={4}
                  placeholder="Describe the security issue and required actions..."
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowMessageModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendSecurityMessage}
                  disabled={!messageText.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" /> Send Alert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
