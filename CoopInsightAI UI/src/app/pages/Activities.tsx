import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Plus, Download, Calendar, BarChart3, FileText } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

interface Activity {
  id: string;
  type: string;
  title: string;
  cooperative_name: string;
  description: string;
  scheduled_date: string;
  status: "Planned" | "Ongoing" | "Completed";
  location?: string;
  cooperative_id?: string;
  participant_count?: number;
  created_by_name?: string;
}

export function Activities() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedCooperative, setSelectedCooperative] = useState<string>("All Cooperatives");
  const [selectedStatus, setSelectedStatus] = useState<string>("All Status");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  const isRestrictedByCooperative = user?.role === "manager" || user?.role === "member";

  useEffect(() => {
    if (isRestrictedByCooperative && user?.cooperativeName) {
      setSelectedCooperative(user.cooperativeName);
    }
  }, [isRestrictedByCooperative, user?.cooperativeName]);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "20");
      if (selectedStatus !== "All Status") params.set("status", selectedStatus);
      if (
        selectedCooperative !== "All Cooperatives" &&
        user?.cooperativeId
      ) {
        params.set("cooperative_id", user.cooperativeId);
      }
      const response = await api.get(`/activities?${params.toString()}`);
      const data = response.data;
      setActivities(data.activities || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to load activities.");
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, selectedCooperative, user?.cooperativeId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this activity?")) return;
    try {
      await api.delete(`/activities/${id}`);
      fetchActivities();
    } catch (err: any) {
      alert(err?.response?.data?.message || "Failed to delete activity.");
    }
  };

  const cooperativeOptions = isRestrictedByCooperative
    ? [user?.cooperativeName || "My Cooperative"]
    : ["All Cooperatives", ...Array.from(new Set(activities.map((a) => a.cooperative_name).filter(Boolean)))];

  const statusOptions = ["All Status", "Planned", "Ongoing", "Completed"];

  const filteredActivities = activities.filter((activity) => {
    if (isRestrictedByCooperative && user?.cooperativeName) {
      if (activity.cooperative_name !== user.cooperativeName) return false;
    }
    const coopMatch =
      selectedCooperative === "All Cooperatives" || activity.cooperative_name === selectedCooperative;
    const statusMatch = selectedStatus === "All Status" || activity.status === selectedStatus;
    const searchText = searchQuery.trim().toLowerCase();
    const searchMatch =
      !searchText ||
      activity.title.toLowerCase().includes(searchText) ||
      activity.description?.toLowerCase().includes(searchText) ||
      activity.cooperative_name?.toLowerCase().includes(searchText) ||
      activity.type?.toLowerCase().includes(searchText);
    const startDateMatch = !dateRange.start || new Date(activity.scheduled_date) >= new Date(dateRange.start);
    const endDateMatch = !dateRange.end || new Date(activity.scheduled_date) <= new Date(dateRange.end);
    return coopMatch && statusMatch && searchMatch && startDateMatch && endDateMatch;
  });

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const handleExportReport = () => {
    const report = `
ACTIVITIES PERFORMANCE REPORT
Generated: ${new Date().toLocaleString()}

ACTIVITY SUMMARY
Total Activities: ${total}
Completed: ${activities.filter((a) => a.status === "Completed").length}
Ongoing: ${activities.filter((a) => a.status === "Ongoing").length}
Planned: ${activities.filter((a) => a.status === "Planned").length}

DETAILED ACTIVITIES
${activities
  .map(
    (activity) => `
Activity: ${activity.title}
Cooperative: ${activity.cooperative_name}
Type: ${activity.type}
Date: ${activity.scheduled_date}
Status: ${activity.status}
Participants: ${activity.participant_count ?? "N/A"}
Location: ${activity.location || "N/A"}
`
  )
  .join("\n")}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activities-report-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
    <div className="max-w-[1440px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Activities Management</h1>
          <p className="text-gray-600 mt-1">Track cooperative activities, outcomes, and performance</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleExportReport}>
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
          {(user?.role === "manager" || user?.role === "admin") && (
            <Button onClick={() => navigate("/activities/new")}>
              <Plus className="w-4 h-4 inline-block mr-2" />
              Add Activity
            </Button>
          )}
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("list")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === "list"
                ? "bg-[#2563EB] text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            List View
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === "calendar"
                ? "bg-[#2563EB] text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Calendar className="w-4 h-4 inline mr-2" />
            Calendar View
          </button>
        </div>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search activities</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by title, cooperative, type..."
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cooperative</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={selectedCooperative}
              onChange={(event) => setSelectedCooperative(event.target.value)}
              disabled={isRestrictedByCooperative}
            >
              {cooperativeOptions.map((cooperative) => (
                <option key={cooperative} value={cooperative}>
                  {cooperative}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={dateRange.start}
              onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={dateRange.end}
              onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })}
            />
          </div>
        </div>
      </div>

      {/* List View */}
      {viewMode === "list" && (
        <div className="space-y-4">
          {loading && (
            <div className="text-center py-12 text-gray-500">Loading activities...</div>
          )}
          {error && !loading && (
            <div className="text-center py-12 text-red-600">{error}</div>
          )}
          {!loading && !error && filteredActivities.length === 0 && (
            <div className="text-center py-12 text-gray-500">No activities found.</div>
          )}
          {!loading && !error && filteredActivities.map((activity) => (
            <Card
              key={activity.id}
              className="p-6 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/activities/${activity.id}`)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h3 className="font-semibold text-gray-900 text-lg">{activity.title}</h3>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full ${getStatusColor(activity.status)}`}>
                      {activity.status}
                    </span>
                    <span className="text-sm font-medium px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                      {activity.cooperative_name}
                    </span>
                  </div>
                  {activity.description && (
                    <p className="text-gray-600 mb-3">{activity.description}</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Scheduled Date</p>
                      <p className="font-medium text-gray-900">{formatDate(activity.scheduled_date)}</p>
                    </div>
                    {activity.location && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Location</p>
                        <p className="font-medium text-gray-900">{activity.location}</p>
                      </div>
                    )}
                    {activity.participant_count !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Participants</p>
                        <p className="font-medium text-gray-900">{activity.participant_count}</p>
                      </div>
                    )}
                    {activity.created_by_name && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Created By</p>
                        <p className="font-medium text-gray-900">{activity.created_by_name}</p>
                      </div>
                    )}
                  </div>

                  {activity.status === "Planned" && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileText className="w-4 h-4" />
                      <span className="text-gray-500 text-xs">Planned activity</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <span className="text-xs text-gray-500">{activity.type}</span>
                <div className="flex items-center gap-3">
                  {activity.status === "Planned" && (user?.role === "manager" || user?.role === "admin") && (
                    <button
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                      onClick={(e) => handleDelete(activity.id, e)}
                    >
                      Delete
                    </button>
                  )}
                  <button className="text-[#2563EB] hover:text-[#1d4ed8] text-sm font-medium">
                    View Details →
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <Card className="p-6">
          <div className="bg-gray-50 rounded-lg p-6 text-center">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 mb-2">Activity Calendar View</p>
            <p className="text-sm text-gray-500">
              Click on activities to see detailed information. Upcoming features include advanced calendar filtering.
            </p>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              {["Planned", "Ongoing", "Completed"].map((status) => {
                const count = activities.filter((a) => a.status === (status as Activity["status"])).length;
                return (
                  <div key={status} className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-sm text-gray-600">{status}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{count}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Performance Analytics */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-gray-900">Performance Analytics</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-2">Total Activities</p>
            <p className="text-2xl font-bold text-gray-900">{total}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-green-700 font-medium mb-2">Completed</p>
            <p className="text-2xl font-bold text-green-900">
              {activities.filter((a) => a.status === "Completed").length}
            </p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-700 font-medium mb-2">Ongoing</p>
            <p className="text-2xl font-bold text-blue-900">
              {activities.filter((a) => a.status === "Ongoing").length}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-2">Planned</p>
            <p className="text-2xl font-bold text-gray-900">
              {activities.filter((a) => a.status === "Planned").length}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
