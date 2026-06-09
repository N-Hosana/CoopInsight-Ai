import { useState } from "react";
import {
  CheckCircle, XCircle, RefreshCw, Settings, Smartphone, Building2,
  Database, Zap, Tractor, AlertTriangle, X, Play,
} from "lucide-react";

const initialIntegrations = [
  { name: "Mobile Money - MTN MoMo", category: "Payment", status: "connected", icon: Smartphone, description: "Accept mobile money payments from members", lastSync: "5 minutes ago", color: "yellow", apiKey: "mtn_live_****8f2a", endpoint: "https://api.mtn.com/v1/momo" },
  { name: "Bank of Kigali API", category: "Banking", status: "connected", icon: Building2, description: "Direct bank account integration for transactions", lastSync: "10 minutes ago", color: "blue", apiKey: "bk_live_****3c9d", endpoint: "https://api.bk.rw/v2/transactions" },
  { name: "Government Cooperative Registry", category: "Government", status: "connected", icon: Database, description: "Sync with national cooperative database", lastSync: "1 hour ago", color: "green", apiKey: "gov_****7e1b", endpoint: "https://registry.gov.rw/api/coops" },
  { name: "SMS Gateway - Pindo", category: "Communication", status: "connected", icon: Zap, description: "Send SMS notifications to members", lastSync: "2 minutes ago", color: "purple", apiKey: "pindo_****4a2c", endpoint: "https://api.pindo.io/v1/sms" },
  { name: "Agriculture Extension Service", category: "Agriculture", status: "disconnected", icon: Tractor, description: "Connect with MINAGRI extension services for crop data and advisories", lastSync: null, color: "green", apiKey: "", endpoint: "https://api.minagri.gov.rw/extension" },
  { name: "Airtel Money", category: "Payment", status: "disconnected", icon: Smartphone, description: "Accept Airtel mobile money payments", lastSync: null, color: "red", apiKey: "", endpoint: "https://api.airtel.rw/v1/payments" },
];

const webhooks = [
  { id: 1, name: "New Member Registration", endpoint: "https://api.example.com/webhooks/member", status: "active", lastTriggered: "2026-04-28 14:30", deliveries: 142, failures: 0 },
  { id: 2, name: "Loan Disbursement", endpoint: "https://api.example.com/webhooks/loan", status: "active", lastTriggered: "2026-04-28 12:15", deliveries: 38, failures: 1 },
  { id: 3, name: "Payment Received", endpoint: "https://api.example.com/webhooks/payment", status: "inactive", lastTriggered: "2026-04-25 09:00", deliveries: 89, failures: 4 },
];

const errorLogs = [
  { id: 1, integration: "Airtel Money", error: "Connection timeout after 30s", time: "2026-04-28 10:15", resolved: false, resolution: "" },
  { id: 2, integration: "Webhook: Payment Received", error: "HTTP 502 Bad Gateway from endpoint", time: "2026-04-27 16:40", resolved: true, resolution: "Endpoint server restarted by provider" },
  { id: 3, integration: "Agriculture Extension Service", error: "Invalid API key — authentication failed", time: "2026-04-26 08:00", resolved: false, resolution: "" },
];

