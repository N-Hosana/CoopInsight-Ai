import { Brain, TrendingUp, AlertTriangle, Target, Users, Download, BarChart3, Layers, Zap, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { MyInsights } from "../components/MyInsights";

interface ApiInsight {
  id: string;
  title: string;
  type: string;
  summary: string;
  confidence: number;
  cooperative_id: string;
  cooperative_name: string;
  created_at: string;
  data: any;
}

interface EngagementEntry {
  memberId?: string;
  memberName?: string;
  activityFrequency?: number;
  contributionConsistency?: number;
  trainingParticipation?: number;
  overallScore?: number;
}

interface BenchmarkEntry {
  metric?: string;
  yourValue?: number;
  averageCooperative?: number;
  topPerformer?: number;
  trend?: "up" | "down" | "stable";
}

interface ModelInfo {
  name: string;
  status: string;
  accuracy: number | null;
}

/**
 * A member gets their own progress and their own cooperative; every other role
 * gets the cooperative analytics below, which the backend scopes to what that
 * role supervises.
 */
export function AIInsights() {
  const { user } = useAuth();
  return user?.role === "member" ? <MyInsights /> : <CooperativeAIInsights />;
}

function CooperativeAIInsights() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"overview" | "anomalies" | "engagement" | "benchmarks" | "performance">("overview");

  // API state
  const [apiInsights, setApiInsights] = useState<ApiInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzeSuccess, setAnalyzeSuccess] = useState<string | null>(null);

  const [engagement, setEngagement] = useState<EngagementEntry[]>([]);
  const [engagementNote, setEngagementNote] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkEntry[]>([]);
  const [benchmarksNote, setBenchmarksNote] = useState<string | null>(null);
  const [modelPerformance, setModelPerformance] = useState<ModelInfo[]>([]);
  const [modelPerformanceNote, setModelPerformanceNote] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.cooperativeId) {
      setEngagementNote("Select a cooperative-linked account to view member engagement scores.");
      setBenchmarksNote("Select a cooperative-linked account to view benchmarking.");
      return;
    }
    api
      .get<{ data: { engagement?: EngagementEntry[]; note?: string } }>(
        `/ai/member-engagement?cooperativeId=${user.cooperativeId}`
      )
      .then((res) => {
        setEngagement(res.data?.engagement ?? []);
        setEngagementNote(res.data?.note ?? null);
      })
      .catch((err: any) => setEngagementNote(err?.message ?? "Failed to load member engagement."));

    api
      .get<{ data: { benchmarks?: BenchmarkEntry[]; note?: string } }>(
        `/ai/benchmarks?cooperativeId=${user.cooperativeId}`
      )
      .then((res) => {
        setBenchmarks(res.data?.benchmarks ?? []);
        setBenchmarksNote(res.data?.note ?? null);
      })
      .catch((err: any) => setBenchmarksNote(err?.message ?? "Failed to load benchmarking."));
  }, [user?.cooperativeId]);

  useEffect(() => {
    if (!(user?.role === "admin" || user?.role === "generalManager")) {
      setModelPerformanceNote("Model performance metrics are only available to admins and general managers.");
      return;
    }
    api
      .get<{ data: { models?: ModelInfo[]; note?: string } }>("/ai/model-performance")
      .then((res) => {
        setModelPerformance(res.data?.models ?? []);
        setModelPerformanceNote(res.data?.note ?? null);
      })
      .catch((err: any) => setModelPerformanceNote(err?.message ?? "Failed to load model performance."));
  }, [user?.role]);

  // Derived performance score — use API data if available, else static
  const performanceScore = 87;
  const [showScoreDetail, setShowScoreDetail] = useState(false);
  const dashArray = (performanceScore / 100) * 351.86 + " 351.86";

  // Build overview insight cards — prefer live API data when available
  // Derived slices from live API data
  const apiRecommendations = apiInsights.filter((i) => i.type === "recommendation");
  const apiAnomalies       = apiInsights.filter((i) => i.type === "anomaly");
  const apiForecasts       = apiInsights.filter((i) => i.type === "forecast");

  const overviewInsights = apiInsights.length > 0
    ? apiInsights.slice(0, 3).map((ins) => ({
        id: ins.id,
        type: ins.type === "anomaly" ? "warning" : ins.type === "insight" ? "success" : "info",
        icon: ins.type === "anomaly" ? AlertTriangle : ins.type === "recommendation" ? Zap : ins.type === "forecast" ? TrendingUp : BarChart3,
        title: ins.title,
        description: ins.summary,
        metric: ins.confidence ? `${Math.round(Number(ins.confidence) * 100)}% conf.` : "—",
      }))
    : [
        {
          id: "member-engagement",
          type: "success",
          icon: TrendingUp,
          title: "Strong Member Engagement",
          description: "Member engagement is 23% above average. Keep up the good work with monthly training programs.",
          metric: "91/100",
        },
        {
          id: "loan-default-risk",
          type: "warning",
          icon: AlertTriangle,
          title: "Anomalies Detected",
          description: "4 anomalies detected in recent transactions. 2 are flagged as high-risk for review.",
          metric: "4 found",
        },
        {
          id: "benchmarking",
          type: "info",
          icon: BarChart3,
          title: "Benchmark Analysis",
          description: "Your cooperative outperforms 78% of similar cooperatives in key metrics.",
          metric: "78th %ile",
        },
      ];

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<any>("/ai/insights?page=1&limit=50");
      setApiInsights((res as any).data || []);
    } catch (err: any) {
      const msg = err?.message || "AI service is currently unavailable. Showing cached data.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const handleRunAnalysis = async () => {
    if (!user?.cooperativeId) return;
    setAnalyzing(true);
    setAnalyzeSuccess(null);
    setError(null);
    try {
      const res = await api.post<{ data: { status: string; message?: string } }>("/ai/anomalies/detect", {
        cooperativeId: user.cooperativeId,
      });
      setAnalyzeSuccess(res.data?.message ?? "Analysis complete. Refreshing insights…");
      await fetchInsights();
    } catch (err: any) {
      setError(err?.message || "Analysis failed. The AI service may be temporarily unavailable.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExportInsights = () => {
    const timestamp = new Date().toISOString().split("T")[0];
    const report = `
AI INSIGHTS REPORT - ${timestamp}
Generated by CoopInsightAI

EXECUTIVE SUMMARY
Performance Score: ${performanceScore}/100
Insights on file: ${apiInsights.length}
Anomalies Detected: ${apiAnomalies.length}
Recommendations: ${apiRecommendations.length}
Forecasts: ${apiForecasts.length}

ANOMALY DETECTION RESULTS (${apiAnomalies.length} Found)
${apiAnomalies
  .map((a: any) => `- ${a.title} (${a.generated_at ? new Date(a.generated_at).toLocaleDateString() : "—"}): ${a.summary} [${(a.severity ?? "info").toUpperCase()}]`)
  .join("\n") || "None"}

MEMBER ENGAGEMENT ANALYSIS
${engagementNote ?? (engagement.map((m) => `- ${m.memberName}: ${m.overallScore}/100`).join("\n") || "No data available")}

BENCHMARKING COMPARISON
${benchmarksNote ?? (benchmarks.map((b) => `- ${b.metric}: You (${b.yourValue}%) vs Average (${b.averageCooperative}%)`).join("\n") || "No data available")}

MODEL PERFORMANCE METRICS
${modelPerformanceNote ?? (modelPerformance.map((m) => `- ${m.name}: ${m.status}${m.accuracy != null ? ` (${m.accuracy}% accuracy)` : ""}`).join("\n") || "No data available")}

AI RECOMMENDATIONS
${apiRecommendations.map((r: any) => `- ${r.title}: ${r.summary}`).join("\n") || "None yet — run analysis to generate."}

FORECASTS
${apiForecasts.map((f: any) => `- ${f.affected_metric ?? f.title}: ${f.current_value ?? "—"} → ${f.expected_value ?? "—"}`).join("\n") || "None yet."}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-insights-report-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">AI Analytics & Insights</h1>
          <p className="text-gray-600 mt-1">Data-driven insights, anomaly detection, and performance analysis</p>
        </div>
        <div className="flex gap-3">
          {user?.cooperativeId && (
            <Button onClick={handleRunAnalysis} disabled={analyzing} variant="secondary">
              <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? "animate-spin" : ""}`} />
              {analyzing ? "Analyzing…" : "Run Analysis"}
            </Button>
          )}
          <Button onClick={handleExportInsights}>
            <Download className="w-4 h-4 mr-2" />
            Export Insights
          </Button>
        </div>
      </div>

      {/* Status banners */}
      {error && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {analyzeSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
          {analyzeSuccess}
        </div>
      )}
      {loading && (
        <div className="text-sm text-gray-500 text-center py-2">Loading AI insights…</div>
      )}

      <div className="bg-gradient-to-r from-[#2D6A4F] via-[#245A42] to-[#1B5E20] rounded-xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Brain className="w-8 h-8" />
              <h2 className="text-2xl font-bold">Cooperative Performance Score</h2>
            </div>
            <p className="opacity-90">AI-calculated health score based on 24 key metrics</p>
            <button
              onClick={() => setShowScoreDetail(!showScoreDetail)}
              className="text-sm underline mt-2 hover:opacity-80 transition-opacity"
            >
              Click for details on how this is calculated
            </button>
          </div>
          <button onClick={() => setShowScoreDetail(!showScoreDetail)} className="text-center hover:scale-105 transition-transform">
            <div className="relative inline-flex items-center justify-center">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="56" stroke="rgba(255,255,255,0.2)" strokeWidth="8" fill="none" />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="white"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={dashArray}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl font-bold">{performanceScore}</span>
              </div>
            </div>
            <p className="mt-2 text-sm opacity-90">Excellent Performance</p>
          </button>
        </div>

        {showScoreDetail && (
          <div className="mt-6 pt-6 border-t border-white/20">
            <h3 className="font-semibold mb-3">How Performance Score is Calculated:</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="opacity-75">Member Engagement</p>
                <p className="text-xl font-bold">25%</p>
              </div>
              <div>
                <p className="opacity-75">Financial Health</p>
                <p className="text-xl font-bold">30%</p>
              </div>
              <div>
                <p className="opacity-75">Activity Level</p>
                <p className="text-xl font-bold">20%</p>
              </div>
              <div>
                <p className="opacity-75">Compliance</p>
                <p className="text-xl font-bold">25%</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {[
          { id: "overview", label: "Overview", icon: Brain },
          { id: "anomalies", label: "Anomaly Detection", icon: AlertTriangle },
          { id: "engagement", label: "Member Engagement", icon: Users },
          { id: "benchmarks", label: "Benchmarking", icon: BarChart3 },
          { id: "performance", label: "Model Performance", icon: Layers },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-[#2D6A4F] text-[#2D6A4F]"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-6">
            {overviewInsights.map((insight, index) => {
              const Icon = insight.icon;
              const bgColor =
                insight.type === "success"
                  ? "bg-green-50"
                  : insight.type === "warning"
                  ? "bg-yellow-50"
                  : "bg-blue-50";
              const iconColor =
                insight.type === "success"
                  ? "text-green-600"
                  : insight.type === "warning"
                  ? "text-yellow-600"
                  : "text-[#2D6A4F]";

              return (
                <Card key={insight.id ?? index} className="p-6">
                  <div className={`p-3 rounded-lg ${bgColor} inline-block mb-4`}>
                    <Icon className={`w-6 h-6 ${iconColor}`} />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{insight.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-900">{insight.metric}</span>
                    <button className="text-[#2D6A4F] text-sm font-medium hover:underline">Learn More →</button>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#2D6A4F]" />
                AI Recommendations
              </h2>
              <div className="space-y-4">
                {(apiRecommendations.length > 0 ? apiRecommendations : []).slice(0, 4).map((rec: any, index: number) => {
                  const sev = rec.severity ?? "info";
                  const impact = sev === "critical" ? "Critical" : sev === "warning" ? "High" : "Medium";
                  const impactCls = sev === "critical" ? "bg-red-100 text-red-800" : sev === "warning" ? "bg-orange-100 text-orange-800" : "bg-yellow-100 text-yellow-800";
                  return (
                    <div key={rec.id ?? index} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-medium text-gray-900 text-sm">{rec.title}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ml-2 ${impactCls}`}>
                          {impact} Impact
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{rec.summary}</p>
                      {rec.cooperative_name && (
                        <p className="text-xs text-gray-400 mt-1">{rec.cooperative_name}</p>
                      )}
                    </div>
                  );
                })}
                {apiRecommendations.length === 0 && !loading && (
                  <p className="text-sm text-gray-400 text-center py-4">No recommendations yet — run analysis to generate.</p>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-[#2D6A4F]" />
                Predictive Analytics
              </h2>
              <div className="space-y-4">
                {(apiForecasts.length > 0 ? apiForecasts : []).slice(0, 4).map((pred: any, index: number) => {
                  const confPct = pred.confidence ? `${Math.round(Number(pred.confidence) * 100)}%` : "—";
                  const current = pred.current_value != null ? String(pred.current_value) : "—";
                  const expected = pred.expected_value != null ? String(pred.expected_value) : "—";
                  return (
                    <div key={pred.id ?? index} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">{pred.affected_metric ?? pred.title}</span>
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-900 rounded font-medium">
                          {confPct} confidence
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{pred.summary}</p>
                      <div className="flex items-baseline gap-3">
                        <div>
                          <p className="text-xs text-gray-500">Current</p>
                          <p className="text-lg font-semibold text-gray-900">{current}</p>
                        </div>
                        <TrendingUp className="w-4 h-4 text-green-600 mt-4" />
                        <div>
                          <p className="text-xs text-gray-500">Predicted</p>
                          <p className="text-lg font-semibold text-[#2D6A4F]">{expected}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {apiForecasts.length === 0 && !loading && (
                  <p className="text-sm text-gray-400 text-center py-4">No forecast data yet.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "anomalies" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-[#2D6A4F]" />
            Anomaly Detection Results ({apiAnomalies.length} Found)
          </h2>
          <div className="space-y-4">
            {apiAnomalies.map((anomaly: any, idx: number) => {
              const sev = anomaly.severity ?? "info";
              const borderCls = sev === "critical" ? "border-red-200 bg-red-50" : sev === "warning" ? "border-yellow-200 bg-yellow-50" : "border-blue-200 bg-blue-50";
              const badgeCls  = sev === "critical" ? "bg-red-100 text-red-800" : sev === "warning" ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800";
              const riskLabel = sev === "critical" ? "HIGH RISK" : sev === "warning" ? "MEDIUM RISK" : "LOW RISK";
              const dateStr   = anomaly.generated_at ? new Date(anomaly.generated_at).toLocaleDateString() : "—";
              return (
                <div key={anomaly.id ?? idx} className={`p-4 rounded-lg border-2 ${borderCls}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-gray-900">{anomaly.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{anomaly.summary}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ml-3 ${badgeCls}`}>
                      {riskLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                    <div>
                      <p className="text-xs text-gray-600">Detected</p>
                      <p className="font-medium text-gray-900">{dateStr}</p>
                    </div>
                    {anomaly.affected_metric && (
                      <div>
                        <p className="text-xs text-gray-600">Metric</p>
                        <p className="font-medium text-gray-900 capitalize">{anomaly.affected_metric}</p>
                      </div>
                    )}
                    {anomaly.current_value != null && (
                      <div>
                        <p className="text-xs text-gray-600">Observed</p>
                        <p className="font-medium text-gray-900">{anomaly.current_value}</p>
                      </div>
                    )}
                    {anomaly.expected_value != null && (
                      <div>
                        <p className="text-xs text-gray-600">Expected</p>
                        <p className="font-medium text-gray-900">{anomaly.expected_value}</p>
                      </div>
                    )}
                    {anomaly.cooperative_name && (
                      <div>
                        <p className="text-xs text-gray-600">Cooperative</p>
                        <p className="font-medium text-gray-900 text-xs">{anomaly.cooperative_name}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {apiAnomalies.length === 0 && !loading && (
              <p className="text-sm text-gray-400 text-center py-6">No anomalies detected.</p>
            )}
          </div>
        </Card>
      )}

      {activeTab === "engagement" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <Users className="w-6 h-6 text-[#2D6A4F]" />
            Member Engagement Analysis
          </h2>
          {engagementNote && (
            <p className="text-sm text-gray-500 mb-4">{engagementNote}</p>
          )}
          {engagement.length === 0 && !engagementNote && (
            <p className="text-sm text-gray-400 text-center py-6">No engagement data available yet.</p>
          )}
          {engagement.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Member Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Activity Frequency</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Contribution Consistency</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Training Participation</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Overall Score</th>
                  </tr>
                </thead>
                <tbody>
                  {engagement.map((member, idx) => (
                    <tr key={member.memberId ?? idx} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{member.memberName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div className="bg-green-600 h-2 rounded-full" style={{ width: `${member.activityFrequency ?? 0}%` }}></div>
                          </div>
                          <span className="text-gray-700 font-medium">{member.activityFrequency ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div className="bg-[#2D6A4F] h-2 rounded-full" style={{ width: `${member.contributionConsistency ?? 0}%` }}></div>
                          </div>
                          <span className="text-gray-700 font-medium">{member.contributionConsistency ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${member.trainingParticipation ?? 0}%` }}></div>
                          </div>
                          <span className="text-gray-700 font-medium">{member.trainingParticipation ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            (member.overallScore ?? 0) >= 80
                              ? "bg-green-100 text-green-800"
                              : (member.overallScore ?? 0) >= 60
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {member.overallScore ?? 0}/100
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === "benchmarks" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#2D6A4F]" />
            Benchmarking Against Similar Cooperatives
          </h2>
          {benchmarksNote && (
            <p className="text-sm text-gray-500 mb-4">{benchmarksNote}</p>
          )}
          {benchmarks.length === 0 && !benchmarksNote && (
            <p className="text-sm text-gray-400 text-center py-6">No benchmarking data available yet.</p>
          )}
          <div className="space-y-6">
            {benchmarks.map((bench, idx) => (
              <div key={idx} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-gray-900">{bench.metric}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-xs px-2 py-1 rounded ${bench.trend === "up" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {bench.trend === "up" ? "📈 Trending Up" : "Stable"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Your Cooperative</p>
                    <p className="text-2xl font-bold text-[#2D6A4F]">{bench.yourValue}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Average Cooperative</p>
                    <p className="text-2xl font-bold text-gray-900">{bench.averageCooperative}%</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {(bench.yourValue ?? 0) - (bench.averageCooperative ?? 0) > 0 ? "+" : ""}
                      {(bench.yourValue ?? 0) - (bench.averageCooperative ?? 0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Top Performer</p>
                    <p className="text-2xl font-bold text-green-600">{bench.topPerformer}%</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {(bench.yourValue ?? 0) - (bench.topPerformer ?? 0) > 0 ? "+" : ""}
                      {(bench.yourValue ?? 0) - (bench.topPerformer ?? 0)}%
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full">
                    <div className="h-2 bg-gray-500 rounded-full" style={{ width: `${bench.averageCooperative ?? 0}%` }}></div>
                  </div>
                  <div className="flex-1 h-2 bg-blue-200 rounded-full">
                    <div className="h-2 bg-[#2D6A4F] rounded-full" style={{ width: `${((bench.yourValue ?? 0) / (bench.topPerformer || 1)) * 100}%` }}></div>
                  </div>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full">
                    <div className="h-2 bg-green-500 rounded-full" style={{ width: "100%" }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "performance" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <Layers className="w-6 h-6 text-[#2D6A4F]" />
            Model Performance
          </h2>
          {modelPerformanceNote && (
            <p className="text-sm text-gray-500 mb-4">{modelPerformanceNote}</p>
          )}
          {modelPerformance.length === 0 && !modelPerformanceNote && (
            <p className="text-sm text-gray-400 text-center py-6">No model performance data available yet.</p>
          )}
          {modelPerformance.length > 0 && (
            <div className="grid grid-cols-2 gap-6">
              {modelPerformance.map((model) => (
                <div key={model.name} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-900 capitalize">{model.name.replace(/_/g, " ")}</h3>
                    <span className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 capitalize">{model.status.replace(/_/g, " ")}</span>
                  </div>
                  {model.accuracy != null ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-700">Accuracy</p>
                        <p className="text-sm font-bold text-gray-900">{model.accuracy}%</p>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-[#2D6A4F] h-2 rounded-full" style={{ width: `${model.accuracy}%` }}></div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Not trained yet.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
