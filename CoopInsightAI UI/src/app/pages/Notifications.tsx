import { Bell, Send, Clock, Check, X, AlertTriangle, Mail, History, Eye, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useNotifications } from "../contexts/NotificationContext";

const getRelativeTime = (timestamp: string) => {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const m = Math.floor(diffMs / 60000);
  const h = Math.floor(diffMs / 3600000);
  const d = Math.floor(diffMs / 86400000);
  if (m < 60) return `${m} min${m !== 1 ? "s" : ""} ago`;
  if (h < 24) return `${h} hour${h !== 1 ? "s" : ""} ago`;
  return `${d} day${d !== 1 ? "s" : ""} ago`;
};

const complianceDeadlines = [
  { id: "c1", title: "Q2 Financial Audit Report", dueDate: "2026-04-30", daysLeft: 2, priority: "high" },
  { id: "c2", title: "Member Registry Update", dueDate: "2026-05-05", daysLeft: 7, priority: "medium" },
  { id: "c3", title: "Tax Compliance Filing", dueDate: "2026-05-31", daysLeft: 33, priority: "low" },
  { id: "c4", title: "Safety Certification Renewal", dueDate: "2026-05-15", daysLeft: 17, priority: "medium" },
];

const smsEmailStatus = [
  { channel: "SMS Gateway (Pindo)", status: "operational", lastSent: "2 mins ago", sent: 1248, failed: 3 },
  { channel: "Email (SMTP)", status: "operational", lastSent: "15 mins ago", sent: 892, failed: 1 },
  { channel: "WhatsApp API", status: "degraded", lastSent: "2 hours ago", sent: 234, failed: 18 },
];

const broadcastHistory = [
  { id: 1, subject: "Monthly Meeting Reminder", recipients: 145, sent: "2026-04-25", status: "Delivered", readCount: 132, channel: "SMS+Email" },
  { id: 2, subject: "Loan Payment Due", recipients: 23, sent: "2026-04-20", status: "Delivered", readCount: 23, channel: "SMS" },
  { id: 3, subject: "Training Workshop Announcement", recipients: 145, sent: "2026-04-15", status: "Delivered", readCount: 118, channel: "Email" },
  { id: 4, subject: "Compliance Deadline Alert", recipients: 5, sent: "2026-04-10", status: "Partial", readCount: 4, channel: "Email" },
];

const alertHistoryLog = [
  { id: "a1", type: "alert", title: "Anomaly Detected", message: "Unusual transaction pattern on TXN-2026-003", time: "2026-04-28 14:35", resolved: false },
  { id: "a2", type: "warning", title: "Compliance Deadline", message: "Q2 Financial Audit due in 2 days", time: "2026-04-28 09:00", resolved: false },
  { id: "a3", type: "success", title: "Sync Completed", message: "MTN MoMo integration synced successfully", time: "2026-04-27 16:20", resolved: true },
  { id: "a4", type: "alert", title: "Failed Login Attempt", message: "3 failed login attempts for admin@coopinsight.ai", time: "2026-04-27 13:45", resolved: true },
  { id: "a5", type: "warning", title: "Low Engagement Alert", message: "Peter Habimana engagement score dropped below 50%", time: "2026-04-26 11:00", resolved: false },
];

