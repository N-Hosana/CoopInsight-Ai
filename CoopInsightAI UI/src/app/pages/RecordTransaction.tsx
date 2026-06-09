import { useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Plus, ArrowLeft, Save, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface TransactionItem {
  type: "Income" | "Expense" | "Loan" | "Savings" | "Dividend";
  amount: number;
  date: string;
  description: string;
  memberId?: string;
  reference?: string;
  status: "Pending" | "Completed" | "Failed";
}

const incomeCategories = [
  "Member Contribution",
  "Loan Interest",
  "Product Sales",
  "Grant/Donation",
  "Service Fee",
  "Other Income",
];

const expenseCategories = [
  "Operational Costs",
  "Staff Salaries",
  "Equipment",
  "Maintenance",
  "Supplies",
  "Transportation",
  "Other Expense",
];

const transactionTypeInfo = {
  Income: { color: "bg-green-50", borderColor: "border-green-200", labelColor: "text-green-900" },
  Expense: { color: "bg-red-50", borderColor: "border-red-200", labelColor: "text-red-900" },
  Loan: { color: "bg-purple-50", borderColor: "border-purple-200", labelColor: "text-purple-900" },
  Savings: { color: "bg-blue-50", borderColor: "border-blue-200", labelColor: "text-blue-900" },
  Dividend: { color: "bg-orange-50", borderColor: "border-orange-200", labelColor: "text-orange-900" },
};

export function RecordTransaction() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [formData, setFormData] = useState<Partial<TransactionItem>>({
    type: "Income",
    status: "Pending",
  });
  const [showForm, setShowForm] = useState(false);

  const canRecord = user?.role === "manager" || user?.role === "admin";

  if (!canRecord) {
    return (
      <div className="max-w-4xl mx-auto py-10">
        <Card className="p-6 text-center">
          <p className="text-gray-600">Only managers and admins can record transactions.</p>
          <Button onClick={() => navigate("/")} className="mt-4">
            Go to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || !formData.description || !formData.date) return;

    const newTransaction: TransactionItem = {
      type: formData.type || "Income",
      amount: formData.amount,
      date: formData.date,
      description: formData.description,
      memberId: formData.memberId,
      reference: formData.reference || `TXN-${Date.now()}`,
      status: formData.status || "Pending",
    };

    setTransactions([newTransaction, ...transactions]);
    setFormData({ type: "Income", status: "Pending" });
    setShowForm(false);
  };

  const handleRemoveTransaction = (idx: number) => {
    setTransactions(transactions.filter((_, i) => i !== idx));
  };

  const handleSubmitAll = () => {
    if (transactions.length === 0) {
      alert("Please add at least one transaction");
      return;
    }

    // Save transactions to localStorage
    const allTransactions = JSON.parse(localStorage.getItem("coopinsight_transactions") || "[]");
    const updatedTransactions = [...transactions, ...allTransactions];
    localStorage.setItem("coopinsight_transactions", JSON.stringify(updatedTransactions));

    alert(`${transactions.length} transaction(s) recorded successfully!`);
    navigate("/financials");
  };

  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      Income: "bg-green-100 text-green-800",
      Expense: "bg-red-100 text-red-800",
      Loan: "bg-purple-100 text-purple-800",
      Savings: "bg-blue-100 text-blue-800",
      Dividend: "bg-orange-100 text-orange-800",
    };
    return colors[type] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-8">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/financials")} className="flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8]">
          <ArrowLeft className="w-4 h-4" />
          Back to Financials
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Record Transactions</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Add Transactions</h2>
              <Button onClick={() => setShowForm(!showForm)} size="sm">
                <Plus className="w-4 h-4 mr-1" />
                {showForm ? "Cancel" : "New"}
              </Button>
            </div>

            {showForm && (
              <form onSubmit={handleAddTransaction} className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200 mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Transaction Type</label>
                    <select
                      value={formData.type || "Income"}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                    >
                      <option>Income</option>
                      <option>Expense</option>
                      <option>Loan</option>
                      <option>Savings</option>
                      <option>Dividend</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount (RWF)</label>
                    <input
                      type="number"
                      value={formData.amount || ""}
                      onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
                      placeholder="0"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g., Monthly member contribution"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                    <input
                      type="date"
                      value={formData.date || ""}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={formData.status || "Pending"}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                    >
                      <option>Pending</option>
                      <option>Completed</option>
                      <option>Failed</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Member ID (Optional)</label>
                  <input
                    type="text"
                    value={formData.memberId || ""}
                    onChange={(e) => setFormData({ ...formData, memberId: e.target.value })}
                    placeholder="For member-specific transactions"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reference (Optional)</label>
                  <input
                    type="text"
                    value={formData.reference || ""}
                    onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                    placeholder="e.g., Invoice #12345 or Receipt #67890"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>

                <Button type="submit" className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Add to Batch
                </Button>
              </form>
            )}

            {transactions.length > 0 && (
              <div className="space-y-3">
                {transactions.map((txn, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 ${transactionTypeInfo[txn.type as keyof typeof transactionTypeInfo].borderColor} ${transactionTypeInfo[txn.type as keyof typeof transactionTypeInfo].color}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-1 rounded ${getTypeColor(txn.type)}`}>
                            {txn.type}
                          </span>
                          <span className="text-sm font-medium text-gray-600">{txn.date}</span>
                        </div>
                        <p className="font-medium text-gray-900 mb-1">{txn.description}</p>
                        {txn.reference && <p className="text-xs text-gray-600">Ref: {txn.reference}</p>}
                        {txn.memberId && <p className="text-xs text-gray-600">Member: {txn.memberId}</p>}
                      </div>
                      <div className="text-right mr-4">
                        <p className="text-lg font-bold text-gray-900">₣{txn.amount.toLocaleString("en-RW")}</p>
                        <p className={`text-xs font-medium ${
                          txn.status === "Completed"
                            ? "text-green-600"
                            : txn.status === "Pending"
                            ? "text-yellow-600"
                            : "text-red-600"
                        }`}>
                          {txn.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveTransaction(idx)}
                        className="text-red-600 hover:text-red-700 p-2"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {transactions.length === 0 && !showForm && (
              <div className="text-center py-8 text-gray-600">
                <p>No transactions added yet. Click "New" to add your first transaction.</p>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 bg-blue-50 border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-4">Transaction Summary</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Transactions</p>
                <p className="text-3xl font-bold text-gray-900">{transactions.length}</p>
              </div>
              <div className="pt-3 border-t border-blue-200">
                <p className="text-sm text-gray-600 mb-1">Total Amount</p>
                <p className="text-2xl font-bold text-[#2563EB]">₣{totalAmount.toLocaleString("en-RW")}</p>
              </div>
              <div className="pt-3 border-t border-blue-200">
                <p className="text-sm text-gray-600 mb-2">By Status</p>
                <div className="space-y-1 text-sm">
                  <p className="text-green-700">✓ Completed: {transactions.filter((t) => t.status === "Completed").length}</p>
                  <p className="text-yellow-700">⟳ Pending: {transactions.filter((t) => t.status === "Pending").length}</p>
                  <p className="text-red-700">✗ Failed: {transactions.filter((t) => t.status === "Failed").length}</p>
                </div>
              </div>
              <div className="pt-3 border-t border-blue-200">
                <p className="text-sm text-gray-600 mb-2">By Type</p>
                <div className="space-y-1 text-sm">
                  {["Income", "Expense", "Loan", "Savings", "Dividend"].map((type) => {
                    const count = transactions.filter((t) => t.type === type).length;
                    return count > 0 ? <p key={type}>• {type}: {count}</p> : null;
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Categories</h3>
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium text-gray-700 mb-2">Income Sources</p>
                {incomeCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setFormData({ type: "Income", description: cat, status: "Pending" });
                      setShowForm(true);
                    }}
                    className="w-full text-left text-xs py-1 px-2 rounded hover:bg-green-50 hover:text-green-900 transition-colors"
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="pt-3 border-t border-gray-200">
                <p className="text-xs font-medium text-gray-700 mb-2">Expense Categories</p>
                {expenseCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setFormData({ type: "Expense", description: cat, status: "Pending" });
                      setShowForm(true);
                    }}
                    className="w-full text-left text-xs py-1 px-2 rounded hover:bg-red-50 hover:text-red-900 transition-colors"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {transactions.length > 0 && (
            <Button onClick={handleSubmitAll} className="w-full bg-green-600 hover:bg-green-700">
              <Save className="w-4 h-4 mr-2" />
              Submit All Transactions
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
