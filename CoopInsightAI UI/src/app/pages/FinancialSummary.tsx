import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, PieChart, TrendingUp, TrendingDown, ShieldCheck, Users, MessageCircle, BarChart3, Layers } from "lucide-react";
import { formatFrw } from "../data/financialData";
import { api } from "../services/api";

interface CategoryTotal {
  category: string;
  total: number;
}

interface Summary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  byCategory: CategoryTotal[];
}

interface RecentTransaction {
  id: string;
  amount: number;
  type: string;
  category: string;
  description: string;
  reference: string;
  recorded_by_name: string;
  recorded_at: string;
  cooperative_name: string;
  status: string;
}

export function FinancialSummary() {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<Summary>({
    totalIncome: 0,
    totalExpenses: 0,
    netBalance: 0,
    byCategory: [],
  });
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [summaryRes, txRes] = await Promise.all([
          api.get("/transactions/summary"),
          api.get("/transactions?limit=10"),
        ]);
        setSummary(summaryRes.data);
        setRecentTransactions(txRes.data?.transactions || txRes.data || []);
      } catch (err: any) {
        setError(err?.response?.data?.message || "Failed to load financial data.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const incomeTransactions = useMemo(
    () => recentTransactions.filter((t) => t.type === "income" || t.type === "Income"),
    [recentTransactions]
  );
  const expenseTransactions = useMemo(
    () => recentTransactions.filter((t) => t.type === "expense" || t.type === "Expense"),
    [recentTransactions]
  );

  const suggestions = [
    {
      title: "Reminder for inactive members",
      message: "Send a friendly payment reminder to members with low contribution activity.",
    },
    {
      title: "Share performance highlights",
      message: "Send a message to members about the cooperative's income growth and upcoming savings targets.",
    },
    {
      title: "Follow up on pending expenses",
      message: "Review training and outreach costs to ensure they stay on budget and adjust spending if needed.",
    },
  ];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-12">
        <p className="text-gray-500 text-sm">Loading financial data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate("/financials")} className="inline-flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B4332]">
        <ArrowLeft className="w-4 h-4" /> Back to Financials
      </button>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Financial Breakdown</h1>
        <p className="text-gray-600 mt-1">A deeper view into income sources, expense allocations, member contributions, and suggested outreach.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Total Income", value: formatFrw(summary.totalIncome), icon: TrendingUp, color: "text-[#2D6A4F]", detail: `From ${incomeTransactions.length} income transactions` },
          { label: "Total Expenses", value: formatFrw(summary.totalExpenses), icon: TrendingDown, color: "text-[#dc2626]", detail: `From ${expenseTransactions.length} spending items` },
          { label: "Net Profit", value: formatFrw(summary.netBalance ?? (summary.totalIncome - summary.totalExpenses)), icon: ShieldCheck, color: "text-[#2D6A4F]", detail: "Income minus expenses" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-500">{item.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                </div>
                <div className={`p-3 rounded-lg bg-slate-100 ${item.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>
              <p className="text-sm text-gray-600">{item.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Money flow by category</h2>
                <p className="text-sm text-gray-600">Understand where income enters and where spending is allocated.</p>
              </div>
              <PieChart className="w-6 h-6 text-[#2D6A4F]" />
            </div>
            {summary.byCategory.length === 0 ? (
              <p className="text-sm text-gray-400">No category data available.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {summary.byCategory.map(({ category, total }) => (
                  <div key={category} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                    <p className="text-sm text-gray-500">{category}</p>
                    <p className="mt-2 text-lg font-semibold text-gray-900">{formatFrw(total)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Member contribution health</h2>
                <p className="text-sm text-gray-600">Track who is contributing and who needs follow-up.</p>
              </div>
              <Users className="w-6 h-6 text-[#2D6A4F]" />
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                <p className="text-sm text-gray-600">Income transactions recorded</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{incomeTransactions.length}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                <p className="text-sm text-gray-600">Expense transactions recorded</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{expenseTransactions.length}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Suggested outreach</h2>
                <p className="text-sm text-gray-600">Messages to send to members who need a nudge.</p>
              </div>
              <MessageCircle className="w-6 h-6 text-[#2D6A4F]" />
            </div>
            <div className="space-y-4">
              {suggestions.map((suggestion) => (
                <div key={suggestion.title} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                  <p className="font-medium text-gray-900">{suggestion.title}</p>
                  <p className="text-sm text-gray-600 mt-2">{suggestion.message}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Transaction detail preview</h2>
                <p className="text-sm text-gray-600">See how money is moving in and out of the cooperative.</p>
              </div>
              <BarChart3 className="w-6 h-6 text-[#2D6A4F]" />
            </div>
            <div className="space-y-3">
              {recentTransactions.length === 0 ? (
                <p className="text-sm text-gray-400">No recent transactions.</p>
              ) : (
                recentTransactions.slice(0, 4).map((transaction) => (
                  <div key={transaction.id} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-gray-900">{transaction.description}</p>
                        <p className="text-xs text-gray-500">{transaction.recorded_at} • {transaction.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">{formatFrw(transaction.amount)}</p>
                        <p className="text-xs text-gray-500">{transaction.status}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Financial insights</h2>
            <p className="text-sm text-gray-600">Review cash flow, member contributions, and spending trends.</p>
          </div>
          <Layers className="w-6 h-6 text-[#2D6A4F]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
            <p className="text-sm text-gray-500">Income sources</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{incomeTransactions.length} entries</p>
            <p className="text-sm text-gray-600 mt-2">Member payments and sales keep the cooperative funded.</p>
          </div>
          <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
            <p className="text-sm text-gray-500">Expense allocations</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{expenseTransactions.length} categories</p>
            <p className="text-sm text-gray-600 mt-2">Operations, training, and community outreach are the major spend areas.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
