import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  PiggyBank,
  Download,
  Plus,
} from "lucide-react";
import { Button } from "../components/Button";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";
import {
  transactions,
  formatFrw,
  loanRecords,
  dividendRecords,
  balanceSheets,
  financialPeriods,
  members,
} from "../data/financialData";

export function Financials() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState("Q2 2026 (Current)");
  const [selectedDetailView, setSelectedDetailView] = useState("Transactions");
  const [selectedCooperativeId, setSelectedCooperativeId] = useState("all");
  const isAllCooperativesView =
    user?.role === "generalManager" ||
    user?.role === "government" ||
    user?.role === "admin";
  const showDetailSelector = isAllCooperativesView;
  const detailViews = [
    "Transactions",
    "Balance Sheet",
    "Active Loans",
    "Loan Disbursements",
    "Savings Accounts",
    "Dividends",
  ];

  const canOpenBudgetPlanner =
    user?.role === "manager" || user?.role === "admin" || user?.role === "generalManager";

  const cooperativeOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = transactions.reduce<{ id: string; name: string }[]>((acc, tx) => {
      if (tx.cooperativeId && tx.cooperative && !seen.has(tx.cooperativeId)) {
        seen.add(tx.cooperativeId);
        acc.push({ id: tx.cooperativeId, name: tx.cooperative });
      }
      return acc;
    }, []);
    return [{ id: "all", name: "All Cooperatives" }, ...options];
  }, []);

  useEffect(() => {
    if (isAllCooperativesView) {
      setSelectedCooperativeId("all");
    } else if (user?.cooperativeId) {
      setSelectedCooperativeId(user.cooperativeId);
    }
  }, [isAllCooperativesView, user?.cooperativeId]);

  const selectedCooperativeName = cooperativeOptions.find((item) => item.id === selectedCooperativeId)?.name || "All Cooperatives";
  const cooperativeScope = isAllCooperativesView
    ? selectedCooperativeName
    : user?.cooperativeName || "My Cooperative";

  const visibleTransactions = useMemo(() => {
    if (isAllCooperativesView) {
      return selectedCooperativeId === "all"
        ? transactions
        : transactions.filter((t) => t.cooperativeId === selectedCooperativeId);
    }
    if (user?.cooperativeId) {
      return transactions.filter((t) => t.cooperativeId === user.cooperativeId);
    }
    return transactions;
  }, [selectedCooperativeId, user, isAllCooperativesView]);

  const visibleLoanRecords = useMemo(() => {
    if (isAllCooperativesView) {
      return selectedCooperativeId === "all"
        ? loanRecords
        : loanRecords.filter((loan) => loan.cooperativeId === selectedCooperativeId);
    }
    return loanRecords.filter((loan) => loan.cooperativeId === user?.cooperativeId);
  }, [selectedCooperativeId, user?.cooperativeId, isAllCooperativesView]);

  const visibleDividendRecords = useMemo(() => {
    if (isAllCooperativesView) {
      return selectedCooperativeId === "all"
        ? dividendRecords
        : dividendRecords.filter((dividend) => dividend.cooperativeId === selectedCooperativeId);
    }
    return dividendRecords.filter((dividend) => dividend.cooperativeId === user?.cooperativeId);
  }, [selectedCooperativeId, user?.cooperativeId, isAllCooperativesView]);

  const visibleSavingsAccounts = useMemo(() => {
    if (isAllCooperativesView) {
      return selectedCooperativeId === "all"
        ? members
        : members.filter((member) => member.cooperativeId === selectedCooperativeId);
    }
    return members.filter((member) => member.cooperativeId === user?.cooperativeId);
  }, [selectedCooperativeId, user?.cooperativeId, isAllCooperativesView]);

  const visibleLoanDisbursements = useMemo(
    () => visibleTransactions.filter((transaction) => transaction.type === "Loan"),
    [visibleTransactions]
  );

  const savingsTotal = useMemo(
    () => visibleSavingsAccounts.reduce((sum, member) => sum + member.savingsBalance, 0),
    [visibleSavingsAccounts]
  );

  const selectedDetailBalanceSheet = useMemo(() => {
    const income = visibleTransactions.filter((item) => item.type === "Income").reduce((sum, item) => sum + item.amount, 0);
    const expenses = visibleTransactions.filter((item) => item.type === "Expense").reduce((sum, item) => sum + item.amount, 0);
    const assets = income + 1200000;
    const liabilities = Math.max(0, expenses - 300000);
    const equity = assets - liabilities;
    const netProfit = income - expenses;
    return { assets, liabilities, equity, totalIncome: income, totalExpenses: expenses, netProfit };
  }, [visibleTransactions]);

  const roleSpecificDescription = useMemo(() => {
    const coopText = selectedCooperativeName === "All Cooperatives" ? "the portfolio" : selectedCooperativeName;
    switch (user?.role) {
      case "admin":
        return `Admin view for ${coopText}: oversight of governance, audit readiness, and financial control.`;
      case "generalManager":
        return `General Manager view for ${coopText}: operational performance, cash flow, and cross-cooperative comparisons.`;
      case "government":
        return `Government view for ${coopText}: compliance, public transparency, and policy-sensitive financial status.`;
      default:
        return `Financial view for ${coopText}.`;
    }
  }, [selectedCooperativeName, user?.role]);

  const stats = useMemo(() => {
    const totalIncome = visibleTransactions
      .filter((item) => item.type === "Income")
      .reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = visibleTransactions
      .filter((item) => item.type === "Expense")
      .reduce((sum, item) => sum + item.amount, 0);
    const totalLoans = visibleTransactions
      .filter((item) => item.type === "Loan")
      .reduce((sum, item) => sum + item.amount, 0);
    const totalDividends = visibleTransactions
      .filter((item) => item.type === "Dividend")
      .reduce((sum, item) => sum + item.amount, 0);
    const totalSavings = visibleTransactions
      .filter((item) => item.type === "Savings")
      .reduce((sum, item) => sum + item.amount, 0);
    return { totalIncome, totalExpenses, totalLoans, totalDividends, totalSavings };
  }, [visibleTransactions]);

  const financialStats = [
    { label: "Total Income", value: formatFrw(stats.totalIncome), change: "+12.5%", trend: "up", icon: TrendingUp },
    { label: "Total Expenses", value: formatFrw(stats.totalExpenses), change: "-3.2%", trend: "down", icon: TrendingDown },
    { label: "Total Savings", value: formatFrw(stats.totalSavings), change: "+8.3%", trend: "up", icon: PiggyBank },
    { label: "Active Loans", value: formatFrw(stats.totalLoans), change: "+5.1%", trend: "up", icon: CreditCard },
  ];

  const currentBalanceSheet = balanceSheets.find((b) => b.period === selectedPeriod) || balanceSheets[1];

  const handleExportBalanceSheet = () => {
    const report = `
COOPERATIVE BALANCE SHEET
Period: ${selectedPeriod}
Generated: ${new Date().toLocaleString()}

ASSETS: ${formatFrw(currentBalanceSheet.assets)}

LIABILITIES: ${formatFrw(currentBalanceSheet.liabilities)}

EQUITY: ${formatFrw(currentBalanceSheet.equity)}

INCOME STATEMENT
Total Income: ${formatFrw(currentBalanceSheet.totalIncome)}
Total Expenses: ${formatFrw(currentBalanceSheet.totalExpenses)}
Net Profit: ${formatFrw(currentBalanceSheet.netProfit)}

AUDIT TRAIL
Generated by: ${user?.name}
Date: ${new Date().toLocaleString()}
Role: ${user?.role}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-sheet-${selectedPeriod.replace(/\s+/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportTransactions = () => {
    const csv = [
      ["Transaction ID", "Type", "Description", "Cooperative", "Amount", "Date", "Status", "Member", "Reference", "Audit Trail"],
      ...visibleTransactions.map((t) => [
        t.id,
        t.type,
        t.description,
        t.cooperative || "N/A",
        t.amount,
        t.date,
        t.status,
        t.memberName || "N/A",
        t.reference || "N/A",
        t.auditTrail || "N/A",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Financial Management</h1>
          <p className="text-gray-600 mt-1">Track income, expenses, savings, loans, and dividends</p>
          <div className="mt-3">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              {cooperativeScope}
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          {(isAllCooperativesView || user?.role === "manager") && (
            <Button variant="secondary" onClick={() => navigate("/transactions/new")}>
              <Plus className="w-4 h-4 mr-2" />
              Record Transaction
            </Button>
          )}
          {canOpenBudgetPlanner && (
            <Button variant="secondary" onClick={() => navigate("/financials/budget-planning")}>
              <Plus className="w-4 h-4 mr-2" />
              Open Budget Planner
            </Button>
          )}
          <Button onClick={handleExportTransactions}>
            <Download className="w-4 h-4 mr-2" />
            Export Financial report
          </Button>
        </div>
      </div>
      {showDetailSelector && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
          <div className="grid gap-4 md:grid-cols-[1.6fr_1.4fr]">
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Detail view</h2>
                <p className="text-sm text-gray-600">Choose which financial section to inspect in detail.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {detailViews.map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setSelectedDetailView(view)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedDetailView === view
                        ? "bg-[#2563EB] text-white"
                        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Select cooperative</h2>
                <p className="text-sm text-gray-600">View financial details for a specific cooperative.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {cooperativeOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedCooperativeId(option.id)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedCooperativeId === option.id
                        ? "bg-[#16a34a] text-white"
                        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-4 text-sm text-gray-700">
                {roleSpecificDescription}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {financialStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${stat.trend === "up" ? "bg-green-50" : "bg-red-50"}`}>
                  <Icon className={`w-6 h-6 ${stat.trend === "up" ? "text-green-600" : "text-red-600"}`} />
                </div>
                <span className={`text-sm font-medium ${stat.trend === "up" ? "text-green-600" : "text-red-600"}`}>
                  {stat.change}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Profit & Loss Statement</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Total Income</span>
              <span className="font-semibold text-green-600">{formatFrw(stats.totalIncome)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Total Expenses</span>
              <span className="font-semibold text-red-600">{formatFrw(stats.totalExpenses)}</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-gray-200">
              <span className="text-gray-600">Total Dividends</span>
              <span className="font-semibold text-orange-600">{formatFrw(stats.totalDividends)}</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="font-semibold text-gray-900">Net Profit</span>
              <span className="font-bold text-[#2563EB] text-xl">{formatFrw(stats.totalIncome - stats.totalExpenses)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Balance Sheet</h2>
            <Button variant="secondary" className="!px-2 !py-1" onClick={handleExportBalanceSheet}>
              <Download className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-600">Assets</p>
              <p className="font-semibold text-gray-900">{formatFrw(currentBalanceSheet.assets)}</p>
            </div>
            <div className="pt-3 border-t border-gray-200">
              <p className="text-gray-600">Liabilities</p>
              <p className="font-semibold text-gray-900">{formatFrw(currentBalanceSheet.liabilities)}</p>
            </div>
            <div className="pt-3 border-t border-gray-200">
              <p className="text-gray-600">Equity</p>
              <p className="font-semibold text-gray-900">{formatFrw(currentBalanceSheet.equity)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Periods */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Periods</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {financialPeriods.map((period) => (
            <div
              key={period.id}
              onClick={() => setSelectedPeriod(period.name)}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                selectedPeriod === period.name
                  ? "border-[#2563EB] bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{period.name}</h3>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded ${
                    period.status === "Open"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {period.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-gray-600">Income</p>
                  <p className="font-medium text-green-600">{formatFrw(period.totalIncome)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Expenses</p>
                  <p className="font-medium text-red-600">{formatFrw(period.totalExpenses)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction History with Audit Trail */}
      {showDetailSelector ? (
        selectedDetailView === "Transactions" ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Transaction History & Audit Trail</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Cooperative</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Audit Trail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleTransactions.slice(0, 10).map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            transaction.type === "Income"
                              ? "bg-green-100 text-green-800"
                              : transaction.type === "Expense"
                              ? "bg-red-100 text-red-800"
                              : transaction.type === "Dividend"
                              ? "bg-orange-100 text-orange-800"
                              : transaction.type === "Savings"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {transaction.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{transaction.description}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.cooperative || "N/A"}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatFrw(transaction.amount)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.date}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            transaction.status === "Completed"
                              ? "bg-green-100 text-green-800"
                              : transaction.status === "Pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {transaction.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.auditTrail || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : selectedDetailView === "Balance Sheet" ? (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Balance Sheet Details</h2>
              <Button variant="secondary" className="!px-2 !py-1" onClick={handleExportBalanceSheet}>
                <Download className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                <p className="text-sm text-gray-500">Assets</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatFrw(selectedDetailBalanceSheet.assets)}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                <p className="text-sm text-gray-500">Liabilities</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatFrw(selectedDetailBalanceSheet.liabilities)}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                <p className="text-sm text-gray-500">Equity</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatFrw(selectedDetailBalanceSheet.equity)}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                <p className="text-sm text-gray-500">Net Profit</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatFrw(selectedDetailBalanceSheet.netProfit)}</p>
              </div>
            </div>
          </div>
        ) : selectedDetailView === "Active Loans" ? (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Loans Tracking</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Due Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Interest</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleLoanRecords.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{loan.memberName}</td>
                      <td className="px-4 py-3 font-medium">{formatFrw(loan.amount)}</td>
                      <td className="px-4 py-3">{loan.date}</td>
                      <td className="px-4 py-3">{loan.dueDate}</td>
                      <td className="px-4 py-3">{loan.interestRate}%</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            loan.status === "Active"
                              ? "bg-yellow-100 text-yellow-800"
                              : loan.status === "Paid"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {loan.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : selectedDetailView === "Loan Disbursements" ? (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Loan Disbursement Tracker</h2>
                <p className="text-sm text-gray-500">Track disbursements, member loan recipients, and repayment progress.</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Disbursed Loans</p>
                <p className="text-xl font-semibold text-[#2563EB]">{formatFrw(visibleLoanDisbursements.reduce((sum, transaction) => sum + transaction.amount, 0))}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Recipient</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Loan Description</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleLoanDisbursements.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{loan.memberName || "Unknown"}</td>
                      <td className="px-4 py-3 text-gray-600">{loan.description}</td>
                      <td className="px-4 py-3 font-medium">{formatFrw(loan.amount)}</td>
                      <td className="px-4 py-3">{loan.date}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${loan.status === "Completed" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {loan.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : selectedDetailView === "Savings Accounts" ? (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Savings Account Management</h2>
                <p className="text-sm text-gray-500">Review savings balances and member savings health across the cooperative.</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-gray-700">
                <p className="text-gray-600">Total Savings Balance</p>
                <p className="mt-1 text-xl font-semibold text-[#2563EB]">{formatFrw(savingsTotal)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Savings Balance</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleSavingsAccounts.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{member.name}</td>
                      <td className="px-4 py-3 text-gray-600">{member.role}</td>
                      <td className="px-4 py-3 font-medium text-blue-600">{formatFrw(member.savingsBalance)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${member.status === "Active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {member.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{member.lastContribution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Dividend Distribution Records</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleDividendRecords.map((div) => (
                    <tr key={div.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{div.memberName}</td>
                      <td className="px-4 py-3 font-medium text-green-600">{formatFrw(div.amount)}</td>
                      <td className="px-4 py-3">{div.period}</td>
                      <td className="px-4 py-3">{div.date}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            div.status === "Distributed"
                              ? "bg-green-100 text-green-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {div.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Transaction History & Audit Trail</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Cooperative</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Audit Trail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleTransactions.slice(0, 10).map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            transaction.type === "Income"
                              ? "bg-green-100 text-green-800"
                              : transaction.type === "Expense"
                              ? "bg-red-100 text-red-800"
                              : transaction.type === "Dividend"
                              ? "bg-orange-100 text-orange-800"
                              : transaction.type === "Savings"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {transaction.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{transaction.description}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.cooperative || "N/A"}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatFrw(transaction.amount)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.date}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            transaction.status === "Completed"
                              ? "bg-green-100 text-green-800"
                              : transaction.status === "Pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {transaction.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{transaction.auditTrail || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Loans Summary */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Loans Tracking</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Due Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Interest</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleLoanRecords.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{loan.memberName}</td>
                      <td className="px-4 py-3 font-medium">{formatFrw(loan.amount)}</td>
                      <td className="px-4 py-3">{loan.date}</td>
                      <td className="px-4 py-3">{loan.dueDate}</td>
                      <td className="px-4 py-3">{loan.interestRate}%</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            loan.status === "Active"
                              ? "bg-yellow-100 text-yellow-800"
                              : loan.status === "Paid"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {loan.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dividends Summary */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Dividend Distribution Records</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visibleDividendRecords.map((div) => (
                    <tr key={div.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">{div.memberName}</td>
                      <td className="px-4 py-3 font-medium text-green-600">{formatFrw(div.amount)}</td>
                      <td className="px-4 py-3">{div.period}</td>
                      <td className="px-4 py-3">{div.date}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            div.status === "Distributed"
                              ? "bg-green-100 text-green-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {div.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
