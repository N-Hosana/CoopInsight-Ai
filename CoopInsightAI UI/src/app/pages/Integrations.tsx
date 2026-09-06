import { useState, useEffect } from "react";
import {
  CheckCircle, XCircle, RefreshCw, Settings, Smartphone, Building2,
  Database, Zap, Tractor, AlertTriangle, X, Play, Trash2,
} from "lucide-react";
import { api } from "../services/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Integration {
  id: string;
  name: string;
  type: string;
  status: "connected" | "disconnected";
  config: {
    apiKey?: string;
    endpoint?: string;
    [key: string]: unknown;
  };
  last_sync: string | null;
  created_at: string;
  // UI-only fields derived from type
  category?: string;
  description?: string;
  color?: string;
}

// ─── Static helpers ───────────────────────────────────────────────────────────

const typeMeta: Record<string, { category: string; description: string; color: string; icon: React.ElementType }> = {
  payment_mtn:    { category: "Payment",       description: "Accept mobile money payments from members",                          color: "yellow", icon: Smartphone },
  payment_airtel: { category: "Payment",       description: "Accept Airtel mobile money payments",                               color: "red",    icon: Smartphone },
  banking:        { category: "Banking",       description: "Direct bank account integration for transactions",                  color: "blue",   icon: Building2  },
  government:     { category: "Government",    description: "Sync with national cooperative database",                           color: "green",  icon: Database   },
  communication:  { category: "Communication", description: "Send SMS notifications to members",                                  color: "purple", icon: Zap        },
  agriculture:    { category: "Agriculture",   description: "Connect with MINAGRI extension services for crop data and advisories", color: "green", icon: Tractor  },
};

const colorStyles: Record<string, { bg: string; text: string }> = {
  yellow: { bg: "bg-yellow-50", text: "text-yellow-600" },
  blue:   { bg: "bg-blue-50",   text: "text-blue-600"   },
  green:  { bg: "bg-green-50",  text: "text-green-600"  },
  purple: { bg: "bg-purple-50", text: "text-purple-600" },
  red:    { bg: "bg-red-50",    text: "text-red-600"    },
};

const webhooks = [
  { id: 1, name: "New Member Registration", endpoint: "https://api.example.com/webhooks/member", status: "active",   lastTriggered: "2026-04-28 14:30", deliveries: 142, failures: 0 },
  { id: 2, name: "Loan Disbursement",        endpoint: "https://api.example.com/webhooks/loan",   status: "active",   lastTriggered: "2026-04-28 12:15", deliveries: 38,  failures: 1 },
  { id: 3, name: "Payment Received",         endpoint: "https://api.example.com/webhooks/payment",status: "inactive", lastTriggered: "2026-04-25 09:00", deliveries: 89,  failures: 4 },
];

const errorLogs = [
  { id: 1, integration: "Airtel Money",            error: "Connection timeout after 30s",               time: "2026-04-28 10:15", resolved: false, resolution: "" },
  { id: 2, integration: "Webhook: Payment Received",error: "HTTP 502 Bad Gateway from endpoint",        time: "2026-04-27 16:40", resolved: true,  resolution: "Endpoint server restarted by provider" },
  { id: 3, integration: "Agriculture Extension Service", error: "Invalid API key — authentication failed", time: "2026-04-26 08:00", resolved: false, resolution: "" },
];

// ─── Modal type ───────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "config"; id: string }
  | { kind: "webhook"; id: number }
  | { kind: "test"; id: string; name: string }
  | { kind: "error"; id: number }
  | null;

// ─── Component ────────────────────────────────────────────────────────────────

