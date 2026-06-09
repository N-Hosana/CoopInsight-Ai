import { useState, useMemo } from "react";
import {
  Shield, Lock, AlertTriangle, CheckCircle, Activity, User,
  FileText, Download, Send, Filter, Clock, Database, X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";

// ─── Static data ────────────────────────────────────────────────────────────

const allAuditLogs = [
  { id: 1, user: "John Anderson", role: "admin", action: "Exported financial report", target: "Q1 2026 Report", category: "report", timestamp: "2026-04-28 14:35", ip: "197.243.12.45", status: "success" },
  { id: 2, user: "David Mugisha", role: "manager", action: "Created new loan record", target: "Loan ID: 5678", category: "financial", timestamp: "2026-04-28 14:20", ip: "41.210.152.88", status: "success" },
  { id: 3, user: "Unknown", role: "—", action: "Failed login attempt", target: "admin@coop.rw", category: "login", timestamp: "2026-04-28 13:45", ip: "103.45.78.90", status: "failed" },
  { id: 4, user: "John Anderson", role: "admin", action: "Updated member information", target: "Member ID: 1234", category: "member", timestamp: "2026-04-28 12:30", ip: "197.243.12.45", status: "success" },
  { id: 5, user: "Sarah Johnson", role: "member", action: "Viewed financial summary", target: "Q1 2026 Summary", category: "financial", timestamp: "2026-04-28 11:00", ip: "41.210.100.22", status: "success" },
  { id: 6, user: "David Mugisha", role: "manager", action: "Modified member data", target: "Member ID: 2201", category: "member", timestamp: "2026-04-27 16:45", ip: "41.210.152.88", status: "success" },
  { id: 7, user: "Dr. Alice Uwase", role: "government", action: "Generated compliance report", target: "Compliance Q1 2026", category: "report", timestamp: "2026-04-27 15:00", ip: "196.12.45.67", status: "success" },
  { id: 8, user: "John Anderson", role: "admin", action: "Configured data retention policy", target: "Policy: 7 years", category: "security", timestamp: "2026-04-27 10:20", ip: "197.243.12.45", status: "success" },
  { id: 9, user: "Unknown", role: "—", action: "Failed login attempt", target: "manager@greenvalley.coop", category: "login", timestamp: "2026-04-26 22:10", ip: "185.220.101.5", status: "failed" },
  { id: 10, user: "Gasabo General Manager", role: "generalManager", action: "Exported member list", target: "All Members CSV", category: "report", timestamp: "2026-04-26 14:00", ip: "41.210.200.10", status: "success" },
];

const loginActivity = [
  { user: "John Anderson", role: "admin", lastLogin: "2026-04-28 14:30", device: "Chrome on Windows", location: "Kigali, Rwanda", status: "active" },
  { user: "David Mugisha", role: "manager", lastLogin: "2026-04-28 14:15", device: "Safari on iPhone", location: "Huye, Rwanda", status: "active" },
  { user: "Sarah Johnson", role: "member", lastLogin: "2026-04-28 10:20", device: "Firefox on Ubuntu", location: "Musanze, Rwanda", status: "inactive" },
  { user: "Dr. Alice Uwase", role: "government", lastLogin: "2026-04-27 09:00", device: "Edge on Windows", location: "Kigali, Rwanda", status: "inactive" },
];

const anomalyAlerts = [
  { id: "an1", title: "Unusual Transaction Volume", description: "TXN-2026-003 is 3.2x above average — possible fraud", severity: "high", time: "2026-04-28 14:35", resolved: false },
  { id: "an2", title: "Multiple Failed Logins", description: "3 failed attempts from IP 103.45.78.90 within 5 minutes", severity: "high", time: "2026-04-28 13:45", resolved: false },
  { id: "an3", title: "Off-hours Data Export", description: "Large member data export at 22:10 from unknown IP", severity: "medium", time: "2026-04-26 22:10", resolved: true },
];

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

export function SecurityAudit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState("");

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
      const matchSearch = !searchQuery || log.user.toLowerCase().includes(searchQuery.toLowerCase()) || log.action.toLowerCase().includes(searchQuery.toLowerCase()) || log.target.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchStatus && matchSearch;
    });
  }, [categoryFilter, statusFilter, searchQuery]);

  const handleExportAuditTrail = () => {
    const csv = [
      ["ID", "User", "Role", "Action", "Target", "Category", "Timestamp", "IP", "Status"],
      ...filteredLogs.map((l) => [l.id, l.user, l.role, l.action, l.target, l.category, l.timestamp, l.ip, l.status]),
    ].map((r) => r.join(",")).join("\n");
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
  const failedLogins = allAuditLogs.filter((l) => l.category === "login" && l.status === "failed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Security & Audit</h1>
          <p className="text-gray-600 mt-1">Admin-only security monitoring, audit logs, and anomaly detection</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportAuditTrail} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
            <Download className="w-4 h-4" /> Export Audit Trail
          </button>
          <button onClick={() => setShowMessageModal(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
            <Send className="w-4 h-4" /> Send Security Alert
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Security Score", value: "94/100", icon: Shield, bg: "bg-green-50", color: "text-green-600" },
          { label: "Active Sessions", value: loginActivity.filter((l) => l.status === "active").length.toString(), icon: Activity, bg: "bg-blue-50", color: "text-blue-600" },
          { label: "Failed Logins (7d)", value: failedLogins.toString(), icon: Lock, bg: "bg-red-50", color: "text-red-600" },
          { label: "Unresolved Anomalies", value: unresolvedAnomalies.toString(), icon: AlertTriangle, bg: "bg-yellow-50", color: "text-yellow-600" },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
              <div className={`${m.bg} p-3 rounded-lg inline-block mb-3`}><Icon className={`w-5 h-5 ${m.color}`} /></div>
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
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-5 py-4 font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? "text-[#2D6A4F] border-b-2 border-[#2D6A4F]" : "text-gray-600 hover:text-gray-900"}`}>
                  <Icon className="w-4 h-4" />{tab.label}
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
                      {p.ok ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Recent Security Events</h3>
                <div className="space-y-2">
                  {allAuditLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${log.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{log.action}</p>
                        <p className="text-xs text-gray-500">{log.user} · {log.timestamp}</p>
                      </div>
                    </div>
                  ))}
                </div>
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
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search logs..." className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#2563EB]" />
              </div>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]">
                <option value="all">All Categories</option>
                <option value="financial">Financial</option>
                <option value="member">Member</option>
                <option value="login">Login</option>
                <option value="report">Report</option>
                <option value="security">Security</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]">
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
              <span className="text-sm text-gray-500">{filteredLogs.length} entries</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["User", "Role", "Action", "Target", "Category", "Timestamp", "IP", "Status"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2"><User className="w-3 h-3 text-gray-400" />{log.user}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{log.role}</td>
                      <td className="px-4 py-3 text-gray-900">{log.action}</td>
                      <td className="px-4 py-3 text-gray-600">{log.target}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[log.category] || "bg-gray-100 text-gray-700"}`}>{log.category}</span></td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap"><Clock className="w-3 h-3 inline mr-1" />{log.timestamp}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.ip}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${log.status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{log.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* LOGIN ACTIVITY */}
        {activeTab === "login" && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Login Activity Monitor</h3>
            <div className="space-y-3">
              {loginActivity.map((a, i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{a.user}</p>
                      <p className="text-xs text-gray-500 capitalize">{a.role}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${a.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{a.status}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm text-gray-600">
                    <div><p className="text-xs text-gray-400">Last Login</p><p>{a.lastLogin}</p></div>
                    <div><p className="text-xs text-gray-400">Device</p><p>{a.device}</p></div>
                    <div><p className="text-xs text-gray-400">Location</p><p>{a.location}</p></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <h3 className="font-semibold text-gray-900 mb-3">Failed Login Attempts</h3>
              <div className="space-y-2">
                {allAuditLogs.filter((l) => l.status === "failed").map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{log.target}</p>
                      <p className="text-xs text-gray-500">{log.timestamp} · IP: {log.ip}</p>
                    </div>
                    <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Failed</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ANOMALY ALERTS */}
        {activeTab === "anomalies" && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Anomaly Detection Alerts</h3>
            <div className="space-y-3">
              {anomalyAlerts.map((a) => (
                <div key={a.id} className={`p-4 rounded-lg border-2 ${a.severity === "high" ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{a.title}</h4>
                      <p className="text-sm text-gray-700 mt-0.5">{a.description}</p>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{a.time}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${a.severity === "high" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{a.severity.toUpperCase()}</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${a.resolved ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>{a.resolved ? "Resolved" : "Active"}</span>
                    </div>
                  </div>
                  {!a.resolved && (
                    <button onClick={() => setShowMessageModal(true)} className="mt-2 flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">
                      <Send className="w-3 h-3" /> Send Alert to Users
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ENCRYPTION & RETENTION */}
        {activeTab === "encryption" && (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Lock className="w-4 h-4" /> Data Encryption Status</h3>
              <div className="space-y-2">
                {encryptionStatus.map((e) => (
                  <div key={e.label} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-700">{e.label}</span>
                    {e.status === "active" ? (
                      <span className="flex items-center gap-1 text-green-700 text-xs font-medium"><CheckCircle className="w-4 h-4" /> Active</span>
                    ) : (
                      <span className="flex items-center gap-1 text-yellow-700 text-xs font-medium"><AlertTriangle className="w-4 h-4" /> Warning</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Database className="w-4 h-4" /> Data Retention Policy Configuration</h3>
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
                        <td className="px-4 py-3"><span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">{p.status}</span></td>
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
              <button onClick={() => setShowMessageModal(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
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
                <button onClick={() => setShowMessageModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button onClick={handleSendSecurityMessage} disabled={!messageText.trim()} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
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
