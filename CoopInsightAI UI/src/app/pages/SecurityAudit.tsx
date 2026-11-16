import { useState, useEffect, useCallback } from "react";
import {
  Shield, Lock, Unlock, AlertTriangle, CheckCircle, Activity, User, FileText, Download, Send,
  Filter, Clock, Database, X, RefreshCw, ChevronLeft, ChevronRight, XCircle, Monitor,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { downloadPdf } from "../services/pdf";

/*
 * Every number and row on this page comes from the database through
 * /api/security. Nothing is written into the UI: the score, policy ticks,
 * encryption and retention panels that used to be here were constants, and an
 * admin page that reports fixed green ticks is worse than no page.
 */

// ─── Shapes returned by /api/security ────────────────────────────────────────

interface PostureCheck { label: string; ok: boolean; detail: string }

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  oversight_level: string | null;
  cooperative_name: string | null;
  failed_attempts: number;
  locked_until: string | null;
  is_locked: boolean | null;
  has_session: boolean;
  last_login_at: string | null;
  last_ip: string | null;
  last_device: string;
  last_attempt_at: string | null;
  last_attempt_status: string | null;
  failed_7d: number;
}

interface Summary {
  activeSessions: number;
  usersSignedInToday: number;
  successfulLogins7d: number;
  failedLogins7d: number;
  lockedAttempts7d: number;
  unknownAccountAttempts7d: number;
  lockedAccountsNow: number;
  auditEventsToday: number;
  auditEventsTotal: number;
  loginRecordsTotal: number;
  loginRecordsSince: string | null;
  unresolvedAnomalies: number;
  unresolvedBySeverity: Record<string, number>;
  posture: PostureCheck[];
  accounts: AccountRow[];
}

interface AuditRow {
  id: string;
  category: string;
  action: string;
  resource: string;
  resource_id: string | null;
  status: "success" | "failure" | "warning";
  user_name: string | null;
  user_role: string | null;
  user_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: { method?: string; path?: string; statusCode?: number; email?: string } | null;
  created_at: string;
}

interface LoginRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  email: string;
  status: "success" | "failed" | "locked";
  ip_address: string | null;
  device: string;
  attempted_at: string;
}

interface AnomalyRow {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  affected_user_name: string | null;
  affected_user_email: string | null;
  details: Record<string, unknown> | null;
  detected_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution: string | null;
}

interface DbInfo {
  name: string;
  version: string;
  size: string;
  ssl: boolean | null;
  connections: number;
  server_time: string;
  tables: { table: string; rows: number; size: string; bytes: number; oldest: string | null; newest: string | null }[];
}

interface Page<T> { data: T[]; pagination: { page: number; limit: number; total: number } }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");

/** "3 min ago" for recent things, the date for older ones. */
function ago(d: string | null | undefined): string {
  if (!d) return "never";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString();
}

const categoryColors: Record<string, string> = {
  financial: "bg-blue-100 text-blue-800",
  member: "bg-purple-100 text-purple-800",
  login: "bg-red-100 text-red-800",
  report: "bg-green-100 text-green-800",
  security: "bg-orange-100 text-orange-800",
  operations: "bg-gray-100 text-gray-700",
};

const severityStyle: Record<string, { box: string; badge: string }> = {
  critical: { box: "border-red-300 bg-red-50", badge: "bg-red-200 text-red-900" },
  high: { box: "border-red-200 bg-red-50", badge: "bg-red-100 text-red-800" },
  medium: { box: "border-yellow-200 bg-yellow-50", badge: "bg-yellow-100 text-yellow-800" },
  low: { box: "border-blue-200 bg-blue-50", badge: "bg-blue-100 text-blue-800" },
};

const loginStatusStyle: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  locked: "bg-orange-100 text-orange-800",
};

const tabs = [
  { id: "overview", label: "Overview", icon: Shield },
  { id: "audit", label: "Audit Log", icon: FileText },
  { id: "login", label: "Login Activity", icon: Activity },
  { id: "anomalies", label: "Anomaly Alerts", icon: AlertTriangle },
  { id: "database", label: "Database", icon: Database },
];

const PAGE_SIZE = 25;

