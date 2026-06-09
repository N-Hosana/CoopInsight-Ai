import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Plus, Download, Calendar, BarChart3, FileText } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface Activity {
  id: string;
  type: string;
  title: string;
  cooperative: string;
  amount: string;
  description: string;
  date: string;
  status: "Planned" | "Ongoing" | "Completed";
  resourcesAllocated?: number;
  resourcesUtilized?: number;
  outcome?: string;
  impact?: string;
  attachments?: { name: string; size: string }[];
  participantsCount?: number;
}

const initialActivities: Activity[] = [
  {
    id: "1",
    type: "Production",
    title: "Monthly Cooperative Meeting",
    cooperative: "Green Valley Farmers",
    amount: "RWF 2,450",
    description: "Harvest of organic vegetables",
    date: "2026-04-14",
    status: "Completed",
    resourcesAllocated: 10000000,
    resourcesUtilized: 8500000,
    outcome: "Discussed financial performance and member concerns",
    impact: "Members voted on new cooperative policies",
    participantsCount: 45,
    attachments: [
      { name: "Meeting_Minutes.pdf", size: "245 KB" },
      { name: "Financial_Summary.xlsx", size: "1.2 MB" },
    ],
  },
  {
    id: "2",
    type: "Distribution",
    cooperative: "Artisan Crafts Collective",
    title: "Training Workshop",
    amount: "RWF 1,820",
    description: "Market distribution to local stores",
    date: "2026-04-13",
    status: "Completed",
    resourcesAllocated: 6000000,
    resourcesUtilized: 5500000,
    outcome: "30 members trained on new production techniques",
    impact: "Expected 25% increase in production yield",
    participantsCount: 32,
    attachments: [{ name: "Training_Materials.pdf", size: "3.4 MB" }],
  },
  {
    id: "3",
    type: "Marketing",
    cooperative: "Dairy Producers Alliance",
    title: "Community Outreach Event",
    amount: "RWF 950",
    description: "Social media campaign",
    date: "2026-04-12",
    status: "Ongoing",
    resourcesAllocated: 4000000,
    resourcesUtilized: 3200000,
    outcome: "Marketing campaign reaching 5000+ people",
    participantsCount: 25,
    attachments: [{ name: "Event_Photos.zip", size: "45 MB" }],
  },
  {
    id: "4",
    type: "Training",
    cooperative: "Tech Innovation Hub",
    title: "Skill Development Program",
    amount: "RWF 3,200",
    description: "Member skill development workshop",
    date: "2026-04-11",
    status: "Planned",
    resourcesAllocated: 7500000,
    resourcesUtilized: 0,
    participantsCount: 50,
  },
  {
    id: "5",
    type: "Production",
    cooperative: "Green Valley Farmers",
    title: "Dairy Production Cycle",
    amount: "RWF 1,650",
    description: "Dairy processing",
    date: "2026-04-10",
    status: "Completed",
    resourcesAllocated: 8000000,
    resourcesUtilized: 7800000,
    outcome: "Processed 500L of dairy products",
    impact: "Generated revenue of RWF 2.4M",
    participantsCount: 15,
  },
];

