import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Users, Calendar, CheckCircle } from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

interface Transaction {
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

export function TransactionDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "Admin";

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchTransaction = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get(`/transactions/${id}`);
        setTransaction(response.data?.transaction || response.data);
      } catch (err: any) {
        setError(err?.response?.data?.message || "Failed to load transaction.");
      } finally {
        setLoading(false);
      }
    };
    fetchTransaction();
  }, [id]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!id || !transaction) return;
    try {
      setUpdatingStatus(true);
      setStatusError(null);
      const response = await api.patch(`/transactions/${id}/status`, { status: newStatus });
      setTransaction(response.data?.transaction || { ...transaction, status: newStatus });
    } catch (err: any) {
      setStatusError(err?.response?.data?.message || "Failed to update status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-500 text-sm">Loading transaction...</p>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="max-w-4xl mx-auto py-12 space-y-4">
        <button onClick={() => navigate("/financials")} className="inline-flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B4332]">
          <ArrowLeft className="w-4 h-4" /> Back to Financials
        </button>
        <p className="text-gray-700">{error || "Transaction not found."}</p>
      </div>
    );
  }

  const formattedAmount = new Intl.NumberFormat("rw-RW", {
    style: "currency",
    currency: "RWF",
    minimumFractionDigits: 0,
  }).format(transaction.amount);

  const impactLabel =
    transaction.type === "income" || transaction.type === "Income"
      ? "Positive"
      : transaction.type === "expense" || transaction.type === "Expense"
      ? "Negative"
      : "Neutral";

  const isCompleted = transaction.status === "Completed" || transaction.status === "completed";

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
            {transaction.reference && (
              <p className="text-sm text-gray-500">Reference: {transaction.reference}</p>
            )}
            {transaction.cooperative_name && (
              <p className="text-sm text-gray-500">Cooperative: {transaction.cooperative_name}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#2D6A4F]">{formattedAmount}</p>
            <span
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                isCompleted ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
              }`}
            >
              <CheckCircle className="w-4 h-4" /> {transaction.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Date Recorded</p>
            <p className="mt-2 text-gray-900 font-medium">
              {transaction.recorded_at
                ? new Date(transaction.recorded_at).toLocaleDateString()
                : "—"}
            </p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Category</p>
            <p className="mt-2 text-gray-900 font-medium">{transaction.category || transaction.type}</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Impact</p>
            <p className="mt-2 text-gray-900 font-medium">{impactLabel}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-200 p-6 bg-gray-50">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-5 h-5 text-[#2D6A4F]" />
              <h2 className="text-lg font-semibold text-gray-900">Related Activity</h2>
            </div>
            <p className="text-sm text-gray-600">
              {transaction.recorded_by_name
                ? `Recorded by ${transaction.recorded_by_name}.`
                : "This transaction is linked to cooperative operations and member payments."}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 p-6 bg-gray-50">
            <div className="flex items-center gap-3 mb-4">
              <Calendar className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
            </div>
            <p className="text-sm text-gray-600">Amount recorded in Rwandan francs. Review this transaction if the amount or date needs adjustment.</p>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-8 rounded-2xl border border-gray-200 p-6 bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Update Status</h2>
            {statusError && (
              <p className="text-red-600 text-sm mb-3">{statusError}</p>
            )}
            <div className="flex flex-wrap gap-3">
              {["Pending", "Completed", "Cancelled"].map((status) => (
                <button
                  key={status}
                  disabled={updatingStatus || transaction.status === status}
                  onClick={() => handleStatusUpdate(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    transaction.status === status
                      ? "bg-gray-200 text-gray-500 cursor-default"
                      : "bg-[#2D6A4F] text-white hover:bg-[#1B4332] disabled:opacity-50"
                  }`}
                >
                  {updatingStatus ? "Updating..." : status}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