/** Value that settles `ms` after the last change — keeps search from firing per keystroke. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== "all") p.set(k, String(v));
  return p.toString();
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>
        {total === 0 ? "0 records" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span>Page {page} of {pages}</span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <RefreshCw className="w-6 h-6 text-[#2D6A4F] animate-spin" />
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SecurityAudit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);

  // Summary: cards, overview, account table.
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recent, setRecent] = useState<AuditRow[]>([]);

  // Audit log — filtered and paged on the server.
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [auditStatus, setAuditStatus] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const auditSearchQ = useDebounced(auditSearch);
  const [openAudit, setOpenAudit] = useState<AuditRow | null>(null);

  // Login attempts — filtered and paged on the server.
  const [loginRows, setLoginRows] = useState<LoginRow[]>([]);
  const [loginTotal, setLoginTotal] = useState(0);
  const [loginPage, setLoginPage] = useState(1);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState("all");
  const [loginSearch, setLoginSearch] = useState("");
  const loginSearchQ = useDebounced(loginSearch);

  // Anomalies.
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [anomalyFilter, setAnomalyFilter] = useState<"open" | "resolved" | "all">("open");
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [resolving, setResolving] = useState<AnomalyRow | null>(null);
  const [resolutionText, setResolutionText] = useState("");

  // Database.
  const [db, setDb] = useState<DbInfo | null>(null);
  const [dbLoading, setDbLoading] = useState(false);

  // Broadcast modal.
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState("");

  const fail = (err: any, what: string) => setError(err?.message ? `${what}: ${err.message}` : `${what} failed`);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const [s, r] = await Promise.all([
        api.get<{ data: Summary }>("/security/summary"),
        api.get<Page<AuditRow>>("/security/audit-logs?limit=6"),
      ]);
      setSummary(s.data);
      setRecent(r.data ?? []);
    } catch (err) {
      fail(err, "Loading the security summary");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const r = await api.get<Page<AuditRow>>(
        `/security/audit-logs?${qs({ page: auditPage, limit: PAGE_SIZE, category: categoryFilter, status: auditStatus, search: auditSearchQ })}`
      );
      setAuditRows(r.data ?? []);
      setAuditTotal(r.pagination?.total ?? 0);
    } catch (err) {
      fail(err, "Loading the audit log");
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, categoryFilter, auditStatus, auditSearchQ]);

  const loadLogins = useCallback(async () => {
    setLoginLoading(true);
    try {
      const r = await api.get<Page<LoginRow>>(
        `/security/login-activity?${qs({ page: loginPage, limit: PAGE_SIZE, status: loginStatus, search: loginSearchQ })}`
      );
      setLoginRows(r.data ?? []);
      setLoginTotal(r.pagination?.total ?? 0);
    } catch (err) {
      fail(err, "Loading login activity");
    } finally {
      setLoginLoading(false);
    }
  }, [loginPage, loginStatus, loginSearchQ]);

  const loadAnomalies = useCallback(async () => {
    setAnomalyLoading(true);
    try {
      const resolved = anomalyFilter === "open" ? "false" : anomalyFilter === "resolved" ? "true" : undefined;
      const r = await api.get<Page<AnomalyRow>>(`/security/anomalies?${qs({ limit: 200, resolved })}`);
      setAnomalies(r.data ?? []);
    } catch (err) {
      fail(err, "Loading anomalies");
    } finally {
      setAnomalyLoading(false);
    }
  }, [anomalyFilter]);

  const loadDb = useCallback(async () => {
    setDbLoading(true);
    try {
      const r = await api.get<{ data: DbInfo }>("/security/database");
      setDb(r.data);
    } catch (err) {
      fail(err, "Reading the database");
    } finally {
      setDbLoading(false);
    }
  }, []);

  // Filters go back to page 1 when they change.
  useEffect(() => setAuditPage(1), [categoryFilter, auditStatus, auditSearchQ]);
  useEffect(() => setLoginPage(1), [loginStatus, loginSearchQ]);

  useEffect(() => { if (isAdmin) loadSummary(); }, [isAdmin, loadSummary]);
  useEffect(() => { if (isAdmin && activeTab === "audit") loadAudit(); }, [isAdmin, activeTab, loadAudit]);
  useEffect(() => { if (isAdmin && activeTab === "login") loadLogins(); }, [isAdmin, activeTab, loadLogins]);
  useEffect(() => { if (isAdmin && activeTab === "anomalies") loadAnomalies(); }, [isAdmin, activeTab, loadAnomalies]);
  useEffect(() => { if (isAdmin && activeTab === "database") loadDb(); }, [isAdmin, activeTab, loadDb]);

  const refreshAll = () => {
    setError(null);
    loadSummary();
    if (activeTab === "audit") loadAudit();
    if (activeTab === "login") loadLogins();
    if (activeTab === "anomalies") loadAnomalies();
    if (activeTab === "database") loadDb();
  };

  // Admin-only guard — after every hook, so the hook order never changes.
  if (!isAdmin) {
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

  const unlock = async (a: AccountRow) => {
    if (!confirm(`Unlock ${a.name} (${a.email}) and reset their failed-attempt count?`)) return;
    try {
      await api.patch(`/security/users/${a.id}/unlock`, {});
      loadSummary();
    } catch (err) {
      fail(err, "Unlocking the account");
    }
  };

  const resolve = async () => {
    if (!resolving || !resolutionText.trim()) return;
    try {
      await api.patch(`/security/anomalies/${resolving.id}/resolve`, { resolution: resolutionText.trim() });
      setResolving(null);
      setResolutionText("");
      loadAnomalies();
      loadSummary();
    } catch (err) {
      fail(err, "Resolving the anomaly");
    }
  };

  /** The audit trail under the current filters (up to 500 rows), as a PDF. */
  const handleExportAuditTrail = async () => {
    try {
      const r = await api.get<Page<AuditRow>>(
        `/security/audit-logs?${qs({ page: 1, limit: 500, category: categoryFilter, status: auditStatus, search: auditSearchQ })}`
      );
      const rows = r.data ?? [];
      await downloadPdf({
        title: "Security Audit Trail",
        subtitle: `${rows.length} of ${r.pagination?.total ?? rows.length} event(s)${categoryFilter !== "all" ? `, category: ${categoryFilter}` : ""}`,
        summary: [
          { label: "Events", value: String(rows.length) },
          { label: "Not successful", value: String(rows.filter((l) => l.status !== "success").length) },
        ],
        sections: [
          {
            title: "Events",
            note: "Most recent first, read from the audit_logs table.",
            columns: ["When", "User", "Role", "Action", "Category", "IP", "Result"],
            rows: rows.map((l) => [
              when(l.created_at), l.user_name ?? l.details?.email ?? "Anonymous", l.user_role ?? "—",
              l.action, l.category, l.ip_address ?? "", l.status,
            ]),
          },
        ],
      });
    } catch (err: any) {
      alert(err?.message ?? "The PDF could not be produced.");
    }
  };

  const handleSendSecurityMessage = () => {
    if (!messageText.trim()) return;
    navigate("/messages", { state: { openCompose: true, type: "broadcast", prefill: messageText } });
    setShowMessageModal(false);
    setMessageText("");
  };

  const s = summary;
  const passed = s?.posture.filter((p) => p.ok).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Security & Audit</h1>
          <p className="text-gray-600 mt-1">
            Live from the database — sign-ins, every change made through the system, and anomalies detected in them
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={refreshAll}
            disabled={summaryLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${summaryLoading ? "animate-spin" : ""}`} />
            {summaryLoading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={handleExportAuditTrail}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
          >
            <Download className="w-4 h-4" /> Download PDF
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Security checks passed", value: s ? `${passed}/${s.posture.length}` : "—",
            sub: "Read from the running system", icon: Shield, bg: "bg-[#2D6A4F]/10", color: "text-[#2D6A4F]",
          },
          {
            label: "Active sessions", value: s ? String(s.activeSessions) : "—",
            sub: s ? `${s.usersSignedInToday} user(s) signed in today` : "", icon: Activity, bg: "bg-[#2D6A4F]/10", color: "text-[#2D6A4F]",
          },
          {
            label: "Failed sign-ins (7 days)", value: s ? String(s.failedLogins7d) : "—",
            sub: s ? `${s.unknownAccountAttempts7d} on unknown accounts · ${s.lockedAccountsNow} locked now` : "",
            icon: Lock, ...(s && s.lockedAccountsNow > 0 ? { bg: "bg-red-50", color: "text-red-600" } : { bg: "bg-[#2D6A4F]/10", color: "text-[#2D6A4F]" }),
          },
          {
            label: "Unresolved anomalies", value: s ? String(s.unresolvedAnomalies) : "—",
            sub: s ? (["high", "medium", "low"].map((k) => `${s.unresolvedBySeverity[k] ?? 0} ${k}`).join(" · ")) : "",
            icon: AlertTriangle, ...(s && (s.unresolvedBySeverity.high ?? 0) > 0 ? { bg: "bg-red-50", color: "text-red-600" } : { bg: "bg-[#2D6A4F]/10", color: "text-[#2D6A4F]" }),
          },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
              <div className={`${m.bg} p-3 rounded-lg inline-block mb-3`}>
                <Icon className={`w-5 h-5 ${m.color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{m.value}</p>
              <p className="text-sm text-gray-600 mt-1">{m.label}</p>
              {m.sub && <p className="text-xs text-gray-400 mt-1">{m.sub}</p>}
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
                  {tab.id === "anomalies" && s && s.unresolvedAnomalies > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">{s.unresolvedAnomalies}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="p-6 space-y-6">
            {summaryLoading && !s ? <Spinner /> : s && (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Security checks</h3>
                  <p className="text-xs text-gray-500 mb-3">Each one is evaluated against the live configuration and database.</p>
                  <div className="space-y-2">
                    {s.posture.map((p) => (
                      <div key={p.label} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="text-sm text-gray-800">{p.label}</p>
                          <p className="text-xs text-gray-500">{p.detail}</p>
                        </div>
                        {p.ok ? (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">Sign-ins, last 7 days</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Succeeded", value: s.successfulLogins7d, cls: "text-green-700" },
                        { label: "Failed", value: s.failedLogins7d, cls: "text-red-700" },
                        { label: "While locked", value: s.lockedAttempts7d, cls: "text-orange-700" },
                      ].map((x) => (
                        <div key={x.label} className="p-3 bg-gray-50 rounded-lg text-center">
                          <p className={`text-xl font-bold ${x.cls}`}>{x.value}</p>
                          <p className="text-xs text-gray-500">{x.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      {s.loginRecordsTotal} sign-in records since {when(s.loginRecordsSince)} · {s.auditEventsTotal} audit
                      events ({s.auditEventsToday} today)
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">Most recent changes</h3>
                    <div className="space-y-2">
                      {recent.map((log) => (
                        <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${log.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{log.action}</p>
                            <p className="text-xs text-gray-500">
                              {log.user_name ?? log.details?.email ?? "Anonymous"} · {ago(log.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {recent.length === 0 && (
                        <p className="text-sm text-gray-500">
                          No changes recorded yet. Every create, update and delete made through the system from now on
                          will appear here.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
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
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search action, user, email or IP..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              >
                <option value="all">All categories</option>
                <option value="login">Sign-in</option>
                <option value="financial">Financial</option>
                <option value="member">Member</option>
                <option value="report">Report</option>
                <option value="security">Security</option>
                <option value="operations">Operations</option>
              </select>
              <select
                value={auditStatus}
                onChange={(e) => setAuditStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              >
                <option value="all">All results</option>
                <option value="success">Success</option>
                <option value="failure">Failed</option>
              </select>
            </div>
            {auditLoading && auditRows.length === 0 ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {["When", "User", "Action", "Category", "IP", "Result"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {auditRows.map((log) => (
                      <tr key={log.id} onClick={() => setOpenAudit(log)} className="hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {when(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-medium text-gray-900">
                            <User className="w-3 h-3 text-gray-400" />
                            {log.user_name ?? log.details?.email ?? "Anonymous"}
                          </div>
                          <p className="text-xs text-gray-500 capitalize pl-5">{log.user_role ?? "not signed in"}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-900">{log.action}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[log.category] || "bg-gray-100 text-gray-700"}`}>
                            {log.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.ip_address}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            log.status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                          }`}>
                            {log.status === "success" ? "success" : `failed${log.details?.statusCode ? ` (${log.details.statusCode})` : ""}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {auditRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                          {auditTotal === 0 && categoryFilter === "all" && auditStatus === "all" && !auditSearchQ
                            ? "No changes recorded yet. Recording started with this version; every create, update and delete appears here."
                            : "No entries match the current filters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <Pager page={auditPage} total={auditTotal} onPage={setAuditPage} />
              </div>
            )}
          </div>
        )}

        {/* LOGIN ACTIVITY */}
        {activeTab === "login" && (
          <div className="p-6 space-y-8">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Accounts</h3>
              <p className="text-xs text-gray-500 mb-3">
                Every account, its current session, and the last sign-in attempt made on it.
              </p>
              {summaryLoading && !s ? <Spinner /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {["User", "Session", "Last sign-in", "Last device / IP", "Failed (7d)", ""].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {s?.accounts.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{a.name}</p>
                            <p className="text-xs text-gray-500">
                              {a.email} · <span className="capitalize">{a.oversight_level ? `${a.oversight_level} officer` : a.role}</span>
                              {a.cooperative_name ? ` · ${a.cooperative_name}` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            {a.is_locked ? (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                Locked until {new Date(a.locked_until!).toLocaleTimeString()}
                              </span>
                            ) : a.status !== "active" ? (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700 capitalize">{a.status}</span>
                            ) : a.has_session ? (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Signed in</span>
                            ) : (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">No session</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap" title={when(a.last_login_at)}>
                            {ago(a.last_login_at)}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            <p className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {a.last_attempt_at ? a.last_device : "—"}</p>
                            <p className="text-xs font-mono text-gray-400">{a.last_ip ?? ""}</p>
                          </td>
                          <td className={`px-4 py-3 ${a.failed_7d > 0 ? "text-red-700 font-semibold" : "text-gray-500"}`}>{a.failed_7d}</td>
                          <td className="px-4 py-3 text-right">
                            {(a.is_locked || a.failed_attempts > 0) && (
                              <button
                                onClick={() => unlock(a)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100"
                                title={`${a.failed_attempts} consecutive failed attempt(s)`}
                              >
                                <Unlock className="w-3 h-3" /> {a.is_locked ? "Unlock" : "Reset count"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Every sign-in attempt</h3>
              <p className="text-xs text-gray-500 mb-3">
                Recorded at the password step; code checks are in the Audit Log.
              </p>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-48">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={loginSearch}
                    onChange={(e) => setLoginSearch(e.target.value)}
                    placeholder="Search email, name or IP..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  />
                </div>
                <select
                  value={loginStatus}
                  onChange={(e) => setLoginStatus(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                >
                  <option value="all">All outcomes</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="locked">Blocked (locked)</option>
                </select>
              </div>
              {loginLoading && loginRows.length === 0 ? <Spinner /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {["When", "Account", "Outcome", "Device", "IP"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {loginRows.map((l) => (
                        <tr key={l.id} className={l.status === "success" ? "hover:bg-gray-50" : "bg-red-50/40 hover:bg-red-50"}>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{when(l.attempted_at)}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{l.user_name ?? <span className="italic text-gray-500">No such account</span>}</p>
                            <p className="text-xs text-gray-500">{l.email}{l.user_role ? ` · ${l.user_role}` : ""}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${loginStatusStyle[l.status]}`}>{l.status}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{l.device}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{l.ip_address}</td>
                        </tr>
                      ))}
                      {loginRows.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">No sign-in attempts match.</td></tr>
                      )}
                    </tbody>
                  </table>
                  <Pager page={loginPage} total={loginTotal} onPage={setLoginPage} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ANOMALY ALERTS */}
        {activeTab === "anomalies" && (
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Anomaly detection</h3>
                <p className="text-xs text-gray-500" title="5+ wrong passwords on one account in an hour · one IP failing on 3+ accounts in an hour · attempts on non-existent or locked accounts · admin sign-ins 00:00–05:00">
                  Detected from the last 90 days of sign-ins.
                </p>
              </div>
              <select
                value={anomalyFilter}
                onChange={(e) => setAnomalyFilter(e.target.value as any)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </select>
            </div>
            {anomalyLoading && anomalies.length === 0 ? <Spinner /> : (
              <div className="space-y-3">
                {anomalies.map((a) => {
                  const st = severityStyle[a.severity] ?? severityStyle.medium;
                  return (
                    <div key={a.id} className={`p-4 rounded-lg border-2 ${a.resolved_at ? "border-gray-200 bg-gray-50" : st.box}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-semibold text-gray-900">{a.type}</h4>
                          <p className="text-sm text-gray-700 mt-0.5">{a.description}</p>
                          {a.affected_user_name && (
                            <p className="text-xs text-gray-600 mt-1">Account: {a.affected_user_name} ({a.affected_user_email})</p>
                          )}
                          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {when(a.detected_at)}
                          </p>
                          {a.resolved_at && (
                            <p className="text-xs text-green-800 mt-1">
                              Resolved {when(a.resolved_at)}{a.resolved_by_name ? ` by ${a.resolved_by_name}` : ""}: {a.resolution}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${st.badge}`}>{a.severity.toUpperCase()}</span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${a.resolved_at ? "bg-green-100 text-green-800" : "bg-white text-gray-700 border border-gray-200"}`}>
                            {a.resolved_at ? "Resolved" : "Open"}
                          </span>
                        </div>
                      </div>
                      {!a.resolved_at && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => { setResolving(a); setResolutionText(""); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#2D6A4F] text-white rounded-lg text-xs font-medium hover:opacity-90"
                          >
                            <CheckCircle className="w-3 h-3" /> Mark resolved
                          </button>
                          <button
                            onClick={() => { setMessageText(`${a.type}: ${a.description}`); setShowMessageModal(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
                          >
                            <Send className="w-3 h-3" /> Send alert to users
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {anomalies.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">
                    {anomalyFilter === "open" ? "No open anomalies. Nothing unusual found in recent sign-ins." : "No anomalies."}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* DATABASE */}
        {activeTab === "database" && (
          <div className="p-6 space-y-6">
            {dbLoading && !db ? <Spinner /> : db && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Database", value: db.name },
                    { label: "Size on disk", value: db.size },
                    { label: "Open connections", value: String(db.connections) },
                    { label: "Connection", value: db.ssl ? "Encrypted (SSL)" : "Not encrypted" },
                  ].map((x) => (
                    <div key={x.label} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-xs text-gray-500">{x.label}</p>
                      <p className={`font-semibold ${x.label === "Connection" && !db.ssl ? "text-yellow-700" : "text-gray-900"}`}>{x.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {db.version.split(",")[0]} · server time {when(db.server_time)} · read-only view, row counts are exact.
                  No automatic retention purge is configured: every table keeps its rows until they are deleted.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {["Table", "Rows", "Size", "Oldest record", "Newest record"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {db.tables.map((t) => (
                        <tr key={t.table} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs text-gray-900">{t.table}</td>
                          <td className="px-4 py-2 text-gray-700 tabular-nums">{t.rows.toLocaleString()}</td>
                          <td className="px-4 py-2 text-gray-600 tabular-nums">{t.size}</td>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{t.oldest ? new Date(t.oldest).toLocaleDateString() : "—"}</td>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{t.newest ? new Date(t.newest).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Audit entry detail */}
      {openAudit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpenAudit(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                {openAudit.status === "success" ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
                {openAudit.action}
              </h3>
              <button onClick={() => setOpenAudit(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <dl className="p-5 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              {[
                ["When", when(openAudit.created_at)],
                ["User", `${openAudit.user_name ?? "Anonymous"}${openAudit.user_email ? ` <${openAudit.user_email}>` : openAudit.details?.email ? ` <${openAudit.details.email}>` : ""}`],
                ["Role", openAudit.user_role ?? "—"],
                ["Request", `${openAudit.details?.method ?? ""} ${openAudit.details?.path ?? ""}`],
                ["Response", String(openAudit.details?.statusCode ?? "—")],
                ["Record id", openAudit.resource_id ?? "—"],
                ["IP address", openAudit.ip_address ?? "—"],
                ["User agent", openAudit.user_agent ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-gray-900 break-all font-mono text-xs leading-5">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Resolve anomaly */}
      {resolving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Resolve: {resolving.type}</h3>
              <button onClick={() => setResolving(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">{resolving.description}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">What was found / done</label>
                <textarea
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  rows={3}
                  placeholder="e.g. Confirmed with the user — they had forgotten their password."
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setResolving(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={resolve}
                  disabled={!resolutionText.trim()}
                  className="px-4 py-2 bg-[#2D6A4F] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Mark resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