export function Notifications() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"inbox" | "compliance" | "sms-status" | "broadcast" | "history">("inbox");
  const [selectedBroadcast, setSelectedBroadcast] = useState<typeof broadcastHistory[0] | null>(null);
  const [popupQueue, setPopupQueue] = useState<{ id: string; title: string; message: string; type: string }[]>([]);
  const { notifications, unreadCount, markAsRead, markAllAsRead, addNotification } = useNotifications();

  // Simulate real-time alert pop-ups
  useEffect(() => {
    const timer = setTimeout(() => {
      const alert = { id: `rt-${Date.now()}`, title: "Real-Time Alert", message: "Compliance deadline in 2 days: Q2 Financial Audit Report", type: "warning" };
      setPopupQueue((q) => [...q, alert]);
      addNotification({ type: "warning", title: alert.title, message: alert.message, from: "System" });
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const dismissPopup = (id: string) => setPopupQueue((q) => q.filter((p) => p.id !== id));

  const tabs = [
    { id: "inbox", label: "Inbox", icon: Bell, badge: unreadCount },
    { id: "compliance", label: "Compliance Reminders", icon: AlertTriangle },
    { id: "sms-status", label: "SMS/Email Status", icon: Mail },
    { id: "broadcast", label: "Broadcasts", icon: Send },
    { id: "history", label: "Alert History", icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Real-time popup alerts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {popupQueue.map((popup) => (
          <div key={popup.id} className={`flex items-start gap-3 p-4 rounded-xl shadow-lg border animate-in slide-in-from-right ${popup.type === "warning" ? "bg-yellow-50 border-yellow-200" : popup.type === "alert" ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
            <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${popup.type === "warning" ? "text-yellow-600" : "text-red-600"}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm">{popup.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{popup.message}</p>
            </div>
            <button onClick={() => dismissPopup(popup.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Notification Center</h1>
        <p className="text-gray-600 mt-1">Alerts, compliance reminders, broadcast history, and integration status</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200 overflow-x-auto">
          <div className="flex min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-5 py-4 font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === tab.id ? "text-[#2D6A4F] border-b-2 border-[#2D6A4F]" : "text-gray-600 hover:text-gray-900"}`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {"badge" in tab && tab.badge! > 0 && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-medium">{tab.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* INBOX */}
        {activeTab === "inbox" && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Inbox</h2>
                <p className="text-sm text-gray-500">{unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={markAllAsRead} className="text-[#2563EB] text-sm font-medium hover:text-[#1d4ed8]">Mark all read</button>
            </div>
            <div className="space-y-3">
              {notifications.map((n) => (
                <div key={n.id} className={`p-4 rounded-lg border ${n.read ? "bg-white border-gray-200" : "bg-blue-50 border-blue-200"}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-lg ${n.type === "alert" ? "bg-red-100" : n.type === "success" ? "bg-green-100" : n.type === "warning" ? "bg-yellow-100" : "bg-blue-100"}`}>
                          <Bell className={`w-4 h-4 ${n.type === "alert" ? "text-red-600" : n.type === "success" ? "text-green-600" : n.type === "warning" ? "text-yellow-600" : "text-blue-600"}`} />
                        </div>
                        <h3 className="font-medium text-gray-900">{n.title}</h3>
                        {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                      </div>
                      <p className="text-sm text-gray-600 ml-14">{n.message}</p>
                      <p className="text-xs text-gray-500 ml-14 mt-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{getRelativeTime(n.timestamp)}
                      </p>
                    </div>
                    {!n.read && (
                      <button onClick={() => markAsRead(String(n.id))} className="text-[#2563EB] text-sm font-medium hover:text-[#1d4ed8] ml-4">
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* COMPLIANCE REMINDERS */}
        {activeTab === "compliance" && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Deadline Reminders</h2>
            <div className="space-y-3">
              {complianceDeadlines.map((item) => (
                <div key={item.id} className={`p-4 rounded-lg border-2 ${item.priority === "high" ? "border-red-200 bg-red-50" : item.priority === "medium" ? "border-yellow-200 bg-yellow-50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{item.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">Due: {item.dueDate}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${item.daysLeft <= 3 ? "bg-red-100 text-red-800" : item.daysLeft <= 14 ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}>
                        {item.daysLeft} days left
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${item.daysLeft <= 3 ? "bg-red-500" : item.daysLeft <= 14 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.max(5, 100 - (item.daysLeft / 60) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SMS/EMAIL STATUS */}
        {activeTab === "sms-status" && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">SMS / Email Integration Status</h2>
            <div className="space-y-4">
              {smsEmailStatus.map((s) => (
                <div key={s.channel} className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{s.channel}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Last sent: {s.lastSent}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${s.status === "operational" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs text-gray-500">Sent</p>
                      <p className="font-bold text-green-700 text-lg">{s.sent.toLocaleString()}</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs text-gray-500">Failed</p>
                      <p className={`font-bold text-lg ${s.failed > 5 ? "text-red-700" : "text-gray-700"}`}>{s.failed}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BROADCASTS */}
        {activeTab === "broadcast" && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Broadcast Messages</h2>
              <button
                onClick={() => navigate("/messages", { state: { openCompose: true, type: "broadcast" } })}
                className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                New Broadcast Message
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Subject</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Channel</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Recipients</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Read</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Sent</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {broadcastHistory.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{b.subject}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{b.channel}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{b.recipients}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="flex items-center gap-1 text-green-700">
                          <Eye className="w-3 h-3" />{b.readCount}/{b.recipients}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{b.sent}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${b.status === "Delivered" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelectedBroadcast(b)} className="text-[#2D6A4F] hover:text-[#1B4332] text-sm font-medium flex items-center gap-1">
                          <Eye className="w-3 h-3" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ALERT HISTORY LOG */}
        {activeTab === "history" && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Alert History Log</h2>
            <div className="space-y-3">
              {alertHistoryLog.map((log) => (
                <div key={log.id} className={`p-4 rounded-lg border ${log.type === "alert" ? "border-red-200 bg-red-50" : log.type === "warning" ? "border-yellow-200 bg-yellow-50" : "border-green-200 bg-green-50"}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{log.title}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${log.type === "alert" ? "bg-red-100 text-red-800" : log.type === "warning" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}>
                          {log.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{log.message}</p>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{log.time}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ml-4 ${log.resolved ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                      {log.resolved ? "Resolved" : "Active"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Broadcast detail modal */}
      {selectedBroadcast && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">Broadcast Details</h3>
              <button onClick={() => setSelectedBroadcast(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-500 uppercase">Subject</p><p className="font-semibold text-gray-900 mt-1">{selectedBroadcast.subject}</p></div>
                <div><p className="text-xs text-gray-500 uppercase">Channel</p><p className="font-semibold text-gray-900 mt-1">{selectedBroadcast.channel}</p></div>
                <div><p className="text-xs text-gray-500 uppercase">Recipients</p><p className="font-semibold text-gray-900 mt-1">{selectedBroadcast.recipients}</p></div>
                <div><p className="text-xs text-gray-500 uppercase">Sent Date</p><p className="font-semibold text-gray-900 mt-1">{selectedBroadcast.sent}</p></div>
                <div><p className="text-xs text-gray-500 uppercase">Read Receipts</p><p className="font-semibold text-green-700 mt-1 flex items-center gap-1"><Check className="w-4 h-4" />{selectedBroadcast.readCount} / {selectedBroadcast.recipients} read</p></div>
                <div><p className="text-xs text-gray-500 uppercase">Status</p><span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-medium ${selectedBroadcast.status === "Delivered" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>{selectedBroadcast.status}</span></div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Read Receipt Rate</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.round((selectedBroadcast.readCount / selectedBroadcast.recipients) * 100)}%` }} />
                  </div>
                  <span className="text-sm font-bold text-gray-900">{Math.round((selectedBroadcast.readCount / selectedBroadcast.recipients) * 100)}%</span>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setSelectedBroadcast(null)} className="px-5 py-2 bg-[#2D6A4F] text-white rounded-lg hover:bg-[#1B4332] transition-colors">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
