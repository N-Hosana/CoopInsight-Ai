import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { AlertTriangle, MapPin, Clock, Download, RefreshCw } from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { CooperativeRankings } from "./CooperativeRankings";
import { ActivityOversight } from "../components/ActivityOversight";

interface CooperativeLocation {
  id: string;
  name: string;
  district: string;
  sector: string;
  latitude: number;
  longitude: number;
  members: number;
  status: "compliant" | "at-risk" | "non-compliant";
  complianceScore: number;
  lastAudit: string;
}



interface InterventionRecommendation {
  cooperativeId: string;
  cooperativeName: string;
  riskLevel: "critical" | "high" | "medium";
  reason: string;
  recommendedAction: string;
  timeline: string;
}

interface ScheduledReport {
  id: string;
  name: string;
  frequency: "weekly" | "monthly" | "quarterly" | "annually";
  nextRun: string;
  status: "scheduled" | "running" | "completed";
  recipients: string[];
}

interface SectorData {
  sector: string;
  cooperativeCount: number;
  memberCount: number;
  totalSavings: number;
}

export function GovernmentMonitoring() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"overview" | "league" | "interventions" | "reports" | "agents" | "activities">(
    (searchParams.get("tab") as any) || "overview"
  );
  const [drillDownCoop, setDrillDownCoop] = useState<CooperativeLocation | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  // ─── API state ────────────────────────────────────────────────────────────
  const [cooperatives, setCooperatives] = useState<CooperativeLocation[]>([]);
  const [interventionRecommendations, setInterventionRecommendations] = useState<InterventionRecommendation[]>([]);
  const [sectorData, setSectorData] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Static data that doesn't come from the backend
  const scheduledReports: ScheduledReport[] = [
    {
      id: "RPT001",
      name: "Weekly Compliance Summary",
      frequency: "weekly",
      nextRun: "2026-04-21",
      status: "scheduled",
      recipients: ["minister@gov.rw", "compliance@rdb.gov.rw"],
    },
    {
      id: "RPT002",
      name: "Monthly Cooperative Performance Report",
      frequency: "monthly",
      nextRun: "2026-05-01",
      status: "scheduled",
      recipients: ["minister@gov.rw", "cooperative-dept@gov.rw"],
    },
    {
      id: "RPT003",
      name: "Quarterly Intervention Assessment",
      frequency: "quarterly",
      nextRun: "2026-06-30",
      status: "scheduled",
      recipients: ["minister@gov.rw"],
    },
    {
      id: "RPT004",
      name: "Annual Cooperative Census Report",
      frequency: "annually",
      nextRun: "2026-12-31",
      status: "scheduled",
      recipients: ["minister@gov.rw", "parliament@gov.rw"],
    },
  ];

  const fetchData = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const [coopsRes, complianceRes, overviewRes] = await Promise.all([
        api.get<any>("/cooperatives?page=1&limit=100"),
        api.get<any>("/dashboard/government/compliance"),
        api.get<any>("/dashboard/government/overview"),
      ]);

      // Map raw cooperatives list to CooperativeLocation shape
      const rawCoops: CooperativeLocation[] = ((coopsRes as any).data ?? []).map((c: any) => ({
        id: c.id ?? c._id ?? "",
        name: c.name ?? "",
        district: c.district ?? c.location?.district ?? "",
        sector: c.sector ?? c.location?.sector ?? "",
        latitude: c.latitude ?? c.location?.latitude ?? 0,
        longitude: c.longitude ?? c.location?.longitude ?? 0,
        members: c.memberCount ?? c.members ?? 0,
        status: c.status ?? "compliant",
        complianceScore: c.complianceScore ?? 0,
        lastAudit: c.lastAudit ?? "",
      }));
      setCooperatives(rawCoops);

      // Map compliance data from /dashboard/government/compliance
      const complianceData = (complianceRes as any).data ?? {};
      const nonCompliantList = complianceData.nonCompliantList ?? [];

      // Build intervention recommendations from non-compliant cooperatives
      const interventions: InterventionRecommendation[] = nonCompliantList.map((c: any) => ({
        cooperativeId: String(c.id),
        cooperativeName: c.name,
        riskLevel: (c.health_score ?? 0) < 40 ? "critical" : "high",
        reason: `Health score ${c.health_score ?? 0}%`,
        recommendedAction:
          (c.health_score ?? 0) < 40
            ? "Immediate regulatory intervention required. Conduct compliance audit within 2 weeks."
            : "Issue compliance notice. Schedule follow-up audit within 30 days.",
        timeline: (c.health_score ?? 0) < 40 ? "Within 2 weeks" : "Within 30 days",
      }));
      setInterventionRecommendations(interventions);

      const overviewData = (overviewRes as any).data ?? {};
      setSectorData(
        (overviewData.breakdownBySector ?? []).map((s: any) => ({
          sector: s.sector ?? "",
          cooperativeCount: parseInt(s.count) || 0,
          memberCount: 0,
          totalSavings: 0,
        }))
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to load monitoring data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      setLastRefresh(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshData = () => {
    fetchData();
  };

  const complianceByStatus = {
    compliant: cooperatives.filter((c) => c.status === "compliant").length,
    "at-risk": cooperatives.filter((c) => c.status === "at-risk").length,
    "non-compliant": cooperatives.filter((c) => c.status === "non-compliant").length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "compliant":
        return "bg-green-100 text-green-800";
      case "at-risk":
        return "bg-yellow-100 text-yellow-800";
      case "non-compliant":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };


  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      {/* Drill-down modal */}
      {drillDownCoop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">{drillDownCoop.name}</h2>
              <button onClick={() => setDrillDownCoop(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <span className="text-gray-500 text-lg font-bold">✕</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">District</p>
                  <p className="font-semibold text-gray-900">{drillDownCoop.district}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Sector</p>
                  <p className="font-semibold text-gray-900">{drillDownCoop.sector}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Members</p>
                  <p className="font-semibold text-gray-900">{drillDownCoop.members}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Last Audit</p>
                  <p className="font-semibold text-gray-900">{drillDownCoop.lastAudit}</p>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">Compliance Score</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full ${
                        drillDownCoop.complianceScore >= 80 ? "bg-green-500" :
                        drillDownCoop.complianceScore >= 60 ? "bg-yellow-500" : "bg-red-500"
                      }`}
                      style={{ width: `${drillDownCoop.complianceScore}%` }}
                    />
                  </div>
                  <span className="font-bold text-gray-900">{drillDownCoop.complianceScore}%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(drillDownCoop.status)}`}>
                  {drillDownCoop.status.toUpperCase()}
                </span>
                {(drillDownCoop.latitude !== 0 || drillDownCoop.longitude !== 0) && (
                  <p className="text-xs text-gray-500">Coordinates: {drillDownCoop.latitude.toFixed(4)}, {drillDownCoop.longitude.toFixed(4)}</p>
                )}
              </div>
              {interventionRecommendations.find(i => i.cooperativeId === drillDownCoop.id) && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-900 mb-1">Active Intervention</p>
                  <p className="text-sm text-red-800">{interventionRecommendations.find(i => i.cooperativeId === drillDownCoop.id)?.recommendedAction}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user?.oversightLevel === "sector"
              ? `${user?.sector ?? "Sector"} Sector Monitoring`
              : user?.oversightLevel === "rca"
                ? "RCA Monitoring"
                : "District Monitoring"}
          </h1>
          <p className="text-gray-600 mt-1">
            Cooperative compliance, interventions, the district league table and regulatory
            oversight
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm text-gray-600">Last Refresh</p>
            <p className="text-xs text-gray-500">{lastRefresh.toLocaleTimeString()}</p>
          </div>
          <Button onClick={handleRefreshData} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {[
          { id: "overview", label: "Overview" },
          // The league table belongs here rather than on a page of its own —
          // it is the same question this page exists to answer ("who is doing
          // well and who is slipping"), asked with numbers.
          { id: "league", label: "League Table" },
          { id: "agents", label: "Agent Activity" },
          { id: "activities", label: "Activity Monitoring" },
          { id: "interventions", label: "Interventions" },
          { id: "reports", label: "Scheduled Reports" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-[#2D6A4F] text-[#2D6A4F]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 text-[#2D6A4F] animate-spin mx-auto mb-3" />
            <p className="text-gray-600">Loading monitoring data...</p>
          </div>
        </div>
      )}

      {/*
        The district league table, in the page whose job it already is. It was
        a separate sidebar entry answering the same question this page answers
        — which cooperatives are doing well and which are slipping — so an
        officer had to hold two screens in their head to get one answer.
      */}
      {activeTab === "league" && <CooperativeRankings embedded />}

      {!loading && activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-6">
            <Card className="p-6">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Total Cooperatives</p>
                  <p className="text-3xl font-bold text-gray-900">{cooperatives.length}</p>
                </div>
              </div>
              <div className="text-xs text-gray-600">Registered cooperatives under supervision</div>
            </Card>
            <Card className="p-6 bg-green-50">
              <p className="text-sm text-green-700 mb-1">Compliant</p>
              <p className="text-3xl font-bold text-green-900">{complianceByStatus.compliant}</p>
              <div className="text-xs text-green-700 mt-2">
                {cooperatives.length > 0 ? Math.round((complianceByStatus.compliant / cooperatives.length) * 100) : 0}% of total
              </div>
            </Card>
            <Card className="p-6 bg-yellow-50">
              <p className="text-sm text-yellow-700 mb-1">At Risk</p>
              <p className="text-3xl font-bold text-yellow-900">{complianceByStatus["at-risk"]}</p>
              <div className="text-xs text-yellow-700 mt-2">Require monitoring</div>
            </Card>
            <Card className="p-6 bg-red-50">
              <p className="text-sm text-red-700 mb-1">Non-Compliant</p>
              <p className="text-3xl font-bold text-red-900">{complianceByStatus["non-compliant"]}</p>
              <div className="text-xs text-red-700 mt-2">Urgent action required</div>
            </Card>
          </div>

          {sectorData.length > 0 && (
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Cooperatives by Sector</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Sector", "Cooperatives", "Members", "Total Savings"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sectorData.map((s) => (
                      <tr key={s.sector} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.sector}</td>
                        <td className="px-4 py-3 text-gray-700">{s.cooperativeCount ?? 0}</td>
                        <td className="px-4 py-3 text-gray-700">{(s.memberCount ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {typeof s.totalSavings === "number"
                            ? `RWF ${s.totalSavings.toLocaleString()}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
              <MapPin className="w-6 h-6 text-[#2D6A4F]" />
              Cooperatives by Region
            </h2>
            {cooperatives.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No cooperatives found.</p>
            ) : (
              <div className="space-y-3">
                {cooperatives.map((coop) => (
                  <div
                    key={coop.id}
                    onClick={() => setDrillDownCoop(coop)}
                    className="p-4 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{coop.name}</h3>
                        <p className="text-sm text-gray-600">{coop.sector}{coop.district ? `, ${coop.district}` : ""}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(coop.status)}`}>
                        {coop.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <p className="text-gray-600">Members: {coop.members}</p>
                      <p className="font-medium text-gray-900">Compliance: {coop.complianceScore}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/*
        What cooperatives are doing, have done and plan to do, and who attends.
        This tab used to filter a hardcoded empty list, so it always said
        "no activities" whatever the cooperatives had recorded.
      */}
      {!loading && activeTab === "activities" && <ActivityOversight />}

      {!loading && activeTab === "interventions" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-[#2D6A4F]" />
            Intervention Recommendations ({interventionRecommendations.length})
          </h2>
          {interventionRecommendations.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No intervention recommendations at this time.</p>
          ) : (
            <div className="space-y-4">
              {interventionRecommendations.map((intervention, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border-2 ${
                    intervention.riskLevel === "critical"
                      ? "border-red-200 bg-red-50"
                      : intervention.riskLevel === "high"
                      ? "border-yellow-200 bg-yellow-50"
                      : "border-blue-200 bg-blue-50"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{intervention.cooperativeName}</h3>
                      <p className="text-sm text-gray-700 mt-1">{intervention.reason}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        intervention.riskLevel === "critical"
                          ? "bg-red-100 text-red-800"
                          : intervention.riskLevel === "high"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {intervention.riskLevel.toUpperCase()}
                    </span>
                  </div>
                  <div className="bg-white bg-opacity-60 p-3 rounded mb-3">
                    <p className="text-sm font-medium text-gray-900">Recommended Action</p>
                    <p className="text-sm text-gray-700 mt-1">{intervention.recommendedAction}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <Clock className="w-4 h-4" />
                    Timeline: {intervention.timeline}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {!loading && activeTab === "reports" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <Download className="w-6 h-6 text-[#2D6A4F]" />
            Scheduled Compliance Reports
          </h2>
          <div className="space-y-4">
            {scheduledReports.map((report) => (
              <div key={report.id} className="p-4 rounded-lg border border-gray-200 hover:bg-gray-50">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{report.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Recipients: {report.recipients.join(", ")}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      report.status === "scheduled"
                        ? "bg-blue-100 text-blue-800"
                        : report.status === "running"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-green-100 text-green-800"
                    }`}
                  >
                    {report.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <p className="text-gray-700">
                    <span className="font-medium">Frequency:</span> {report.frequency}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium">Next Run:</span> {report.nextRun}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!loading && activeTab === "agents" && (
        <div className="space-y-6">
          {/* Agent summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Active Agents", value: "8", sub: "Currently on duty", color: "bg-green-50 text-green-700" },
              { label: "Inspections This Month", value: "24", sub: "Cooperative site visits", color: "bg-blue-50 text-blue-700" },
              { label: "Interventions Issued", value: "6", sub: "Notices & directives", color: "bg-yellow-50 text-yellow-700" },
              { label: "Reports Filed", value: "18", sub: "Submitted to ministry", color: "bg-purple-50 text-purple-700" },
            ].map((s) => (
              <Card key={s.label} className="p-5">
                <p className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit mb-3 ${s.color}`}>{s.sub}</p>
                <p className="text-3xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm text-gray-600 mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Agent roster */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Government Agent Roster</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {["Agent", "Role", "Assigned District", "Last Action", "Status"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {[
                    { name: "Dr. Alice Uwase", role: "Senior Inspector", district: "Kigali City", lastAction: "Filed Q1 compliance report", lastDate: "2026-04-28", status: "Active" },
                    { name: "Jean-Pierre Nkusi", role: "Field Officer", district: "Bugesera", lastAction: "Site inspection — Green Valley Farmers", lastDate: "2026-04-27", status: "Active" },
                    { name: "Claudine Mukamana", role: "Compliance Analyst", district: "Muhanga", lastAction: "Issued non-compliance notice to Southern Dairy", lastDate: "2026-04-26", status: "Active" },
                    { name: "Eric Habimana", role: "Field Officer", district: "Rubavu", lastAction: "Follow-up visit — Rubavu Fish Farmers", lastDate: "2026-04-25", status: "Active" },
                    { name: "Solange Uwimana", role: "Data Officer", district: "Kirehe", lastAction: "Updated cooperative registry data", lastDate: "2026-04-24", status: "Active" },
                    { name: "Patrick Nzeyimana", role: "Field Officer", district: "Kicukiro", lastAction: "Audit review — Kigali Coffee Producers", lastDate: "2026-04-22", status: "On Leave" },
                  ].map((agent, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{agent.name}</td>
                      <td className="px-4 py-3 text-gray-600">{agent.role}</td>
                      <td className="px-4 py-3 text-gray-600">{agent.district}</td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{agent.lastAction}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{agent.lastDate}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          agent.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}>{agent.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Recent agent actions timeline */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Agent Actions</h2>
            <div className="space-y-3">
              {[
                { agent: "Dr. Alice Uwase", action: "Filed Q1 compliance report for Kigali City cooperatives", type: "report", time: "2026-04-28 14:30", cooperative: "Portfolio" },
                { agent: "Jean-Pierre Nkusi", action: "Completed site inspection — all records in order", type: "inspection", time: "2026-04-27 11:00", cooperative: "Green Valley Farmers" },
                { agent: "Claudine Mukamana", action: "Issued formal non-compliance notice (registry overdue)", type: "intervention", time: "2026-04-26 09:45", cooperative: "Southern Dairy Cooperative" },
                { agent: "Eric Habimana", action: "Follow-up visit — minor issues noted, 30-day remediation plan agreed", type: "inspection", time: "2026-04-25 15:20", cooperative: "Rubavu Fish Farmers" },
                { agent: "Solange Uwimana", action: "Updated member registry data in national database", type: "data", time: "2026-04-24 10:00", cooperative: "Eastern Agricultural Union" },
              ].map((entry, i) => {
                const typeColors: Record<string, string> = {
                  report: "bg-purple-100 text-purple-800",
                  inspection: "bg-blue-100 text-blue-800",
                  intervention: "bg-red-100 text-red-800",
                  data: "bg-gray-100 text-gray-700",
                };
                return (
                  <div key={i} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900 text-sm">{entry.agent}</p>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[entry.type]}`}>{entry.type}</span>
                      </div>
                      <p className="text-sm text-gray-700">{entry.action}</p>
                      <p className="text-xs text-gray-500 mt-1">{entry.cooperative} · {entry.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}