export function Activities() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activities] = useState<Activity[]>(() => {
    const saved = localStorage.getItem("coopinsight_activities");
    return saved ? JSON.parse(saved) : initialActivities;
  });
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedCooperative, setSelectedCooperative] = useState<string>("All Cooperatives");
  const [selectedStatus, setSelectedStatus] = useState<string>("All Status");
  const [] = useState<string>("All Types");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("coopinsight_activities", JSON.stringify(activities));
  }, [activities]);

  const isRestrictedByCooperative = user?.role === "manager" || user?.role === "member";
  const cooperativeOptions = isRestrictedByCooperative
    ? [user?.cooperativeName || "My Cooperative"]
    : ["All Cooperatives", ...Array.from(new Set(activities.map((activity) => activity.cooperative)))];

  useEffect(() => {
    if (isRestrictedByCooperative && user?.cooperativeName) {
      setSelectedCooperative(user.cooperativeName);
    }
  }, [isRestrictedByCooperative, user?.cooperativeName]);

  const statusOptions = ["All Status", "Planned", "Ongoing", "Completed"];


  const filteredActivities = activities.filter((activity) => {
    if (isRestrictedByCooperative && user?.cooperativeName) {
      if (activity.cooperative !== user.cooperativeName) return false;
    }
    const coopMatch = selectedCooperative === "All Cooperatives" || activity.cooperative === selectedCooperative;
    const statusMatch = selectedStatus === "All Status" || activity.status === selectedStatus;
    const searchText = searchQuery.trim().toLowerCase();
    const searchMatch =
      !searchText ||
      activity.title.toLowerCase().includes(searchText) ||
      activity.description.toLowerCase().includes(searchText) ||
      activity.cooperative.toLowerCase().includes(searchText) ||
      activity.type.toLowerCase().includes(searchText);
    const startDateMatch = !dateRange.start || new Date(activity.date) >= new Date(dateRange.start);
    const endDateMatch = !dateRange.end || new Date(activity.date) <= new Date(dateRange.end);
    return coopMatch && statusMatch && searchMatch && startDateMatch && endDateMatch;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatCurrency = (value: number) => {
    return `₣${value.toLocaleString("en-RW")}`;
  };

  const handleExportReport = () => {
    const report = `
ACTIVITIES PERFORMANCE REPORT
Generated: ${new Date().toLocaleString()}

ACTIVITY SUMMARY
Total Activities: ${activities.length}
Completed: ${activities.filter((a) => a.status === "Completed").length}
Ongoing: ${activities.filter((a) => a.status === "Ongoing").length}
Planned: ${activities.filter((a) => a.status === "Planned").length}

DETAILED ACTIVITIES
${activities
  .map(
    (activity) => `
Activity: ${activity.title}
Cooperative: ${activity.cooperative}
Type: ${activity.type}
Date: ${activity.date}
Status: ${activity.status}
Resources Allocated: ${activity.resourcesAllocated ? formatCurrency(activity.resourcesAllocated) : "N/A"}
Resources Utilized: ${activity.resourcesUtilized ? formatCurrency(activity.resourcesUtilized) : "N/A"}
Participants: ${activity.participantsCount || "N/A"}
Outcome: ${activity.outcome || "Pending"}
Impact: ${activity.impact || "To be determined"}
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

  const getResourceUtilizationPercent = (utilized?: number, allocated?: number) => {
    if (!utilized || !allocated) return 0;
    return Math.round((utilized / allocated) * 100);
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
          {filteredActivities.map((activity) => (
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
                      {activity.cooperative}
                    </span>
                    <span className="text-lg font-medium text-[#2D6A4F]">{activity.amount}</span>
                  </div>
                  <p className="text-gray-600 mb-3">{activity.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Date</p>
                      <p className="font-medium text-gray-900">{formatDate(activity.date)}</p>
                    </div>
                    {activity.resourcesAllocated && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Resources Allocated</p>
                        <p className="font-medium text-gray-900">{formatCurrency(activity.resourcesAllocated)}</p>
                      </div>
                    )}
                    {activity.resourcesUtilized !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Utilized</p>
                        <div>
                          <p className="font-medium text-gray-900">
                            {formatCurrency(activity.resourcesUtilized)}
                          </p>
                          {activity.resourcesAllocated && (
                            <p className="text-xs text-gray-600">
                              {getResourceUtilizationPercent(activity.resourcesUtilized, activity.resourcesAllocated)}%
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {activity.participantsCount && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Participants</p>
                        <p className="font-medium text-gray-900">{activity.participantsCount}</p>
                      </div>
                    )}
                  </div>

                  {(activity.outcome || activity.impact) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      {activity.outcome && (
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                          <p className="text-xs font-medium text-blue-900 mb-1">Outcome</p>
                          <p className="text-sm text-blue-800">{activity.outcome}</p>
                        </div>
                      )}
                      {activity.impact && (
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                          <p className="text-xs font-medium text-green-900 mb-1">Impact</p>
                          <p className="text-sm text-green-800">{activity.impact}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {activity.attachments && activity.attachments.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileText className="w-4 h-4" />
                      {activity.attachments.length} attachment{activity.attachments.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <span className="text-xs text-gray-500">{activity.type}</span>
                <button className="text-[#2563EB] hover:text-[#1d4ed8] text-sm font-medium">
                  View Details →
                </button>
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
                const count = activities.filter((a) => a.status === (status as any)).length;
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
            <p className="text-2xl font-bold text-gray-900">{activities.length}</p>
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