const healthMetrics = [
  { label: "Active Integrations", value: "4", icon: CheckCircle, color: "text-green-600", bg: "bg-green-50" },
  { label: "Disconnected", value: "2", icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
  { label: "Successful Syncs (24h)", value: "47", icon: RefreshCw, color: "text-blue-600", bg: "bg-blue-50" },
  { label: "Active Errors", value: "2", icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50" },
];

const colorStyles: Record<string, { bg: string; text: string }> = {
  yellow: { bg: "bg-yellow-50", text: "text-yellow-600" },
  blue: { bg: "bg-blue-50", text: "text-blue-600" },
  green: { bg: "bg-green-50", text: "text-green-600" },
  purple: { bg: "bg-purple-50", text: "text-purple-600" },
  red: { bg: "bg-red-50", text: "text-red-600" },
};

type ModalState =
  | { kind: "config"; name: string }
  | { kind: "webhook"; id: number }
  | { kind: "test"; name: string }
  | { kind: "error"; id: number }
  | null;

export function Integrations() {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [modal, setModal] = useState<ModalState>(null);
  const [testResult, setTestResult] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [webhookList, setWebhookList] = useState(webhooks);
  const [errors, setErrors] = useState(errorLogs);
  const [resolutionText, setResolutionText] = useState("");

  const handleConnect = (name: string) => {
    setIntegrations((prev) => prev.map((i) => i.name === name ? { ...i, status: "connected", lastSync: "Just now" } : i));
  };
  const handleDisconnect = (name: string) => {
    setIntegrations((prev) => prev.map((i) => i.name === name ? { ...i, status: "disconnected", lastSync: null } : i));
  };
  const toggleWebhook = (id: number) => {
    setWebhookList((prev) => prev.map((w) => w.id === id ? { ...w, status: w.status === "active" ? "inactive" : "active" } : w));
  };
  const handleTestConnection = (name: string) => {
    setModal({ kind: "test", name });
    setTestResult("testing");
    setTimeout(() => {
      const integration = integrations.find((i) => i.name === name);
      setTestResult(integration?.status === "connected" ? "success" : "failed");
    }, 1800);
  };
  const handleResolveError = (id: number) => {
    setErrors((prev) => prev.map((e) => e.id === id ? { ...e, resolved: true, resolution: resolutionText || "Marked as resolved by admin" } : e));
    setResolutionText("");
    setModal(null);
  };

  const selectedIntegration = modal?.kind === "config" ? integrations.find((i) => i.name === modal.name) : null;
  const selectedWebhook = modal?.kind === "webhook" ? webhookList.find((w) => w.id === modal.id) : null;
  const selectedError = modal?.kind === "error" ? errors.find((e) => e.id === modal.id) : null;

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
          {integrations.map((integration) => {
            const Icon = integration.icon;
            const isConnected = integration.status === "connected";
            const style = colorStyles[integration.color] ?? { bg: "bg-slate-100", text: "text-slate-600" };
            return (
              <div key={integration.name} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
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
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{integration.category}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{integration.description}</p>
                      {isConnected && <p className="text-xs text-gray-500">Last sync: {integration.lastSync}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button onClick={() => handleTestConnection(integration.name)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-medium flex items-center gap-1">
                      <Play className="w-3 h-3" /> Test
                    </button>
                    {isConnected ? (
                      <>
                        <button onClick={() => setModal({ kind: "config", name: integration.name })} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-medium flex items-center gap-1">
                          <Settings className="w-3 h-3" /> Configure
                        </button>
                        <button onClick={() => handleDisconnect(integration.name)} className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-medium">
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button onClick={() => handleConnect(integration.name)} className="px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] text-xs font-medium">
                        Connect
                      </button>
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
                <button onClick={() => setModal({ kind: "webhook", id: wh.id })} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium flex items-center gap-1">
                  <Settings className="w-3 h-3" /> See Details
                </button>
                <button onClick={() => toggleWebhook(wh.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${wh.status === "active" ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
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
                <button onClick={() => { setModal({ kind: "error", id: err.id }); setResolutionText(""); }} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-xs font-medium">
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
                {modal.kind === "config" ? `Configure: ${modal.name}` : modal.kind === "webhook" ? "Webhook Details" : modal.kind === "test" ? "Test Connection" : "Resolve Error"}
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
                    <input type="text" defaultValue={selectedIntegration.endpoint} className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563EB]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                    <input
                      type="text"
                      value={apiKeyInputs[selectedIntegration.name] ?? selectedIntegration.apiKey}
                      onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [selectedIntegration.name]: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-[#2563EB]"
                      placeholder="Enter API key..."
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
                    <button onClick={() => setModal(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={() => setModal(null)} className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1d4ed8]">Save Configuration</button>
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
                    <button onClick={() => toggleWebhook(selectedWebhook.id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${selectedWebhook.status === "active" ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
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
                      <p className="font-semibold text-gray-900">Testing connection to {modal.name}...</p>
                      <p className="text-sm text-gray-500 mt-2">Sending test request to endpoint</p>
                    </>
                  )}
                  {testResult === "success" && (
                    <>
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                      <p className="font-semibold text-green-700">Connection Successful</p>
                      <p className="text-sm text-gray-500 mt-2">{modal.name} responded with HTTP 200 OK</p>
                      <button onClick={() => { setModal(null); setTestResult("idle"); }} className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Done</button>
                    </>
                  )}
                  {testResult === "failed" && (
                    <>
                      <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                      <p className="font-semibold text-red-700">Connection Failed</p>
                      <p className="text-sm text-gray-500 mt-2">Could not reach {modal.name}. Check API key and endpoint.</p>
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
                      placeholder="Describe how this was resolved..."
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
