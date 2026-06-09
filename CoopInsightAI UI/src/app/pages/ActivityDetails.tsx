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
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";


interface ActivityAttachment {
  id: string;
  name: string;
  type: "photo" | "document";
  size: string;
  uploadedAt: string;
}

interface ActivityDetail {
  id: string;
  title: string;
  type: string;
  date: string;
  status: "Planned" | "Ongoing" | "Completed";
  description: string;
  resourcesAllocated: number;
  resourcesUtilized: number;
  participantsCount: number;
  outcome?: string;
  impact?: string;
  attachments: ActivityAttachment[];
  history: {
    date: string;
    status: "Planned" | "Ongoing" | "Completed";
    notes: string;
  }[];
  createdBy: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
}

const mockActivities: Record<string, ActivityDetail> = {
  "1": {
    id: "1",
    title: "Monthly Cooperative Meeting",
    type: "Production",
    date: "2026-04-14",
    status: "Completed",
    description: "Harvest of organic vegetables for market distribution",
    resourcesAllocated: 10000000,
    resourcesUtilized: 8500000,
    participantsCount: 45,
    outcome: "Discussed financial performance Q1, approved new member fee structure, elected audit committee",
    impact: "Members voted on cooperative policies affecting 320+ members. Established quarterly review process for financial transparency.",
    attachments: [
      { id: "a1", name: "Meeting_Minutes.pdf", type: "document", size: "245 KB", uploadedAt: "2026-04-14" },
      { id: "a2", name: "Financial_Summary.xlsx", type: "document", size: "1.2 MB", uploadedAt: "2026-04-14" },
      { id: "a3", name: "Meeting_Photos.zip", type: "photo", size: "45 MB", uploadedAt: "2026-04-14" },
    ],
    history: [
      {
        date: "2026-04-14",
        status: "Completed",
        notes: "Meeting concluded successfully. All agenda items covered.",
      },
      {
        date: "2026-04-10",
        status: "Ongoing",
        notes: "Meeting in progress at Kigali office",
      },
      {
        date: "2026-04-05",
        status: "Planned",
        notes: "Activity scheduled and invitations sent to members",
      },
    ],
    createdBy: "David Mugisha (Chairperson)",
    lastModifiedBy: "Sarah Johnson (Treasurer)",
    lastModifiedDate: "2026-04-14",
  },
  "2": {
    id: "2",
    title: "Training Workshop",
    type: "Training",
    date: "2026-04-13",
    status: "Completed",
    description: "Member skill development workshop on production techniques",
    resourcesAllocated: 6000000,
    resourcesUtilized: 5500000,
    participantsCount: 32,
    outcome: "30 members trained on improved production techniques. Certification issued.",
    impact: "Expected 25% increase in production yield and improved product quality standards.",
    attachments: [
      { id: "b1", name: "Training_Materials.pdf", type: "document", size: "3.4 MB", uploadedAt: "2026-04-13" },
      { id: "b2", name: "Certificates.pdf", type: "document", size: "2.1 MB", uploadedAt: "2026-04-13" },
      { id: "b3", name: "Training_Photos.zip", type: "photo", size: "32 MB", uploadedAt: "2026-04-13" },
    ],
    history: [
      {
        date: "2026-04-13",
        status: "Completed",
        notes: "Workshop successfully concluded. 32 members certified.",
      },
      {
        date: "2026-04-12",
        status: "Ongoing",
        notes: "Training day 2: Practical sessions ongoing",
      },
      {
        date: "2026-04-11",
        status: "Ongoing",
        notes: "Training day 1: Theory and introduction to new techniques",
      },
    ],
    createdBy: "Aline Uwase (Secretary)",
    lastModifiedBy: "David Mugisha (Chairperson)",
    lastModifiedDate: "2026-04-13",
  },
};

