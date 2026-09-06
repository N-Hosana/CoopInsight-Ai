import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import {
  ArrowLeft,
  Edit2,
  Save,
  X,
  Download,
  Calendar,
  Users,
  Zap,
  FileText,
  Paperclip,
  AlertCircle,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const STATUS_DISPLAY: Record<string, "Planned" | "Ongoing" | "Completed" | "Cancelled"> = {
  planned: "Planned",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_API: Record<string, string> = {
  Planned: "planned",
  Ongoing: "ongoing",
  Completed: "completed",
  Cancelled: "cancelled",
};

interface ActivityAttachment {
  id: string;
  name: string;
  url?: string;
  size_bytes?: number;
  uploaded_at: string;
}

interface Participant {
  id: string;
  member_id: string;
  member_name: string;
  joined_at: string;
}

interface ActivityDetail {
  id: string;
  title: string;
  type: string;
  // Backend field names
  scheduled_date?: string;
  location?: string;
  cooperative_name?: string;
  participant_count?: number;
  created_by_name?: string;
  // Legacy / UI-enriched fields
  date?: string;
  status: "Planned" | "Ongoing" | "Completed" | "Cancelled";
  description: string;
  resourcesAllocated?: number;
  resourcesUtilized?: number;
  participantsCount?: number;
  outcome?: string;
  impact?: string;
  history?: {
    date: string;
    status: "Planned" | "Ongoing" | "Completed";
    notes: string;
  }[];
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedDate?: string;
}

export function ActivityDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ActivityDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<ActivityAttachment[]>([]);
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

  // Register participant
  const [registerMemberId, setRegisterMemberId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  const fetchActivity = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [actRes, partRes, attRes] = await Promise.allSettled([
        api.get<{ activity: ActivityDetail } | ActivityDetail>(`/activities/${id}`),
        api.get<{ participants: Participant[] }>(`/activities/${id}/participants`),
        api.get<{ data: ActivityAttachment[] } | ActivityAttachment[]>(`/activities/${id}/attachments`),
      ]);

      if (actRes.status === "fulfilled") {
        const data = (actRes.value as any).data ?? actRes.value;
        // Normalise date field
        const normalised: ActivityDetail = {
          ...data,
          date: data.date || data.scheduled_date || "",
          participantsCount: data.participantsCount ?? data.participant_count ?? 0,
          createdBy: data.createdBy || data.created_by_name || "",
          history: data.history || [],
          status: STATUS_DISPLAY[data.status] ?? data.status,
        };
        setActivity(normalised);
        setFormData(normalised);
      } else {
        setError("Failed to load activity details.");
      }

      if (partRes.status === "fulfilled") {
        setParticipants((partRes.value as any).data ?? []);
      }

      if (attRes.status === "fulfilled") {
        const raw = (attRes.value as any).data ?? attRes.value;
        setAttachments(Array.isArray(raw) ? raw : []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canEdit = user?.role === "manager" || user?.role === "admin";

  const formatCurrency = (value: number) => `RWF ${value.toLocaleString("en-RW")}`;

  const formatDate = (dateString: string) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const resourcesAllocated = formData?.resourcesAllocated ?? 0;
  const resourcesUtilized = formData?.resourcesUtilized ?? 0;
  const utilizationPercent = resourcesAllocated > 0 ? Math.round((resourcesUtilized / resourcesAllocated) * 100) : 0;

  const handleSave = async () => {
    if (!formData || !id || !activity) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/activities/${id}`, {
        title: formData.title,
        description: formData.description,
        outcome: formData.outcome,
        impact: formData.impact,
      });

      if (formData.status !== activity.status) {
        await api.patch(`/activities/${id}/status`, {
          status: STATUS_API[formData.status] ?? formData.status.toLowerCase(),
        });
      }

      await fetchActivity();
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !registerMemberId.trim()) return;
    setRegistering(true);
    setRegisterError(null);
    setRegisterSuccess(null);
    try {
      await api.post(`/activities/${id}/participants`, { member_id: registerMemberId.trim() });
      setRegisterSuccess("Participant registered successfully.");
      setRegisterMemberId("");
      // Refresh participants list
      const res = await api.get<{ data: Participant[] }>(`/activities/${id}/participants`);
      setParticipants((res as any).data ?? []);
    } catch (err: any) {
      setRegisterError(err?.message || "Failed to register participant.");
    } finally {
      setRegistering(false);
    }
  };

  const handleAddAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !attachmentFile) return;

    setUploadingAttachment(true);
    setAttachmentError(null);

    const token = localStorage.getItem("coopinsight_access_token");
    const body = new FormData();
    body.append("file", attachmentFile);
    body.append("name", attachmentName || attachmentFile.name);

    try {
      const res = await fetch(`${BASE_URL}/activities/${id}/attachments`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setAttachmentError(data.message ?? "Upload failed. Please try again.");
      } else {
        setAttachments((prev) => [data.data, ...prev]);
        setAttachmentName("");
        setAttachmentFile(null);
      }
    } catch {
      setAttachmentError("Network error. Please check your connection and try again.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleRemoveAttachment = async (attId: string) => {
    if (!id) return;
    setDeletingAttachmentId(attId);
    try {
      await api.delete(`/activities/${id}/attachments/${attId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch (err: any) {
      setAttachmentError(err?.message ?? "Failed to delete attachment.");
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  const handleExportReport = () => {
    if (!activity) return;

    const report = `
ACTIVITY DETAILED REPORT
Generated: ${new Date().toLocaleString()}

ACTIVITY INFORMATION
Title: ${activity.title}
Type: ${activity.type}
Date: ${formatDate(activity.date || activity.scheduled_date || "")}
Status: ${activity.status}
Description: ${activity.description}

RESOURCE UTILIZATION
Resources Allocated: ${formatCurrency(resourcesAllocated)}
Resources Utilized: ${formatCurrency(resourcesUtilized)}
Utilization Rate: ${utilizationPercent}%
Remaining: ${formatCurrency(resourcesAllocated - resourcesUtilized)}

PARTICIPATION
Total Participants: ${activity.participantsCount ?? activity.participant_count ?? 0}

OUTCOMES & IMPACT
Outcome:
${activity.outcome || "Not specified"}

Impact:
${activity.impact || "Not specified"}

ATTACHMENTS (${attachments.length})
${attachments.map((a) => `- ${a.name} - ${new Date(a.uploaded_at).toLocaleDateString()}`).join("\n")}

ACTIVITY HISTORY
${(activity.history || []).map((h) => `${formatDate(h.date)}: ${h.status} - ${h.notes}`).join("\n")}

AUDIT INFORMATION
Created by: ${activity.createdBy || activity.created_by_name || "—"}
Last Modified by: ${activity.lastModifiedBy || "—"}
Last Modified Date: ${formatDate(activity.lastModifiedDate || "")}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-report-${activity.id}-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="text-center py-10 text-gray-500">Loading activity details…</div>;
  }

  if (error || !activity || !formData) {
    return (
      <div className="max-w-5xl mx-auto py-10">
        <Card className="p-6">
          <p className="text-gray-600">{error || "Activity not found."}</p>
          <button onClick={() => navigate("/activities")} className="mt-4 text-[#2563EB] hover:underline text-sm">
            ← Back to Activities
          </button>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed": return "bg-green-100 text-green-800";
      case "Ongoing": return "bg-blue-100 text-blue-800";
      case "Planned": return "bg-gray-100 text-gray-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const activityDate = formData.date || formData.scheduled_date || "";
  const participantsCount = formData.participantsCount ?? formData.participant_count ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-8">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/activities")} className="flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8]">
          <ArrowLeft className="w-4 h-4" />
          Back to Activities
        </button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleExportReport}>
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
          {canEdit && (
            <Button variant="secondary" onClick={() => { setIsEditing(!isEditing); setSaveError(null); }}>
              {isEditing ? "Cancel" : (
                <>
                  <Edit2 className="w-4 h-4 mr-2" />
                  Edit Activity
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {saveError}
        </div>
      )}

      <Card className="p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{formData.title}</h1>
              <span className={`text-sm font-medium px-3 py-1 rounded-full ${getStatusColor(formData.status)}`}>
                {formData.status}
              </span>
            </div>
            <p className="text-gray-600">
              {formData.type} • {formatDate(activityDate)}
              {formData.location ? ` • ${formData.location}` : ""}
              {formData.cooperative_name ? ` • ${formData.cooperative_name}` : ""}
            </p>
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  <option>Planned</option>
                  <option>Ongoing</option>
                  <option>Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Participants</label>
                <input
                  type="number"
                  value={participantsCount}
                  onChange={(e) => setFormData({ ...formData, participantsCount: parseInt(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Outcome</label>
              <textarea
                value={formData.outcome || ""}
                onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                rows={3}
                placeholder="Describe the activity outcomes…"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Impact</label>
              <textarea
                value={formData.impact || ""}
                onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                rows={3}
                placeholder="Describe the expected impact…"
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        ) : (
          <p className="text-gray-700 leading-relaxed">{formData.description}</p>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {resourcesAllocated > 0 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-gray-700">
                <Zap className="w-5 h-5" />
                <span className="font-medium">Resource Utilization</span>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Allocated</p>
                <p className="text-lg font-semibold text-gray-900">{formatCurrency(resourcesAllocated)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Utilized</p>
                <p className="text-lg font-semibold text-[#2563EB]">{formatCurrency(resourcesUtilized)}</p>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <p className="text-xs text-gray-500">Utilization Rate</p>
                  <p className="text-sm font-semibold text-gray-900">{utilizationPercent}%</p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      utilizationPercent > 90
                        ? "bg-green-600"
                        : utilizationPercent > 70
                        ? "bg-blue-600"
                        : "bg-orange-600"
                    }`}
                    style={{ width: `${utilizationPercent}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-gray-700">
              <Users className="w-5 h-5" />
              <span className="font-medium">Participation</span>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Total Participants</p>
              <p className="text-2xl font-bold text-gray-900">{participants.length > 0 ? participants.length : participantsCount}</p>
            </div>
            <p className="text-xs text-gray-600">Members actively involved in this activity</p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-gray-700">
              <Calendar className="w-5 h-5" />
              <span className="font-medium">Timeline</span>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Activity Date</p>
              <p className="font-semibold text-gray-900">{formatDate(activityDate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <p className={`text-sm font-semibold px-3 py-1 rounded-full w-fit ${getStatusColor(formData.status)}`}>
                {formData.status}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Register Participant */}
      {canEdit && (
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Register Participant
          </h2>
          <form onSubmit={handleRegisterParticipant} className="flex gap-3">
            <input
              type="text"
              value={registerMemberId}
              onChange={(e) => setRegisterMemberId(e.target.value)}
              placeholder="Member ID"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
              required
            />
            <Button type="submit" disabled={registering}>
              {registering ? "Registering…" : "Register"}
            </Button>
          </form>
          {registerError && <p className="text-sm text-red-600">{registerError}</p>}
          {registerSuccess && <p className="text-sm text-green-600">{registerSuccess}</p>}
        </Card>
      )}

      {/* Participants list */}
      {participants.length > 0 && (
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Registered Participants ({participants.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Member Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Member ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Joined At</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.member_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.member_id}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(p.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(formData.outcome || formData.impact) && (
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Outcomes & Impact
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {formData.outcome && (
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-900 mb-2">Activity Outcome</p>
                <p className="text-gray-800">{formData.outcome}</p>
              </div>
            )}
            {formData.impact && (
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <p className="text-sm font-medium text-green-900 mb-2">Expected Impact</p>
                <p className="text-gray-800">{formData.impact}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {(attachments.length > 0 || canEdit) && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Paperclip className="w-5 h-5" />
              Attachments ({attachments.length})
            </h2>
          </div>

          {attachmentError && <p className="text-sm text-red-600">{attachmentError}</p>}

          {canEdit && (
            <form onSubmit={handleAddAttachment} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  value={attachmentName}
                  onChange={(e) => setAttachmentName(e.target.value)}
                  placeholder="Document name (optional)"
                  className="col-span-2 rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                <input
                  type="file"
                  onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                  className="rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-600"
                />
              </div>
              <Button type="submit" size="sm" disabled={!attachmentFile || uploadingAttachment}>
                {uploadingAttachment ? "Uploading…" : "Add Attachment"}
              </Button>
            </form>
          )}

          <div className="space-y-2">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100">
                <div className="flex items-center gap-3 flex-1">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    {att.url ? (
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#2563EB] hover:underline truncate block"
                      >
                        {att.name}
                      </a>
                    ) : (
                      <p className="font-medium text-gray-900 truncate">{att.name}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      {new Date(att.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    disabled={deletingAttachmentId === att.id}
                    className="text-red-600 hover:text-red-700 p-2 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {attachments.length === 0 && (
              <p className="text-sm text-gray-500">No attachments yet.</p>
            )}
          </div>
        </Card>
      )}

      {formData.history && formData.history.length > 0 && (
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Activity History
          </h2>
          <div className="space-y-3">
            {formData.history.map((entry, idx) => (
              <div key={idx} className="flex gap-4 pb-4 border-b border-gray-200 last:border-b-0">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                    entry.status === "Completed"
                      ? "bg-green-600"
                      : entry.status === "Ongoing"
                      ? "bg-blue-600"
                      : "bg-gray-400"
                  }`}>
                    {idx + 1}
                  </div>
                  {idx < formData.history!.length - 1 && <div className="w-0.5 h-12 bg-gray-300 mt-2"></div>}
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-medium px-2 py-1 rounded ${getStatusColor(entry.status)}`}>
                      {entry.status}
                    </span>
                    <span className="text-sm text-gray-500">{formatDate(entry.date)}</span>
                  </div>
                  <p className="text-gray-700">{entry.notes}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6 space-y-3 bg-gray-50">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Audit Information
        </h3>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Created by</p>
            <p className="font-medium text-gray-900">{formData.createdBy || formData.created_by_name || "—"}</p>
          </div>
          <div>
            <p className="text-gray-600">Last Modified by</p>
            <p className="font-medium text-gray-900">{formData.lastModifiedBy || "—"}</p>
          </div>
          <div>
            <p className="text-gray-600">Last Modified</p>
            <p className="font-medium text-gray-900">{formatDate(formData.lastModifiedDate || "")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
