import { Brain, TrendingUp, AlertTriangle, Target, Users, Download, BarChart3, Layers, Zap } from "lucide-react";
import { useState } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

interface AnomalyDetection {
  transactionId: string;
  date: string;
  amount: number;
  type: "anomaly" | "outlier" | "unusual-pattern";
  reason: string;
  riskLevel: "high" | "medium" | "low";
}

interface MemberEngagementScore {
  memberId: string;
  memberName: string;
  activityFrequency: number;
  contributionConsistency: number;
  trainingParticipation: number;
  overallScore: number;
}

interface BenchmarkMetric {
  metric: string;
  yourValue: number;
  averageCooperative: number;
  topPerformer: number;
  trend: "up" | "down" | "stable";
}

export function AIInsights() {
  const [activeTab, setActiveTab] = useState<"overview" | "anomalies" | "engagement" | "benchmarks" | "performance">("overview");

  const performanceScore = 87;
  const [showScoreDetail, setShowScoreDetail] = useState(false);
  const dashArray = (performanceScore / 100) * 351.86 + " 351.86";

  // Anomaly Detection Data
  const anomalies: AnomalyDetection[] = [
    {
      transactionId: "TXN-2026-001",
      date: "2026-04-18",
      amount: 15000000,
      type: "outlier",
      reason: "Transaction amount is 3.2x above normal transaction average",
      riskLevel: "high",
    },
    {
      transactionId: "TXN-2026-002",
      date: "2026-04-17",
      amount: 500000,
      type: "unusual-pattern",
      reason: "Member who typically pays on 1st of month paid on 17th",
      riskLevel: "low",
    },
    {
      transactionId: "TXN-2026-003",
      date: "2026-04-16",
      amount: 8500000,
      type: "anomaly",
      reason: "Unusual spike in expense transactions - pattern suggests potential fraud",
      riskLevel: "high",
    },
    {
      transactionId: "TXN-2026-004",
      date: "2026-04-15",
      amount: 2000000,
      type: "unusual-pattern",
      reason: "Missing expected savings contribution from member",
      riskLevel: "medium",
    },
  ];

  // Member Engagement Analysis
  const memberEngagement: MemberEngagementScore[] = [
    { memberId: "M001", memberName: "Jean Uwimana", activityFrequency: 92, contributionConsistency: 95, trainingParticipation: 88, overallScore: 91 },
    { memberId: "M002", memberName: "Marie Mukamana", activityFrequency: 85, contributionConsistency: 78, trainingParticipation: 82, overallScore: 81 },
    { memberId: "M003", memberName: "Peter Habimana", activityFrequency: 45, contributionConsistency: 52, trainingParticipation: 38, overallScore: 45 },
    { memberId: "M004", memberName: "Grace Uwase", activityFrequency: 88, contributionConsistency: 92, trainingParticipation: 95, overallScore: 91 },
    { memberId: "M005", memberName: "Eric Niyonzima", activityFrequency: 72, contributionConsistency: 68, trainingParticipation: 75, overallScore: 71 },
  ];

  // Benchmarking Data
  const benchmarks: BenchmarkMetric[] = [
    { metric: "Member Contribution Rate", yourValue: 94, averageCooperative: 82, topPerformer: 98, trend: "up" },
    { metric: "Loan Recovery Rate", yourValue: 94, averageCooperative: 87, topPerformer: 99, trend: "stable" },
    { metric: "Member Retention Rate", yourValue: 89, averageCooperative: 81, topPerformer: 96, trend: "up" },
    { metric: "Training Participation", yourValue: 78, averageCooperative: 65, topPerformer: 92, trend: "up" },
    { metric: "Financial Transparency Score", yourValue: 91, averageCooperative: 75, topPerformer: 98, trend: "stable" },
    { metric: "Activity Completion Rate", yourValue: 86, averageCooperative: 74, topPerformer: 95, trend: "down" },
  ];

  // Model Performance Metrics
  const modelPerformance = {
    anomalyDetection: { accuracy: 94, precision: 92, recall: 96, f1Score: 94 },
    engagementPrediction: { accuracy: 88, precision: 85, recall: 91, f1Score: 88 },
    riskAssessment: { accuracy: 91, precision: 93, recall: 89, f1Score: 91 },
    recommendationEngine: { accuracy: 84, precision: 82, recall: 87, f1Score: 84 },
  };

  const insights = [
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

  const recommendations = [
    {
      title: "Address Low Engagement Members",
      impact: "High",
      description: "Peter Habimana and 2 others show declining engagement. Personalized interventions recommended.",
      status: "pending",
    },
    {
      title: "Investigate High-Risk Anomalies",
      impact: "High",
      description: "Two high-risk transactions detected. Recommended for audit review.",
      status: "pending",
    },
    {
      title: "Leverage Benchmarking Insights",
      impact: "Medium",
      description: "Implement best practices from top-performing cooperatives (Training: +14%, Retention: +7%)",
      status: "pending",
    },
  ];

  const predictions = [
    { metric: "Revenue (Next Quarter)", current: "RWF 12.5M", predicted: "RWF 14.2M", confidence: "92%" },
    { metric: "New Members", current: "145", predicted: "168", confidence: "85%" },
    { metric: "Loan Recovery Rate", current: "94%", predicted: "96%", confidence: "88%" },
  ];

  const handleExportInsights = () => {
    const timestamp = new Date().toISOString().split("T")[0];
    const report = `
AI INSIGHTS REPORT - ${timestamp}
Generated by CoopInsightAI

EXECUTIVE SUMMARY
Performance Score: ${performanceScore}/100 (Excellent)
Overall Member Engagement: 91/100
Anomalies Detected: ${anomalies.length}
Benchmarking Position: 78th percentile

ANOMALY DETECTION RESULTS (${anomalies.length} Found)
${anomalies
  .map(
    (a) =>
      `- ${a.transactionId} (${a.date}): ${a.reason} [Risk: ${a.riskLevel.toUpperCase()}]`
  )
  .join("\n")}

MEMBER ENGAGEMENT ANALYSIS
Top Performers:
${memberEngagement
  .slice(0, 3)
  .map((m) => `- ${m.memberName}: ${m.overallScore}/100`)
  .join("\n")}

At-Risk Members:
${memberEngagement
  .filter((m) => m.overallScore < 60)
  .map((m) => `- ${m.memberName}: ${m.overallScore}/100`)
  .join("\n")}

BENCHMARKING COMPARISON
Your cooperative vs. Industry Average:
${benchmarks
  .map((b) => `- ${b.metric}: You (${b.yourValue}%) vs Average (${b.averageCooperative}%)`)
  .join("\n")}

MODEL PERFORMANCE METRICS
- Anomaly Detection: ${modelPerformance.anomalyDetection.accuracy}% Accuracy
- Engagement Prediction: ${modelPerformance.engagementPrediction.accuracy}% Accuracy
- Risk Assessment: ${modelPerformance.riskAssessment.accuracy}% Accuracy

AI RECOMMENDATIONS
${recommendations.map((r) => `- ${r.title} (${r.impact} Impact): ${r.description}`).join("\n")}

PREDICTIONS (Next Quarter)
${predictions
  .map(
    (p) =>
      `- ${p.metric}: ${p.current} → ${p.predicted} (${p.confidence} confidence)`
  )
  .join("\n")}
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
        <Button onClick={handleExportInsights}>
          <Download className="w-4 h-4 mr-2" />
          Export Insights
        </Button>
      </div>

      <div className="bg-gradient-to-r from-[#2563EB] via-blue-600 to-blue-700 rounded-xl p-8 text-white">
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
                  ? "border-[#2563EB] text-[#2563EB]"
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
            {insights.map((insight, index) => {
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
                  : "text-[#2563EB]";

              return (
                <Card key={index} className="p-6">
                  <div className={`p-3 rounded-lg ${bgColor} inline-block mb-4`}>
                    <Icon className={`w-6 h-6 ${iconColor}`} />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{insight.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-900">{insight.metric}</span>
                    <button className="text-[#2563EB] text-sm font-medium hover:underline">Learn More →</button>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#2563EB]" />
                AI Recommendations
              </h2>
              <div className="space-y-4">
                {recommendations.map((rec, index) => (
                  <div key={index} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-gray-900">{rec.title}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          rec.impact === "High"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {rec.impact} Impact
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{rec.description}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Target className="w-5 h-5 text-[#2563EB]" />
                Predictive Analytics
              </h2>
              <div className="space-y-4">
                {predictions.map((pred, index) => (
                  <div key={index} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{pred.metric}</span>
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-900 rounded font-medium">
                        {pred.confidence} confidence
                      </span>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <div>
                        <p className="text-xs text-gray-500">Current</p>
                        <p className="text-lg font-semibold text-gray-900">{pred.current}</p>
                      </div>
                      <TrendingUp className="w-4 h-4 text-green-600 mt-4" />
                      <div>
                        <p className="text-xs text-gray-500">Predicted</p>
                        <p className="text-lg font-semibold text-[#2563EB]">{pred.predicted}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "anomalies" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-[#2563EB]" />
            Anomaly Detection Results ({anomalies.length} Found)
          </h2>
          <div className="space-y-4">
            {anomalies.map((anomaly, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border-2 ${
                  anomaly.riskLevel === "high"
                    ? "border-red-200 bg-red-50"
                    : anomaly.riskLevel === "medium"
                    ? "border-yellow-200 bg-yellow-50"
                    : "border-blue-200 bg-blue-50"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{anomaly.transactionId}</h3>
                    <p className="text-sm text-gray-600 mt-1">{anomaly.reason}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                      anomaly.riskLevel === "high"
                        ? "bg-red-100 text-red-800"
                        : anomaly.riskLevel === "medium"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {anomaly.riskLevel.toUpperCase()} RISK
                  </span>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                  <div>
                    <p className="text-xs text-gray-600">Date</p>
                    <p className="font-medium text-gray-900">{anomaly.date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Amount</p>
                    <p className="font-medium text-gray-900">₣{anomaly.amount.toLocaleString("en-RW")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Type</p>
                    <p className="font-medium text-gray-900 capitalize">{anomaly.type}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "engagement" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <Users className="w-6 h-6 text-[#2563EB]" />
            Member Engagement Analysis
          </h2>
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
                {memberEngagement.map((member, idx) => (
                  <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{member.memberName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div className="bg-green-600 h-2 rounded-full" style={{ width: `${member.activityFrequency}%` }}></div>
                        </div>
                        <span className="text-gray-700 font-medium">{member.activityFrequency}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${member.contributionConsistency}%` }}></div>
                        </div>
                        <span className="text-gray-700 font-medium">{member.contributionConsistency}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${member.trainingParticipation}%` }}></div>
                        </div>
                        <span className="text-gray-700 font-medium">{member.trainingParticipation}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          member.overallScore >= 80
                            ? "bg-green-100 text-green-800"
                            : member.overallScore >= 60
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {member.overallScore}/100
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "benchmarks" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#2563EB]" />
            Benchmarking Against Similar Cooperatives
          </h2>
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
                    <p className="text-2xl font-bold text-[#2563EB]">{bench.yourValue}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Average Cooperative</p>
                    <p className="text-2xl font-bold text-gray-900">{bench.averageCooperative}%</p>
                    <p className="text-xs text-gray-600 mt-1">
                      +{bench.yourValue - bench.averageCooperative > 0 ? "+" : ""}
                      {bench.yourValue - bench.averageCooperative}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Top Performer</p>
                    <p className="text-2xl font-bold text-green-600">{bench.topPerformer}%</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {bench.yourValue - bench.topPerformer > 0 ? "+" : ""}
                      {bench.yourValue - bench.topPerformer}%
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full">
                    <div className="h-2 bg-gray-500 rounded-full" style={{ width: `${bench.averageCooperative}%` }}></div>
                  </div>
                  <div className="flex-1 h-2 bg-blue-200 rounded-full">
                    <div className="h-2 bg-[#2563EB] rounded-full" style={{ width: `${(bench.yourValue / bench.topPerformer) * 100}%` }}></div>
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
        <div className="grid grid-cols-2 gap-6">
          {Object.entries(modelPerformance).map(([modelName, metrics]) => (
            <Card key={modelName} className="p-6">
              <h3 className="font-semibold text-gray-900 mb-4 capitalize">
                {modelName
                  .replace(/([A-Z])/g, " $1")
                  .trim()}
              </h3>
              <div className="space-y-3">
                {Object.entries(metrics).map(([metric, value]) => (
                  <div key={metric}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-700 capitalize">{metric}</p>
                      <p className="text-sm font-bold text-gray-900">{value}%</p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-[#2563EB] h-2 rounded-full" style={{ width: `${value}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