export function ActivityDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ActivityDetail | null>(null);
  const [newAttachment, setNewAttachment] = useState({ name: "", type: "document" as "photo" | "document" });

  useEffect(() => {
    const data = mockActivities[id || "1"] || mockActivities["1"];
    setActivity(data);
    setFormData(data);
  }, [id]);

  const canEdit = user?.role === "manager" || user?.role === "admin";

  const formatCurrency = (value: number) => {
    return `₣${value.toLocaleString("en-RW")}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const utilizationPercent = formData ? Math.round((formData.resourcesUtilized / formData.resourcesAllocated) * 100) : 0;

  const handleSave = () => {
    if (formData) {
      setActivity(formData);
      setIsEditing(false);
      const activities = JSON.parse(localStorage.getItem("coopinsight_activities") || "[]");
      const updated = activities.map((a: any) => (a.id === formData.id ? formData : a));
      localStorage.setItem("coopinsight_activities", JSON.stringify(updated));
    }
  };

  const handleAddAttachment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData || !newAttachment.name) return;

    const attachment: ActivityAttachment = {
      id: `att-${Date.now()}`,
      name: newAttachment.name,
      type: newAttachment.type as "photo" | "document",
      size: "0 KB",
      uploadedAt: formatDate(new Date().toISOString()),
    };

    setFormData({
      ...formData,
      attachments: [...formData.attachments, attachment],
    });

    setNewAttachment({ name: "", type: "document" });
  };

  const handleRemoveAttachment = (attId: string) => {
    if (!formData) return;
    setFormData({
      ...formData,
      attachments: formData.attachments.filter((a) => a.id !== attId),
    });
  };

  const handleExportReport = () => {
    if (!activity) return;

    const report = `
ACTIVITY DETAILED REPORT
Generated: ${new Date().toLocaleString()}

ACTIVITY INFORMATION
Title: ${activity.title}
Type: ${activity.type}
Date: ${formatDate(activity.date)}
Status: ${activity.status}
Description: ${activity.description}

RESOURCE UTILIZATION
Resources Allocated: ${formatCurrency(activity.resourcesAllocated)}
Resources Utilized: ${formatCurrency(activity.resourcesUtilized)}
Utilization Rate: ${utilizationPercent}%
Remaining: ${formatCurrency(activity.resourcesAllocated - activity.resourcesUtilized)}

PARTICIPATION
Total Participants: ${activity.participantsCount}

OUTCOMES & IMPACT
Outcome:
${activity.outcome || "Not specified"}

Impact:
${activity.impact || "Not specified"}

ATTACHMENTS (${activity.attachments.length})
${activity.attachments.map((a) => `- ${a.name} (${a.type}) - ${a.size} - ${a.uploadedAt}`).join("\n")}

ACTIVITY HISTORY
${activity.history
  .map((h) => `${formatDate(h.date)}: ${h.status} - ${h.notes}`)
  .join("\n")}

AUDIT INFORMATION
Created by: ${activity.createdBy}
Last Modified by: ${activity.lastModifiedBy}
Last Modified Date: ${formatDate(activity.lastModifiedDate)}
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

  if (!activity || !formData) {
    return <div className="text-center py-10">Loading...</div>;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-green-100 text-green-800";
      case "Ongoing":
        return "bg-blue-100 text-blue-800";
      case "Planned":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

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
            <Button variant="secondary" onClick={() => setIsEditing(!isEditing)}>
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

      <Card className="p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{formData.title}</h1>
              <span className={`text-sm font-medium px-3 py-1 rounded-full ${getStatusColor(formData.status)}`}>
                {formData.status}
              </span>
            </div>
            <p className="text-gray-600">{formData.type} • {formatDate(formData.date)}</p>
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
                  value={formData.participantsCount}
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
                placeholder="Describe the activity outcomes..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Impact</label>
              <textarea
                value={formData.impact || ""}
                onChange={(e) => setFormData({ ...formData, impact: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                rows={3}
                placeholder="Describe the expected impact..."
              />
            </div>
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        ) : (
          <p className="text-gray-700 leading-relaxed">{formData.description}</p>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <p className="text-lg font-semibold text-gray-900">{formatCurrency(formData.resourcesAllocated)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Utilized</p>
              <p className="text-lg font-semibold text-[#2563EB]">{formatCurrency(formData.resourcesUtilized)}</p>
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
              <p className="text-2xl font-bold text-gray-900">{formData.participantsCount}</p>
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
              <p className="font-semibold text-gray-900">{formatDate(formData.date)}</p>
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

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Paperclip className="w-5 h-5" />
            Attachments ({formData.attachments.length})
          </h2>
          {canEdit && isEditing && (
            <Button size="sm" variant="secondary" onClick={() => document.getElementById("attachment-form")?.scrollIntoView()}>
              Add Attachment
            </Button>
          )}
        </div>

        {canEdit && isEditing && (
          <form id="attachment-form" onSubmit={handleAddAttachment} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={newAttachment.name}
                onChange={(e) => setNewAttachment({ ...newAttachment, name: e.target.value })}
                placeholder="Document name"
                className="col-span-2 rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                required
              />
              <select
                value={newAttachment.type}
                onChange={(e) => setNewAttachment({ ...newAttachment, type: e.target.value as any })}
                className="rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="document">Document</option>
                <option value="photo">Photo</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Add Attachment
            </Button>
          </form>
        )}

        <div className="space-y-2">
          {formData.attachments.map((att) => (
            <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100">
              <div className="flex items-center gap-3 flex-1">
                {att.type === "photo" ? (
                  <span className="text-blue-600">📷</span>
                ) : (
                  <FileText className="w-4 h-4 text-gray-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{att.name}</p>
                  <p className="text-xs text-gray-500">
                    {att.type === "photo" ? "Photo" : "Document"} • {att.size} • {att.uploadedAt}
                  </p>
                </div>
              </div>
              {canEdit && isEditing && (
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="text-red-600 hover:text-red-700 p-2"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

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
                {idx < formData.history.length - 1 && <div className="w-0.5 h-12 bg-gray-300 mt-2"></div>}
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

      <Card className="p-6 space-y-3 bg-gray-50">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Audit Information
        </h3>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Created by</p>
            <p className="font-medium text-gray-900">{formData.createdBy}</p>
          </div>
          <div>
            <p className="text-gray-600">Last Modified by</p>
            <p className="font-medium text-gray-900">{formData.lastModifiedBy}</p>
          </div>
          <div>
            <p className="text-gray-600">Last Modified</p>
            <p className="font-medium text-gray-900">{formatDate(formData.lastModifiedDate)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