export function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [testResult, setTestResult] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [endpointInputs, setEndpointInputs] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [webhookList, setWebhookList] = useState(webhooks);
  const [errors, setErrors] = useState(errorLogs);
  const [resolutionText, setResolutionText] = useState("");

  // ── Fetch integrations ────────────────────────────────────────────────────

  const fetchIntegrations = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await api.get<{ integrations: Integration[] }>("/integrations");
      setIntegrations(data.integrations ?? []);
    } catch (err: any) {
      setFetchError(err?.message ?? "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // ── Derived health metrics ────────────────────────────────────────────────

  const connectedCount = integrations.filter((i) => i.status === "connected").length;
  const disconnectedCount = integrations.filter((i) => i.status === "disconnected").length;
  const activeErrors = errors.filter((e) => !e.resolved).length;

  const healthMetrics = [
    { label: "Active Integrations",  value: String(connectedCount),    icon: CheckCircle,  color: "text-green-600",  bg: "bg-green-50"  },
    { label: "Disconnected",         value: String(disconnectedCount),  icon: XCircle,      color: "text-red-600",    bg: "bg-red-50"    },
    { label: "Successful Syncs (24h)",value: "47",                      icon: RefreshCw,    color: "text-blue-600",   bg: "bg-blue-50"   },
    { label: "Active Errors",        value: String(activeErrors),       icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50" },
  ];

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleConnect = async (id: string) => {
    try {
      const updated = await api.patch<{ integration: Integration }>(`/integrations/${id}`, { status: "connected" });
      setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, ...updated.integration } : i));
    } catch {
      // silently fail — user can retry
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      const updated = await api.patch<{ integration: Integration }>(`/integrations/${id}`, { status: "disconnected" });
      setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, ...updated.integration } : i));
    } catch {
      // silently fail
    }
  };

  const handleSaveConfig = async (id: string) => {
    setSavingConfig(true);
    try {
      const intg = integrations.find((i) => i.id === id);
      if (!intg) return;
      const config = {
        ...intg.config,
        apiKey:   apiKeyInputs[id]   ?? intg.config.apiKey,
        endpoint: endpointInputs[id] ?? intg.config.endpoint,
      };
      const updated = await api.patch<{ integration: Integration }>(`/integrations/${id}`, { config });
      setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, ...updated.integration } : i));
      setModal(null);
    } catch {
      // silently fail
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Remove the ${name} integration entirely? This deletes its stored configuration.`)) {
      return;
    }
    try {
      await api.delete(`/integrations/${id}`);
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      setFetchError(err?.message ?? "Could not remove the integration.");
    }
  };

  const handleTestConnection = async (id: string, name: string) => {
    setModal({ kind: "test", id, name });
    setTestResult("testing");
    setTestMessage("");
    try {
      const result = await api.post<{ success: boolean; message: string }>(`/integrations/${id}/test`, {});
      setTestResult(result.success ? "success" : "failed");
      setTestMessage(result.message ?? "");
    } catch {
      setTestResult("failed");
      setTestMessage("Could not reach the integration endpoint. Check your API key and endpoint URL.");
    }
  };

  const toggleWebhook = (id: number) => {
    setWebhookList((prev) => prev.map((w) => w.id === id ? { ...w, status: w.status === "active" ? "inactive" : "active" } : w));
  };

  const handleResolveError = (id: number) => {
    setErrors((prev) => prev.map((e) => e.id === id ? { ...e, resolved: true, resolution: resolutionText || "Marked as resolved by admin" } : e));
    setResolutionText("");
    setModal(null);
  };

  // ── Selected items for modals ─────────────────────────────────────────────

  const selectedIntegration = (modal?.kind === "config" || modal?.kind === "test") && modal.id
    ? integrations.find((i) => i.id === modal.id) ?? null
    : null;
  const selectedWebhook = modal?.kind === "webhook" ? webhookList.find((w) => w.id === modal.id) : null;
  const selectedError   = modal?.kind === "error"   ? errors.find((e) => e.id === modal.id)      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
        <p className="text-gray-600 mt-1">Connect external systems, manage APIs, webhooks, and monitor health</p>
      </div>

      {/* Health Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {healthMetrics.map((m) => {
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

      {/* Integrations List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Available Integrations</h2>
        </div>
        <div className="p-6 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading integrations…
            </div>
          )}
          {fetchError && !loading && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {fetchError}
              <button onClick={fetchIntegrations} className="ml-auto px-3 py-1 bg-white border border-red-300 rounded-lg text-xs hover:bg-red-50">
                Retry
              </button>
            </div>
          )}
          {!loading && !fetchError && integrations.length === 0 && (
            <p className="text-center text-gray-500 py-12">No integrations found.</p>
          )}
          {!loading && integrations.map((integration) => {
            const meta     = typeMeta[integration.type] ?? { category: integration.type, description: "", color: "blue", icon: Database };
            const Icon     = meta.icon;
            const isConnected = integration.status === "connected";
            const style    = colorStyles[meta.color] ?? { bg: "bg-slate-100", text: "text-slate-600" };
            const lastSync = integration.last_sync ? `Last sync: ${integration.last_sync}` : null;

            return (
              <div key={integration.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`p-3 rounded-lg ${style.bg}`}>
                      <Icon className={`w-6 h-6 ${style.text}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isConnected ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                          {isConnected ? "Connected" : "Disconnected"}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{meta.category}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{integration.config?.description as string ?? meta.description}</p>
                      {isConnected && lastSync && <p className="text-xs text-gray-500">{lastSync}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      onClick={() => handleTestConnection(integration.id, integration.name)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-medium flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" /> Test
                    </button>
                    {isConnected ? (
                      <>
                        <button
                          onClick={() => setModal({ kind: "config", id: integration.id })}
                          className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-medium flex items-center gap-1"
                        >
                          <Settings className="w-3 h-3" /> Configure
                        </button>
                        <button
                          onClick={() => handleDisconnect(integration.id)}
                          className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-medium"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleConnect(integration.id)}
                          className="px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-medium"
                        >
                          Connect
                        </button>
                        <button
                          onClick={() => handleDelete(integration.id, integration.name)}
                          title="Remove this integration and its stored configuration"
                          className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-medium flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Webhook Management */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Webhook Management</h2>
        </div>
        <div className="p-6 space-y-3">
          {webhookList.map((wh) => (
            <div key={wh.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium text-gray-900">{wh.name}</h3>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{wh.endpoint}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${wh.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                  {wh.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                <span>Last triggered: {wh.lastTriggered}</span>
                <span>{wh.deliveries} deliveries · {wh.failures} failures</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setModal({ kind: "webhook", id: wh.id })}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" /> See Details
                </button>
                <button
                  onClick={() => toggleWebhook(wh.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${wh.status === "active" ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
                >
                  {wh.status === "active" ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error Log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Error Log & Resolution</h2>
        </div>
        <div className="p-6 space-y-3">
          {errors.map((err) => (
            <div key={err.id} className={`p-4 rounded-lg border ${err.resolved ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900">{err.integration}</p>
                  <p className="text-sm text-gray-700 mt-0.5">{err.error}</p>
                  <p className="text-xs text-gray-500 mt-1">{err.time}</p>
                  {err.resolved && err.resolution && <p className="text-xs text-green-700 mt-1">Resolution: {err.resolution}</p>}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${err.resolved ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                  {err.resolved ? "Resolved" : "Active"}
                </span>
              </div>
              {!err.resolved && (
                <button
                  onClick={() => { setModal({ kind: "error", id: err.id }); setResolutionText(""); }}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium"
                >
                  Mark Resolved
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">
                {modal.kind === "config"  ? `Configure: ${selectedIntegration?.name ?? ""}` :
                 modal.kind === "webhook" ? "Webhook Details" :
                 modal.kind === "test"    ? "Test Connection" :
                                           "Resolve Error"}
              </h3>
              <button onClick={() => { setModal(null); setTestResult("idle"); }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">

              {/* API Config Modal */}
              {modal.kind === "config" && selectedIntegration && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">API Endpoint</label>
                    <input
                      type="text"
                      value={endpointInputs[selectedIntegration.id] ?? (selectedIntegration.config?.endpoint as string ?? "")}
                      onChange={(e) => setEndpointInputs((prev) => ({ ...prev, [selectedIntegration.id]: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                    <input
                      type="text"
                      value={apiKeyInputs[selectedIntegration.id] ?? (selectedIntegration.config?.apiKey as string ?? "")}
                      onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [selectedIntegration.id]: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-[#2563EB]"
                      placeholder="Enter API key…"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Auto Sync</p>
                      <p className="text-xs text-gray-500">Sync automatically when new data arrives</p>
                    </div>
                    <span className="text-sm text-green-700 font-medium">Enabled</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Notify on Failure</p>
                      <p className="text-xs text-gray-500">Alert admin when sync fails</p>
                    </div>
                    <span className="text-sm text-green-700 font-medium">Enabled</span>
                  </div>
                  <div className="flex gap-3 justify-end pt-2">
                    <button onClick={() => setModal(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveConfig(selectedIntegration.id)}
                      disabled={savingConfig}
                      className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1d4ed8] disabled:opacity-60"
                    >
                      {savingConfig ? "Saving…" : "Save Configuration"}
                    </button>
                  </div>
                </>
              )}

              {/* Webhook Detail Modal */}
              {modal.kind === "webhook" && selectedWebhook && (
                <>
                  <div className="space-y-3 text-sm">
                    <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Name</p><p className="font-semibold text-gray-900 mt-1">{selectedWebhook.name}</p></div>
                    <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Endpoint</p><p className="font-mono text-gray-900 mt-1 break-all">{selectedWebhook.endpoint}</p></div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Status</p><p className={`font-semibold mt-1 ${selectedWebhook.status === "active" ? "text-green-700" : "text-gray-600"}`}>{selectedWebhook.status}</p></div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Deliveries</p><p className="font-semibold text-gray-900 mt-1">{selectedWebhook.deliveries}</p></div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Failures</p><p className={`font-semibold mt-1 ${selectedWebhook.failures > 0 ? "text-red-700" : "text-gray-900"}`}>{selectedWebhook.failures}</p></div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Last Triggered</p><p className="font-semibold text-gray-900 mt-1">{selectedWebhook.lastTriggered}</p></div>
                  </div>
                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      onClick={() => toggleWebhook(selectedWebhook.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium ${selectedWebhook.status === "active" ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
                    >
                      {selectedWebhook.status === "active" ? "Disable Webhook" : "Enable Webhook"}
                    </button>
                    <button onClick={() => setModal(null)} className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1d4ed8]">Close</button>
                  </div>
                </>
              )}

              {/* Test Connection Modal */}
              {modal.kind === "test" && (
                <div className="text-center py-6">
                  {testResult === "testing" && (
                    <>
                      <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                      <p className="font-semibold text-gray-900">Testing connection to {modal.name}…</p>
                      <p className="text-sm text-gray-500 mt-2">Sending test request to endpoint</p>
                    </>
                  )}
                  {testResult === "success" && (
                    <>
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                      <p className="font-semibold text-green-700">Connection Successful</p>
                      <p className="text-sm text-gray-500 mt-2">{testMessage || `${modal.name} responded with HTTP 200 OK`}</p>
                      <button onClick={() => { setModal(null); setTestResult("idle"); }} className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Done</button>
                    </>
                  )}
                  {testResult === "failed" && (
                    <>
                      <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                      <p className="font-semibold text-red-700">Connection Failed</p>
                      <p className="text-sm text-gray-500 mt-2">{testMessage || `Could not reach ${modal.name}. Check API key and endpoint.`}</p>
                      <button onClick={() => { setModal(null); setTestResult("idle"); }} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Close</button>
                    </>
                  )}
                </div>
              )}

              {/* Error Resolution Modal */}
              {modal.kind === "error" && selectedError && (
                <>
                  <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                    <p className="font-semibold text-gray-900">{selectedError.integration}</p>
                    <p className="text-sm text-red-700 mt-1">{selectedError.error}</p>
                    <p className="text-xs text-gray-500 mt-1">{selectedError.time}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Resolution Notes</label>
                    <textarea
                      value={resolutionText}
                      onChange={(e) => setResolutionText(e.target.value)}
                      rows={3}
                      placeholder="Describe how this was resolved…"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setModal(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={() => handleResolveError(selectedError.id)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Mark Resolved</button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
