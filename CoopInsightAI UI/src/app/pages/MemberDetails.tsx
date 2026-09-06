import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import {
  Phone,
  Building2,
  ShieldCheck,
  CreditCard,
  TrendingUp,
  MessageSquare,
  Download,
  ArrowLeft,
} from "lucide-react";
import { Button } from "../components/Button";
import { api } from "../services/api";

interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  national_id: string;
  join_date: string;
  status: string;
  cooperative_id: string;
  cooperative_name: string;
  total_contributions: number;
  loan_balance: number;
  savings_balance: number;
}

interface Loan {
  id: string;
  amount: number;
  balance: number;
  interest_rate: number;
  due_date: string;
  status: string;
  disbursed_at: string;
}

interface Contribution {
  id: string;
  amount: number;
  type: string;
  recorded_at: string;
  description: string;
}

interface Dividend {
  id: string;
  amount: number;
  period: string;
  status: string;
  paid_at: string;
}

function formatFrw(amount: number): string {
  return `RWF ${amount.toLocaleString()}`;
}

export function MemberDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [member, setMember] = useState<Member | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    Promise.all([
      api.get(`/members/${id}`),
      api.get(`/members/${id}/loans`),
      api.get(`/members/${id}/contributions`),
      api.get(`/members/${id}/dividends`),
    ])
      .then(([memberRes, loansRes, contributionsRes, dividendsRes]) => {
        setMember(memberRes.data);
        setLoans(loansRes.data ?? []);
        setContributions(contributionsRes.data ?? []);
        setDividends(dividendsRes.data ?? []);
      })
      .catch((err) => {
        setError(err?.response?.data?.message ?? "Failed to load member data.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const authorized = useMemo(() => {
    if (!user || !member) return false;
    if (user.role === "member") return user.id === member.id;
    if (user.role === "manager") return user.cooperativeId === member.cooperative_id;
    if (user.role === "admin") return true;
    return false;
  }, [member, user]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-700">Loading member details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-700">Member not found.</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-700">Please sign in to view this member's details.</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <p className="text-gray-700">You do not have permission to view this member's profile.</p>
      </div>
    );
  }

  const handleExportReport = () => {
    const report = `
MEMBER DETAILED REPORT
Generated: ${new Date().toLocaleString()}

MEMBER INFORMATION
Name: ${member.name}
ID: ${member.id}
National ID: ${member.national_id}
Role: ${member.role}
Status: ${member.status}
Cooperative: ${member.cooperative_name}
Join Date: ${member.join_date}

CONTACT INFORMATION
Phone: ${member.phone}
Email: ${member.email}

FINANCIAL SUMMARY
Total Contributions: ${formatFrw(member.total_contributions)}
Loan Balance: ${formatFrw(member.loan_balance)}
Savings Balance: ${formatFrw(member.savings_balance)}

CONTRIBUTION HISTORY (${contributions.length} transactions)
${contributions.map((c) => `- ${c.recorded_at}: ${c.description || c.type} - ${formatFrw(c.amount)}`).join("\n")}

LOAN HISTORY (${loans.length} loans)
${loans.map((l) => `- ${l.disbursed_at}: ${formatFrw(l.amount)} (${l.status}) - Interest: ${l.interest_rate}% - Balance: ${formatFrw(l.balance)}`).join("\n")}

DIVIDEND HISTORY (${dividends.length} distributions)
${dividends.map((d) => `- ${d.paid_at ?? "Pending"}: ${formatFrw(d.amount)} (${d.period}) - ${d.status}`).join("\n")}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `member-report-${member.id}-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/members")}
          className="inline-flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B4332]"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Members
        </button>
        <Button onClick={handleExportReport}>
          <Download className="w-4 h-4 mr-2" />
          Export Report
        </Button>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{member.name}</h1>
            <p className="text-gray-600 mt-2">
              {member.role} at {member.cooperative_name}
            </p>
          </div>
          <div className="rounded-3xl bg-[#F1F8F2] px-4 py-2 text-sm font-medium text-[#1B4332]">
            {member.status}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="rounded-2xl bg-gray-50 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-[#2D6A4F]" />
              <span className="text-sm font-medium text-gray-900">Phone</span>
            </div>
            <p className="text-gray-700">{member.phone}</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-[#2D6A4F]" />
              <span className="text-sm font-medium text-gray-900">Cooperative</span>
            </div>
            <p className="text-gray-700">{member.cooperative_name}</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-[#2D6A4F]" />
              <span className="text-sm font-medium text-gray-900">Join Date</span>
            </div>
            <p className="text-gray-700">
              {member.join_date ? new Date(member.join_date).toLocaleDateString() : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Total Contributions</p>
          <p className="text-2xl font-bold text-gray-900">{formatFrw(member.total_contributions)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Loan Balance</p>
          <p className="text-2xl font-bold text-red-600">{formatFrw(member.loan_balance)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Savings Balance</p>
          <p className="text-2xl font-bold text-green-600">{formatFrw(member.savings_balance)}</p>
        </div>
      </div>

      {/* Contribution History */}
      <div className="rounded-2xl border border-gray-200 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-gray-900">Contribution History</h2>
        </div>
        <div className="space-y-3">
          {contributions.length > 0 ? (
            contributions.map((contrib) => (
              <div key={contrib.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{contrib.description || contrib.type}</p>
                  <p className="text-sm text-gray-500">
                    {contrib.recorded_at ? new Date(contrib.recorded_at).toLocaleDateString() : "N/A"}
                  </p>
                </div>
                <p className="text-sm font-semibold text-green-600">{formatFrw(contrib.amount)}</p>
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-sm">No contribution history</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Loan History */}
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard className="w-5 h-5 text-[#2563EB]" />
            <h2 className="text-lg font-semibold text-gray-900">Loan History</h2>
          </div>
          <div className="space-y-3">
            {loans.length > 0 ? (
              loans.map((loan) => (
                <div key={loan.id} className="p-3 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-gray-900">{formatFrw(loan.amount)}</p>
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded ${
                        loan.status === "active"
                          ? "bg-yellow-100 text-yellow-800"
                          : loan.status === "paid"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {loan.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Date: {loan.disbursed_at ? new Date(loan.disbursed_at).toLocaleDateString() : "N/A"}
                  </p>
                  <p className="text-sm text-gray-600">
                    Due: {loan.due_date ? new Date(loan.due_date).toLocaleDateString() : "N/A"}
                  </p>
                  <p className="text-sm text-gray-600">Interest: {loan.interest_rate}%</p>
                  <p className="text-sm text-gray-600">Balance: {formatFrw(loan.balance)}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">No loans</p>
            )}
          </div>
        </div>

        {/* Dividend History */}
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-5 h-5 text-[#2563EB]" />
            <h2 className="text-lg font-semibold text-gray-900">Dividend Distribution</h2>
          </div>
          <div className="space-y-3">
            {dividends.length > 0 ? (
              dividends.map((div) => (
                <div key={div.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-900">{div.period}</p>
                    <p className="text-sm text-gray-500">
                      {div.paid_at ? new Date(div.paid_at).toLocaleDateString() : "Pending"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">{formatFrw(div.amount)}</p>
                    <p className="text-xs text-gray-500">{div.status}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">No dividend records</p>
            )}
          </div>
        </div>
      </div>

      {/* Communication Log placeholder — no backend endpoint provided */}
      <div className="rounded-2xl border border-gray-200 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <MessageSquare className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-gray-900">Communication Log</h2>
        </div>
        <p className="text-gray-500 text-sm">No communication log</p>
      </div>
    </div>
  );
}
