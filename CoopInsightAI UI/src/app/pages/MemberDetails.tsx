import { useMemo } from "react";
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
import {
  members,
  getMemberLoanHistory,
  getMemberDividendHistory,
  getMemberCommunicationLog,
  getMemberContributionHistory,
  formatFrw,
} from "../data/financialData";

interface Member {
  id: string;
  name: string;
  role: string;
  contribution: string;
  cooperative: string;
  cooperativeId: string;
  phone: string;
  email: string;
  nationalId: string;
  joinDate?: string;
  status?: "Active" | "Probation" | "Inactive";
}

const fallbackMembers: Member[] = [
  {
    id: "member-1",
    name: "Sarah Johnson",
    role: "Producer",
    contribution: "RWF 2,500",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123456",
    email: "sarah@greenvalley.coop",
    nationalId: "1199212345678904",
    joinDate: "2024-02-15",
    status: "Active",
  },
];

export function MemberDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const member = useMemo(() => {
    const stored = localStorage.getItem("coopinsight_members");
    const items: Member[] = stored ? JSON.parse(stored) : [];
    return items.find((item) => item.id === id) || fallbackMembers.find((item) => item.id === id) || null;
  }, [id]);

  const memberData = useMemo(() => {
    if (!member) return null;
    return members.find((m) => m.id === id);
  }, [member, id]);

  const authorized = useMemo(() => {
    if (!user || !member) return false;
    if (user.role === "member") return user.id === member.id;
    if (user.role === "manager") return user.cooperativeId === member.cooperativeId;
    if (user.role === "admin") return true;
    return false;
  }, [member, user]);

  const loanHistory = useMemo(() => (member ? getMemberLoanHistory(member.id) : []), [member]);
  const dividendHistory = useMemo(() => (member ? getMemberDividendHistory(member.id) : []), [member]);
  const communicationLog = useMemo(() => (member ? getMemberCommunicationLog(member.id) : []), [member]);
  const contributionHistory = useMemo(() => (member ? getMemberContributionHistory(member.id) : []), [member]);

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
National ID: ${member.nationalId}
Role: ${member.role}
Status: ${member.status || "Active"}
Cooperative: ${member.cooperative}
Join Date: ${member.joinDate}

CONTACT INFORMATION
Phone: ${member.phone}
Email: ${member.email}

FINANCIAL SUMMARY
Contribution: ${member.contribution}
Membership Fee: ${memberData ? formatFrw(memberData.membershipFee) : "N/A"}
Loan Balance: ${memberData ? formatFrw(memberData.loanBalance) : "N/A"}
Savings Balance: ${memberData ? formatFrw(memberData.savingsBalance) : "N/A"}

CONTRIBUTION HISTORY (${contributionHistory.length} transactions)
${contributionHistory.map((t) => `- ${t.date}: ${t.description} - ${formatFrw(t.amount)}`).join("\n")}

LOAN HISTORY (${loanHistory.length} loans)
${loanHistory.map((l) => `- ${l.date}: ${formatFrw(l.amount)} (${l.status}) - Interest: ${l.interestRate}%`).join("\n")}

DIVIDEND HISTORY (${dividendHistory.length} distributions)
${dividendHistory.map((d) => `- ${d.date}: ${formatFrw(d.amount)} (${d.period})`).join("\n")}

COMMUNICATION LOG (${communicationLog.length} interactions)
${communicationLog.map((c) => `- ${c.date}: ${c.type} - ${c.message}`).join("\n")}
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
              {member.role} at {member.cooperative}
            </p>
          </div>
          <div className="rounded-3xl bg-[#F1F8F2] px-4 py-2 text-sm font-medium text-[#1B4332]">
            {member.status || "Active"}
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
            <p className="text-gray-700">{member.cooperative}</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-6 space-y-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-[#2D6A4F]" />
              <span className="text-sm font-medium text-gray-900">Join Date</span>
            </div>
            <p className="text-gray-700">
              {member.joinDate ? new Date(member.joinDate).toLocaleDateString() : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Contribution</p>
          <p className="text-2xl font-bold text-gray-900">{member.contribution}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Loan Balance</p>
          <p className="text-2xl font-bold text-red-600">
            {memberData ? formatFrw(memberData.loanBalance) : "RWF 0"}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Savings Balance</p>
          <p className="text-2xl font-bold text-green-600">
            {memberData ? formatFrw(memberData.savingsBalance) : "RWF 0"}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-6 bg-white">
          <p className="text-sm text-gray-500 mb-2">Membership Fee</p>
          <p className="text-2xl font-bold text-blue-600">
            {memberData ? formatFrw(memberData.membershipFee) : "RWF 0"}
          </p>
        </div>
      </div>

      {/* Contribution History */}
      <div className="rounded-2xl border border-gray-200 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-gray-900">Contribution History</h2>
        </div>
        <div className="space-y-3">
          {contributionHistory.length > 0 ? (
            contributionHistory.map((trans) => (
              <div key={trans.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{trans.description}</p>
                  <p className="text-sm text-gray-500">{trans.date}</p>
                </div>
                <p className="text-sm font-semibold text-green-600">{formatFrw(trans.amount)}</p>
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
            {loanHistory.length > 0 ? (
              loanHistory.map((loan) => (
                <div key={loan.id} className="p-3 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-gray-900">{formatFrw(loan.amount)}</p>
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded ${
                        loan.status === "Active"
                          ? "bg-yellow-100 text-yellow-800"
                          : loan.status === "Paid"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {loan.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">Date: {loan.date}</p>
                  <p className="text-sm text-gray-600">Due: {loan.dueDate}</p>
                  <p className="text-sm text-gray-600">Interest: {loan.interestRate}%</p>
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
            {dividendHistory.length > 0 ? (
              dividendHistory.map((div) => (
                <div key={div.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-900">{div.period}</p>
                    <p className="text-sm text-gray-500">{div.date}</p>
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

      {/* Communication Log */}
      <div className="rounded-2xl border border-gray-200 p-6 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <MessageSquare className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-semibold text-gray-900">Communication Log</h2>
        </div>
        <div className="space-y-3">
          {communicationLog.length > 0 ? (
            communicationLog.map((log) => (
              <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                <div className="mt-1">
                  <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
                    {log.type}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{log.message}</p>
                  <p className="text-sm text-gray-500">{log.date}</p>
                </div>
                <span className="text-xs text-gray-600">{log.status}</span>
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-sm">No communication log</p>
          )}
        </div>
      </div>
    </div>
  );
}

