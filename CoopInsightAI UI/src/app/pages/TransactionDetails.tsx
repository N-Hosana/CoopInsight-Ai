import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Users, Calendar, CheckCircle } from "lucide-react";

interface Transaction {
  id: string;
  type: string;
  description: string;
  amount: string;
  date: string;
  status: string;
}

const fallbackTransactions: Transaction[] = [
  { id: "1", type: "Income", description: "Member Contribution - March", amount: "2,500,000RWF", date: "2026-04-25", status: "Completed" },
  { id: "2", type: "Expense", description: "Office Supplies Purchase", amount: "350,000RWF", date: "2026-04-24", status: "Completed" },
  { id: "3", type: "Loan", description: "Loan Disbursement - Maria K.", amount: "1,200,000RWF", date: "2026-04-23", status: "Completed" },
];

export function TransactionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const transaction = useMemo(() => {
    const stored = localStorage.getItem("coopinsight_transactions");
    const items: Transaction[] = stored ? JSON.parse(stored) : [];
    return items.find((item) => item.id === id) || fallbackTransactions.find((item) => item.id === id) || null;
  }, [id]);

  if (!transaction) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-700">Transaction not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate("/financials")} className="inline-flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B4332]">
        <ArrowLeft className="w-4 h-4" /> Back to Financials
      </button>
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Transaction Details</p>
            <h1 className="text-3xl font-bold text-gray-900 mt-2">{transaction.description}</h1>
            <p className="text-sm text-gray-500 mt-2">Type: {transaction.type}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#2D6A4F]">{transaction.amount}</p>
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${transaction.status === "Completed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
              <CheckCircle className="w-4 h-4" /> {transaction.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Date</p>
            <p className="mt-2 text-gray-900 font-medium">{transaction.date}</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Category</p>
            <p className="mt-2 text-gray-900 font-medium">{transaction.type}</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Impact</p>
            <p className="mt-2 text-gray-900 font-medium">{transaction.type === "Income" ? "Positive" : transaction.type === "Expense" ? "Negative" : "Neutral"}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-200 p-6 bg-gray-50">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-5 h-5 text-[#2D6A4F]" />
              <h2 className="text-lg font-semibold text-gray-900">Related Activity</h2>
            </div>
            <p className="text-sm text-gray-600">This transaction is linked to cooperative operations and member payments.</p>
          </div>
          <div className="rounded-2xl border border-gray-200 p-6 bg-gray-50">
            <div className="flex items-center gap-3 mb-4">
              <Calendar className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
            </div>
            <p className="text-sm text-gray-600">Amount recorded in Rwandan francs. Review this transaction if the amount or date needs adjustment.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
