import { useNavigate, useParams } from "react-router";
import { ArrowLeft, TrendingUp, AlertTriangle, Target, Info, CheckCircle, XCircle } from "lucide-react";

export function AIInsightDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Mock insight data - in real app, fetch based on id
  const insights: Record<string, any> = {
    "member-engagement": {
      type: "success",
      icon: TrendingUp,
      title: "Strong Member Engagement",
      score: 87,
      summary: "Member engagement is 23% above average. Keep up the good work with monthly training programs.",
      details: {
        overview:
          "Your cooperative shows exceptional member engagement levels, placing you in the top 15% of cooperatives in Gasabo district. This strong engagement is a key driver of cooperative success and sustainability.",
        metrics: [
          { label: "Meeting Attendance Rate", value: "92%", benchmark: "69%", status: "above" },
          { label: "Activity Participation", value: "85%", benchmark: "62%", status: "above" },
          { label: "Contribution Compliance", value: "94%", benchmark: "76%", status: "above" },
          { label: "Communication Response Rate", value: "78%", benchmark: "54%", status: "above" },
        ],
        factors: [
          {
            title: "Consistent Meeting Schedule",
            impact: "High",
            description:
              "Your monthly meetings are held consistently on the same day and time, making it easier for members to plan and attend.",
          },
          {
            title: "Effective Communication",
            impact: "High",
            description: "Regular SMS and in-app notifications keep members informed and engaged with cooperative activities.",
          },
          {
            title: "Member Recognition",
            impact: "Medium",
            description: "Public recognition of active members at meetings encourages continued participation.",
          },
        ],
        recommendations: [
          "Continue current meeting schedule and communication practices",
          "Consider introducing a member of the month award to further boost engagement",
          "Share your engagement strategies with other cooperatives in training sessions",
          "Document your processes to ensure consistency as you grow",
        ],
        nextSteps: [
          { action: "Maintain current communication frequency", deadline: "Ongoing", priority: "High" },
          { action: "Develop member recognition program", deadline: "2 weeks", priority: "Medium" },
          { action: "Create engagement playbook", deadline: "1 month", priority: "Low" },
        ],
      },
    },
    "loan-default-risk": {
      type: "warning",
      icon: AlertTriangle,
      title: "Loan Default Risk Detected",
      score: 65,
      summary: "3 members show high risk of default based on payment patterns. Recommend early intervention.",
      details: {
        overview:
          "Our AI analysis has identified payment patterns indicating potential loan default risk among 3 members. Early intervention can help prevent defaults and maintain cooperative financial health.",
        metrics: [
          { label: "At-Risk Loans", value: "3", benchmark: "0-2", status: "above" },
          { label: "Total Risk Amount", value: "RWF 450,000", benchmark: "< RWF 300,000", status: "above" },
          { label: "Average Days Late", value: "12 days", benchmark: "< 5 days", status: "above" },
          { label: "Default Probability", value: "45%", benchmark: "< 20%", status: "above" },
        ],
        factors: [
          {
            title: "Irregular Payment Patterns",
            impact: "High",
            description: "Members show inconsistent payment timing and amounts, indicating potential cash flow issues.",
          },
          {
            title: "Decreased Activity Participation",
            impact: "Medium",
            description: "At-risk members have reduced engagement with cooperative activities over the past 2 months.",
          },
          {
            title: "Multiple Late Payments",
            impact: "High",
            description: "Pattern of late payments over the past 3 months indicates systemic issues.",
          },
        ],
        recommendations: [
          "Schedule one-on-one meetings with identified members within the next week",
          "Offer flexible payment plans or restructuring options",
          "Provide financial literacy training or connect members with advisors",
          "Monitor payment patterns weekly for early warning signs",
          "Consider adjusting loan terms for future disbursements",
        ],
        nextSteps: [
          { action: "Contact identified members", deadline: "3 days", priority: "High" },
          { action: "Develop payment restructuring options", deadline: "1 week", priority: "High" },
          { action: "Schedule financial literacy workshop", deadline: "2 weeks", priority: "Medium" },
        ],
      },
    },
    "savings-optimization": {
      type: "info",
      icon: Target,
      title: "Savings Target Optimization",
      score: 75,
      summary: "Adjust monthly savings target to RWF 3,500,000 to reach annual goal. Current trend shows 8% shortfall.",
      details: {
        overview:
          "Based on current savings patterns and projections, your cooperative is on track to fall 8% short of your annual savings goal. Adjusting the monthly target can help you stay on track.",
        metrics: [
          { label: "Current Monthly Savings", value: "RWF 3,230,000", benchmark: "RWF 3,500,000", status: "below" },
          { label: "Annual Goal Progress", value: "68%", benchmark: "75%", status: "below" },
          { label: "Projected Shortfall", value: "RWF 2,400,000", benchmark: "RWF 0", status: "above" },
          { label: "Member Compliance Rate", value: "88%", benchmark: "95%", status: "below" },
        ],
        factors: [
          {
            title: "Seasonal Income Variations",
            impact: "High",
            description: "Agricultural cycles affect member ability to save consistently throughout the year.",
          },
          {
            title: "New Member Adjustment Period",
            impact: "Medium",
            description: "Recent new members are still building up to full savings contribution levels.",
          },
          {
            title: "Economic Factors",
            impact: "Medium",
            description: "General economic conditions have impacted some members' disposable income.",
          },
        ],
        recommendations: [
          "Increase monthly savings target to RWF 3,500,000 (8.4% increase)",
          "Implement flexible savings plans that account for seasonal variations",
          "Provide incentives for early or above-target savings",
          "Conduct member education on long-term benefits of consistent savings",
          "Consider introducing voluntary additional savings options",
        ],
        nextSteps: [
          { action: "Present target adjustment to management", deadline: "1 week", priority: "High" },
          { action: "Design seasonal savings plan", deadline: "2 weeks", priority: "High" },
          { action: "Create savings incentive program", deadline: "3 weeks", priority: "Medium" },
        ],
      },
    },
  };

  const insight = insights[id || "member-engagement"];

  if (!insight) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-muted-foreground">Insight not found</p>
          <button onClick={() => navigate("/ai-insights")} className="text-primary hover:underline mt-2">
            Back to AI Insights
          </button>
        </div>
      </div>
    );
  }

  const Icon = insight.icon;

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
        <div
          className={`p-6 border-b border-border ${
            insight.type === "success"
              ? "bg-green-50 dark:bg-green-950/20"
              : insight.type === "warning"
              ? "bg-yellow-50 dark:bg-yellow-950/20"
              : "bg-blue-50 dark:bg-blue-950/20"
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`p-4 rounded-xl ${
                insight.type === "success"
                  ? "bg-green-100 dark:bg-green-900/30"
                  : insight.type === "warning"
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "bg-blue-100 dark:bg-blue-900/30"
              }`}
            >
              <Icon
                className={`w-8 h-8 ${
                  insight.type === "success"
                    ? "text-green-600"
                    : insight.type === "warning"
                    ? "text-yellow-600"
                    : "text-blue-600"
                }`}
              />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-card-foreground mb-2">{insight.title}</h1>
              <p className="text-lg text-muted-foreground">{insight.summary}</p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-card-foreground">{insight.score}</div>
              <div className="text-sm text-muted-foreground">Score</div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* Overview */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              Overview
            </h2>
            <p className="text-muted-foreground leading-relaxed">{insight.details.overview}</p>
          </div>

          {/* Metrics */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-4">Key Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insight.details.metrics.map((metric: any, index: number) => (
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

          {/* Contributing Factors */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-4">Contributing Factors</h2>
            <div className="space-y-3">
              {insight.details.factors.map((factor: any, index: number) => (
                <div key={index} className="p-4 border border-border rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-card-foreground">{factor.title}</h3>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        factor.impact === "High"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          : factor.impact === "Medium"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      }`}
                    >
                      {factor.impact} Impact
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{factor.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-4">Recommendations</h2>
            <div className="space-y-2">
              {insight.details.recommendations.map((rec: string, index: number) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-card-foreground">{rec}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Next Steps */}
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-4">Recommended Next Steps</h2>
            <div className="space-y-3">
              {insight.details.nextSteps.map((step: any, index: number) => (
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
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      step.priority === "High"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        : step.priority === "Medium"
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    }`}
                  >
                    {step.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>

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
