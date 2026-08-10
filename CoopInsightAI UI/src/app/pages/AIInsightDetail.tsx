import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, TrendingUp, AlertTriangle, Target, Info,
  CheckCircle, XCircle, RefreshCw,
} from "lucide-react";
import { api } from "../services/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recommendation {
  text?: string;
  action?: string;
  deadline?: string;
  priority?: string;
  [key: string]: unknown;
}

interface Metric {
  label: string;
  value: string;
  benchmark: string;
  status: "above" | "below";
}

interface Factor {
  title: string;
  impact: "High" | "Medium" | "Low";
  description: string;
}

interface InsightData {
  metrics?: Metric[];
  factors?: Factor[];
  nextSteps?: { action: string; deadline: string; priority: string }[];
  overview?: string;
}

interface Insight {
  id: string;
  title: string;
  type: "success" | "warning" | "info";
  summary: string;
  confidence?: number;
  cooperative_id?: string;
  cooperative_name?: string;
  created_at?: string;
  data?: InsightData;
  recommendations: Recommendation[] | string[];
  // optional score field some backends expose
  score?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function insightIcon(type: string) {
  if (type === "success") return TrendingUp;
  if (type === "warning") return AlertTriangle;
  return Target;
}

function headerBg(type: string) {
  if (type === "success") return "bg-green-50 dark:bg-green-950/20";
  if (type === "warning") return "bg-yellow-50 dark:bg-yellow-950/20";
  return "bg-blue-50 dark:bg-blue-950/20";
}

function iconBg(type: string) {
  if (type === "success") return "bg-green-100 dark:bg-green-900/30";
  if (type === "warning") return "bg-yellow-100 dark:bg-yellow-900/30";
  return "bg-blue-100 dark:bg-blue-900/30";
}

function iconColor(type: string) {
  if (type === "success") return "text-green-600";
  if (type === "warning") return "text-yellow-600";
  return "text-blue-600";
}

function impactBadge(impact: string) {
  if (impact === "High")   return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  if (impact === "Medium") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
}

function priorityBadge(priority: string) {
  if (priority === "High")   return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  if (priority === "Medium") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AIInsightDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setFetchError(null);
    api.get<any>(`/ai/insights/${id}`)
      .then((data) => setInsight((data as any).data ?? (data as any).insight))
      .catch((err: any) => setFetchError(err?.message ?? "Failed to load insight"))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-muted-foreground gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" />
        Loading insight…
      </div>
    );
  }

  // ── Error / not found ─────────────────────────────────────────────────────

  if (fetchError || !insight) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          {fetchError && (
            <p className="text-red-600 text-sm flex items-center gap-1 justify-center">
              <AlertTriangle className="w-4 h-4" /> {fetchError}
            </p>
          )}
          <p className="text-muted-foreground">{fetchError ? "Could not load insight." : "Insight not found."}</p>
          <button onClick={() => navigate("/ai-insights")} className="text-primary hover:underline mt-2 block">
            Back to AI Insights
          </button>
        </div>
      </div>
    );
  }

  // ── Derived UI data ───────────────────────────────────────────────────────

  const Icon        = insightIcon(insight.type);
  const data        = insight.data ?? {};
  const metrics     = data.metrics     ?? [];
  const factors     = data.factors     ?? [];
  const nextSteps   = data.nextSteps   ?? [];
  const overview    = data.overview    ?? insight.summary;
  const score       = (insight.score ?? Math.round((insight.confidence ?? 0) * 100)) || null;

  // Normalize recommendations — backend may return strings or objects
  const recommendations: string[] = (insight.recommendations ?? []).map((r) =>
    typeof r === "string" ? r : (r.text ?? r.action ?? JSON.stringify(r))
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/ai-insights")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to AI Insights
      </button>

      <div className="bg-card rounded-xl border border-border overflow-hidden">

        {/* Header */}
        <div className={`p-6 border-b border-border ${headerBg(insight.type)}`}>
          <div className="flex items-start gap-4">
            <div className={`p-4 rounded-xl ${iconBg(insight.type)}`}>
              <Icon className={`w-8 h-8 ${iconColor(insight.type)}`} />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-card-foreground mb-2">{insight.title}</h1>
              <p className="text-lg text-muted-foreground">{insight.summary}</p>
              {insight.cooperative_name && (
                <p className="text-sm text-muted-foreground mt-1">{insight.cooperative_name}</p>
              )}
            </div>
            {score !== null && (
              <div className="text-center shrink-0">
                <div className="text-4xl font-bold text-card-foreground">{score}</div>
                <div className="text-sm text-muted-foreground">Score</div>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 space-y-8">

          {/* Overview */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              Overview
            </h2>
            <p className="text-muted-foreground leading-relaxed">{overview}</p>
          </div>

          {/* Key Metrics */}
          {metrics.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-card-foreground mb-4">Key Metrics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {metrics.map((metric, index) => (
                  <div key={index} className="p-4 bg-muted rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-muted-foreground">{metric.label}</p>
                      {metric.status === "above" && metric.label.toLowerCase().includes("risk") ? (
                        <XCircle className="w-4 h-4 text-red-600" />
                      ) : metric.status === "above" ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      )}
                    </div>
                    <p className="text-2xl font-bold text-card-foreground mb-1">{metric.value}</p>
                    <p className="text-xs text-muted-foreground">Benchmark: {metric.benchmark}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contributing Factors */}
          {factors.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-card-foreground mb-4">Contributing Factors</h2>
              <div className="space-y-3">
                {factors.map((factor, index) => (
                  <div key={index} className="p-4 border border-border rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-card-foreground">{factor.title}</h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${impactBadge(factor.impact)}`}>
                        {factor.impact} Impact
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{factor.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-card-foreground mb-4">Recommendations</h2>
              <div className="space-y-2">
                {recommendations.map((rec, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <p className="text-card-foreground">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          {nextSteps.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-card-foreground mb-4">Recommended Next Steps</h2>
              <div className="space-y-3">
                {nextSteps.map((step, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-card-foreground">{step.action}</p>
                        <p className="text-sm text-muted-foreground">Deadline: {step.deadline}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${priorityBadge(step.priority)}`}>
                      {step.priority}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-4 border-t border-border">
            <button
              onClick={() => navigate("/ai-insights")}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              Back to All Insights
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
