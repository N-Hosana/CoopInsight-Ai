import { Card } from "./Card";
import { TrendingUp, AlertTriangle, CheckCircle, Activity } from "lucide-react";

interface HealthScoreProps {
  score: number;
  trends: {
    memberEngagement: number;
    financialHealth: number;
    activityLevel: number;
    growthRate: number;
  };
  recommendations: string[];
}

export function HealthScore({ score, trends, recommendations }: HealthScoreProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return { bg: "bg-green-100", text: "text-green-800", border: "border-green-500" };
    if (score >= 60) return { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-500" };
    return { bg: "bg-red-100", text: "text-red-800", border: "border-red-500" };
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Needs Attention";
  };

  const scoreColor = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);

  return (
    <Card className={`p-6 border-l-4 ${scoreColor.border}`}>
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-16 h-16 rounded-full ${scoreColor.bg} flex items-center justify-center`}>
          <span className={`text-2xl font-bold ${scoreColor.text}`}>{score}</span>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900 mb-1">Cooperative Health Score</h3>
          <p className={`text-sm font-medium ${scoreColor.text}`}>{scoreLabel}</p>
        </div>
      </div>

      {/* Trend Indicators */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500">Member Engagement</p>
            <p className="text-sm font-medium text-gray-900">{trends.memberEngagement}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500">Financial Health</p>
            <p className="text-sm font-medium text-gray-900">{trends.financialHealth}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500">Activity Level</p>
            <p className="text-sm font-medium text-gray-900">{trends.activityLevel}%</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500">Growth Rate</p>
            <p className="text-sm font-medium text-gray-900">{trends.growthRate}%</p>
          </div>
        </div>
      </div>

      {/* AI Recommendations */}
      <div className="border-t border-gray-200 pt-4">
        <h4 className="font-medium text-gray-900 mb-3">Actionable Recommendations</h4>
        <ul className="space-y-2">
          {recommendations.map((rec, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-[#2D6A4F] font-bold">•</span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
