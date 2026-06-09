import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, PieChart, TrendingUp, TrendingDown, ShieldCheck, Users, MessageCircle, BarChart3, Layers } from "lucide-react";
import { transactions, members, formatFrw, getFinancialStats } from "../data/financialData";

export function FinancialSummary() {
  const navigate = useNavigate();
  const stats = useMemo(() => getFinancialStats(), []);
  const incomeTransactions = transactions.filter((transaction) => transaction.type === "Income");
  const expenseTransactions = transactions.filter((transaction) => transaction.type === "Expense");

  const categoryTotals = useMemo(() => {
    return transactions.reduce<Record<string, number>>((totals, transaction) => {
      totals[transaction.category] = (totals[transaction.category] || 0) + transaction.amount;
      return totals;
    }, {});
  }, []);

  const lowContributors = members
    .filter((member) => member.contribution < 2200000)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 3);

  const contributionCoverage = useMemo(() => {
    const contributed = members.filter((member) => member.contribution > 0).length;
    return Math.round((contributed / members.length) * 100);
  }, []);

  const suggestions = [
    {
      title: "Reminder for inactive members",
      message: `Send a friendly payment reminder to ${lowContributors.map((member) => member.name).join(", ")}.`,
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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate("/financials")} className="inline-flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B4332]">
        <ArrowLeft className="w-4 h-4" /> Back to Financials
      </button>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Financial Breakdown</h1>
        <p className="text-gray-600 mt-1">A deeper view into income sources, expense allocations, member contributions, and suggested outreach.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Total Income", value: formatFrw(stats.totalIncome), icon: TrendingUp, color: "text-[#2563EB]", detail: `From ${incomeTransactions.length} income transactions` },
          { label: "Total Expenses", value: formatFrw(stats.totalExpenses), icon: TrendingDown, color: "text-[#dc2626]", detail: `From ${expenseTransactions.length} spending items` },
          { label: "Net Profit", value: formatFrw(stats.totalIncome - stats.totalExpenses), icon: ShieldCheck, color: "text-[#2D6A4F]", detail: `Income minus expenses` },
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(categoryTotals).map(([category, amount]) => (
                <div key={category} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                  <p className="text-sm text-gray-500">{category}</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{formatFrw(amount)}</p>
                </div>
              ))}
            </div>
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
                <p className="text-sm text-gray-600">Members contributing</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{contributionCoverage}%</p>
              </div>
              <div className="space-y-3">
                {lowContributors.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-200">
                    <div>
                      <p className="font-medium text-gray-900">{member.name}</p>
                      <p className="text-sm text-gray-500">Last paid {member.lastContribution}</p>
                    </div>
                    <p className="text-sm font-semibold text-[#dc2626]">{formatFrw(member.contribution)}</p>
                  </div>
                ))}
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
              <MessageCircle className="w-6 h-6 text-[#2563EB]" />
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
              {transactions.slice(0, 4).map((transaction) => (
                <div key={transaction.id} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900">{transaction.description}</p>
                      <p className="text-xs text-gray-500">{transaction.date} • {transaction.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatFrw(transaction.amount)}</p>
                      <p className="text-xs text-gray-500">{transaction.status}</p>
                    </div>
                  </div>
                </div>
              ))}
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
