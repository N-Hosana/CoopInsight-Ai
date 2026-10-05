import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  Phone,
  Mail,
  Building2,
  ShieldCheck,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Download,
  ArrowLeft,
  CalendarCheck,
  Receipt,
  AlertTriangle,
  Wallet,
  UserMinus,
  Lock,
} from "lucide-react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { api } from "../services/api";
import { MemberHistory } from "../components/MemberHistory";

/**
 * One member's file.
 *
 * Who sees it is decided by the server, not here — `/members/:id/profile`
 * returns 403 with a reason for anyone out of scope, and reports the `scope`
 * it granted so the page can adjust its language. A member reading their own
 * record sees "your savings"; an officer reading it sees the member's name.
 */

interface MemberRecord {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  role: string;
  national_id: string;
  membership_number: string;
  membership_date: string;
  status: string;
  gender: string | null;
  sector: string | null;
  cell: string | null;
  village: string | null;
  address: string | null;
  photo_url: string | null;
  total_savings: string;
  total_contributions: string;
  cooperative_id: string;
  cooperative_name: string;
}

interface Profile {
  member: MemberRecord;
  financial: {
    savings: number;
    totalContributions: number;
    contributionsByType: Record<string, number>;
    contributionCount: number;
    lastContributionOn: string | null;
    outstandingLoans: number;
    overdueLoans: number;
    loanCount: number;
    dividendsPaid: number;
  };
  participation: {
    invited: number;
    attended: number;
    attendanceRate: number | null;
    lastAttendedOn: string | null;
  };
  cohort: {
    memberCount: number;
    averageSavings: number;
    highestSavings: number;
    savingsVsAverage: number | null;
  };
  contributions: Array<{ id: string; amount: string; type: string; date: string; notes: string | null }>;
  loans: Array<{
    id: string; amount: string; balance: string; purpose: string; interest_rate: string;
    status: string; due_at: string; issued_at: string; repaid: string;
    repayments: Array<{ id: string; amount: string; date: string; notes: string | null }>;
  }>;
  dividends: Array<{ id: string; amount: string; period: string; paid_at: string | null }>;
  activities: Array<{
    id: string; title: string; type: string; status: string; date: string;
    location: string | null; participant_role: string | null; attended: boolean;
    participant_notes: string | null;
  }>;
  transactions: Array<{
    id: string; type: string; category: string; amount: string; date: string;
    description: string; reference: string | null; payment_method: string | null;
    status: string; recorded_by_name: string | null;
  }>;
  statusLog: Array<{
    id: string; old_status: string; new_status: string; reason: string | null;
    changed_at: string; changed_by_name: string | null;
  }>;
  exitRequests: Array<{
    id: string; status: string; reason_category: string; reason_detail: string;
    created_at: string; decided_at: string | null; decision_note: string | null;
  }>;
}

const money = (v: number | string | null | undefined) =>
  v == null ? "—" : `RWF ${Number(v).toLocaleString()}`;

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const titleCase = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-100 text-gray-700",
  suspended: "bg-red-100 text-red-700",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  overdue: "bg-red-100 text-red-700",
  repaid: "bg-green-100 text-green-800",
  planned: "bg-blue-100 text-blue-800",
};

function Stat({
  label,
  value,
  hint,
  tone = "default",
  Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  Icon?: typeof Wallet;
}) {
  const tones = {
    default: "text-gray-900",
    good: "text-[#2D6A4F]",
    warn: "text-amber-700",
    bad: "text-red-700",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-500" />}
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      </div>
      <p className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </Card>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 py-6 text-center">{children}</p>;
}

export function MemberDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [scope, setScope] = useState<string>("");
  // Set when this record belongs to someone who has left the cooperative.
  const [former, setFormer] = useState<{ since: string; reason: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [searchParams] = useSearchParams();
  type Tab = "overview" | "history" | "money" | "activities" | "transactions" | "record";
  // "View all" on the dashboard opens straight onto the history.
  const [tab, setTab] = useState<Tab>(
    (["history", "money", "activities", "transactions", "record"].includes(searchParams.get("tab") ?? "")
      ? searchParams.get("tab")
      : "overview") as Tab
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setDenied(false);

    api
      .get<{ data: Profile; scope: string; former?: { since: string; reason: string | null } | null }>(`/members/${id}/profile`)
      .then((res) => {
        setProfile(res.data);
        setScope(res.scope);
        setFormer(res.former ?? null);
      })
      .catch((err: any) => {
        // The API client throws { status, message } — not an axios error.
        setDenied(err?.status === 403);
        setError(err?.message ?? "Failed to load this member's record.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  /** A member reading their own file should be addressed in the second person. */
  const isOwn = scope === "own";
  const who = isOwn ? "you" : profile?.member.full_name ?? "this member";

  const exportReport = () => {
    if (!profile) return;
    const { member, financial, participation } = profile;
    const report = [
      "MEMBER RECORD",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      `Name:            ${member.full_name}`,
      `Membership no.:  ${member.membership_number}`,
      `National ID:     ${member.national_id}`,
      `Role:            ${titleCase(member.role)}`,
      `Status:          ${titleCase(member.status)}`,
      `Cooperative:     ${member.cooperative_name}`,
      `Member since:    ${formatDate(member.membership_date)}`,
      `Phone:           ${member.phone}`,
      `Email:           ${member.email ?? "—"}`,
      "",
      "FINANCIAL POSITION",
      `Savings:              ${money(financial.savings)}`,
      `Contributions paid:   ${financial.contributionCount}`,
      `Outstanding loans:    ${money(financial.outstandingLoans)}`,
      `Dividends received:   ${money(financial.dividendsPaid)}`,
      "",
      "PARTICIPATION",
      `Invited to:   ${participation.invited} activities`,
      `Attended:     ${participation.attended}`,
      `Attendance:   ${participation.attendanceRate == null ? "not measurable" : `${participation.attendanceRate}%`}`,
      "",
      `CONTRIBUTIONS (${profile.contributions.length})`,
      ...profile.contributions.map(
        (c) => `  ${formatDate(c.date)}  ${titleCase(c.type).padEnd(16)} ${money(c.amount)}`
      ),
      "",
      `LOANS (${profile.loans.length})`,
      ...profile.loans.map(
        (l) => `  ${formatDate(l.issued_at)}  ${money(l.amount)} — ${l.status}, balance ${money(l.balance)}`
      ),
      "",
      `ACTIVITIES (${profile.activities.length})`,
      ...profile.activities.map(
        (a) => `  ${formatDate(a.date)}  ${a.attended ? "attended" : "absent  "}  ${a.title}`
      ),
      "",
      `TRANSACTIONS (${profile.transactions.length})`,
      ...profile.transactions.map(
        (t) => `  ${formatDate(t.date)}  ${t.type.padEnd(8)} ${money(t.amount)}  ${t.description}`
      ),
      "",
      `STATUS CHANGES (${profile.statusLog.length})`,
      ...profile.statusLog.map(
        (s) => `  ${formatDate(s.changed_at)}  ${s.old_status} → ${s.new_status}  ${s.reason ?? ""}`
      ),
    ].join("\n");

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `member-${member.membership_number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-gray-500">Loading the member record…</p>;

  if (denied) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <span className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </span>
        </Button>
        <Card className="p-8">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-gray-900">This record is not yours to read</p>
              <p className="text-sm text-gray-600 mt-1 max-w-xl">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <span className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </span>
        </Button>
        <Card className="p-8">
          <p className="text-red-600">{error ?? "Member not found."}</p>
        </Card>
      </div>
    );
  }

  const { member, financial, participation, cohort } = profile;
  const warnings = profile.statusLog.filter((s) => s.new_status === "suspended");

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "history" as const, label: "History" },
    { id: "money" as const, label: `Savings & loans (${profile.contributions.length + profile.loans.length})` },
    { id: "activities" as const, label: `Activities (${profile.activities.length})` },
    { id: "transactions" as const, label: `Transactions (${profile.transactions.length})` },
    { id: "record" as const, label: `Record (${profile.statusLog.length + profile.exitRequests.length})` },
  ];

  return (
    <div className="space-y-6">
      {former && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <strong>{isOwn ? "You left" : "This member left"} {profile?.member.cooperative_name ?? "the cooperative"} on{" "}
          {new Date(former.since).toLocaleDateString()}.</strong>{" "}
          This is the record as it stood then — savings, loans and attendance up to the date of leaving.
          {former.reason && <span className="block mt-1 text-slate-600">{former.reason}</span>}
          {isOwn && (
            <span className="block mt-1 text-slate-600">
              If you never asked to leave, contact your cooperative manager: they can reverse an exit recorded in error.
            </span>
          )}
        </div>
      )}
      <Button variant="outline" onClick={() => navigate(-1)}>
        <span className="flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </span>
      </Button>

      {/* Identity */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-[#2D6A4F] text-white flex items-center justify-center text-lg font-semibold shrink-0">
              {member.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-gray-900">{member.full_name}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[member.status] ?? "bg-gray-100 text-gray-700"}`}
                >
                  {titleCase(member.status)}
                </span>
                {member.role !== "member" && (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                    {titleCase(member.role)}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {member.membership_number} · member since {formatDate(member.membership_date)}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-gray-600">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> {member.cooperative_name}
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {member.phone}
                </span>
                {member.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> {member.email}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> {member.national_id}
                </span>
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={exportReport}>
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export record
            </span>
          </Button>
        </div>

        {isOwn && (
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-2.5 text-sm text-gray-700">
            This is your own membership record. Other members cannot see it, and you cannot see
            theirs.
          </p>
        )}
      </Card>

      {/* Warnings sit above everything — they are the thing you must not miss */}
      {warnings.length > 0 && (
        <Card className="p-5 border-l-4 border-l-red-500">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-gray-900">
                {warnings.length} suspension{warnings.length === 1 ? "" : "s"} on record
              </p>
              <ul className="mt-2 space-y-1.5">
                {warnings.map((w) => (
                  <li key={w.id} className="text-sm text-gray-700">
                    <span className="text-gray-500">{formatDate(w.changed_at)}</span> —{" "}
                    {w.reason ?? "No reason recorded."}
                    {w.changed_by_name && (
                      <span className="text-gray-500"> ({w.changed_by_name})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Position at a glance */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={isOwn ? "Your savings" : "Savings"}
          value={money(financial.savings)}
          Icon={Wallet}
          tone="good"
          hint={
            cohort.savingsVsAverage == null
              ? undefined
              : `${Math.abs(cohort.savingsVsAverage)}% ${cohort.savingsVsAverage >= 0 ? "above" : "below"} the cooperative average of ${money(cohort.averageSavings)}`
          }
        />
        <Stat
          label="Outstanding loans"
          value={money(financial.outstandingLoans)}
          Icon={CreditCard}
          tone={financial.overdueLoans > 0 ? "bad" : financial.outstandingLoans > 0 ? "warn" : "default"}
          hint={
            financial.overdueLoans > 0
              ? `${financial.overdueLoans} overdue`
              : `${financial.loanCount} loan(s) on record`
          }
        />
        <Stat
          label="Attendance"
          value={
            participation.attendanceRate == null ? "—" : `${participation.attendanceRate}%`
          }
          Icon={CalendarCheck}
          tone={
            participation.attendanceRate == null
              ? "default"
              : participation.attendanceRate >= 60
                ? "good"
                : participation.attendanceRate >= 30
                  ? "warn"
                  : "bad"
          }
          hint={
            participation.invited === 0
              ? "Never invited to an activity"
              : `${participation.attended} of ${participation.invited} attended`
          }
        />
        <Stat
          label="Contributions"
          value={String(financial.contributionCount)}
          Icon={TrendingUp}
          hint={
            financial.lastContributionOn
              ? `Last paid ${formatDate(financial.lastContributionOn)}`
              : "None recorded"
          }
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {isOwn ? "How you are doing" : "Standing in the cooperative"}
            </h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Savings against the cooperative average</span>
                  <span className="font-medium text-gray-900">{money(financial.savings)}</span>
                </div>
                <div className="mt-1.5 h-2 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-[#2D6A4F]"
                    style={{
                      width: `${cohort.highestSavings > 0 ? Math.min(100, (financial.savings / cohort.highestSavings) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Average {money(cohort.averageSavings)} · highest {money(cohort.highestSavings)} ·{" "}
                  {cohort.memberCount} members
                </p>
              </div>

              {Object.entries(financial.contributionsByType).length > 0 && (
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                    What has been paid in
                  </p>
                  {Object.entries(financial.contributionsByType).map(([type, amount]) => (
                    <div key={type} className="flex items-center justify-between py-1">
                      <span className="text-gray-600">{titleCase(type)}</span>
                      <span className="font-medium text-gray-900">{money(amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {financial.dividendsPaid > 0 && (
                <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                  <span className="text-gray-600">Dividends received</span>
                  <span className="font-medium text-gray-900">{money(financial.dividendsPaid)}</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Where {who} stand</h2>
            <ul className="space-y-3 text-sm">
              {participation.attendanceRate != null && participation.attendanceRate < 30 && (
                <li className="flex items-start gap-2 text-amber-800">
                  <TrendingDown className="w-4 h-4 mt-0.5 shrink-0" />
                  Attendance is low — {participation.attended} of {participation.invited}{" "}
                  activities.
                </li>
              )}
              {participation.invited === 0 && (
                <li className="flex items-start gap-2 text-gray-600">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {isOwn ? "You have" : `${member.full_name} has`} never been invited to an
                  activity. That is a record-keeping gap, not necessarily absence.
                </li>
              )}
              {financial.overdueLoans > 0 && (
                <li className="flex items-start gap-2 text-red-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {financial.overdueLoans} loan(s) overdue.
                </li>
              )}
              {cohort.savingsVsAverage != null && cohort.savingsVsAverage >= 25 && (
                <li className="flex items-start gap-2 text-[#2D6A4F]">
                  <TrendingUp className="w-4 h-4 mt-0.5 shrink-0" />
                  Savings are {cohort.savingsVsAverage}% above the cooperative average.
                </li>
              )}
              {!financial.lastContributionOn && (
                <li className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  No contribution has ever been recorded.
                </li>
              )}
              {warnings.length === 0 &&
                financial.overdueLoans === 0 &&
                (participation.attendanceRate ?? 100) >= 30 && (
                  <li className="flex items-start gap-2 text-[#2D6A4F]">
                    <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                    Nothing outstanding: no warnings, no overdue loans, attendance in order.
                  </li>
                )}
            </ul>
          </Card>
        </div>
      )}

      {tab === "money" && (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Contributions</h2>
            {profile.contributions.length === 0 ? (
              <EmptyRow>No contributions recorded.</EmptyRow>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2">Date</th>
                      <th className="py-2">Type</th>
                      <th className="py-2">Note</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {profile.contributions.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 text-gray-600">{formatDate(c.date)}</td>
                        <td className="py-2 text-gray-900">{titleCase(c.type)}</td>
                        <td className="py-2 text-gray-600">{c.notes ?? "—"}</td>
                        <td className="py-2 text-right font-medium text-gray-900">
                          {money(c.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Loans</h2>
            {profile.loans.length === 0 ? (
              <EmptyRow>No loans on record.</EmptyRow>
            ) : (
              <div className="space-y-4">
                {profile.loans.map((l) => (
                  <div key={l.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">{money(l.amount)}</p>
                        <p className="text-sm text-gray-600">{l.purpose}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Issued {formatDate(l.issued_at)} · due {formatDate(l.due_at)} ·{" "}
                          {l.interest_rate}% interest
                        </p>
                      </div>
                      <div className="text-right">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[l.status] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {titleCase(l.status)}
                        </span>
                        <p className="text-sm text-gray-900 mt-1">
                          Balance <span className="font-medium">{money(l.balance)}</span>
                        </p>
                        <p className="text-xs text-gray-500">Repaid {money(l.repaid)}</p>
                      </div>
                    </div>
                    {l.repayments.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm text-gray-700">
                          {l.repayments.length} repayment(s)
                        </summary>
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          {l.repayments.map((r) => (
                            <li key={r.id}>
                              {formatDate(r.date)} — {money(r.amount)}
                              {r.notes ? ` (${r.notes})` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {profile.dividends.length > 0 && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Dividends</h2>
              <div className="space-y-2">
                {profile.dividends.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">
                      {d.period} · paid {formatDate(d.paid_at)}
                    </span>
                    <span className="font-medium text-gray-900">{money(d.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "activities" && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Activities</h2>
            <p className="text-sm text-gray-600">
              {participation.attended} attended of {participation.invited} invited
              {participation.attendanceRate != null && ` · ${participation.attendanceRate}%`}
            </p>
          </div>
          {profile.activities.length === 0 ? (
            <EmptyRow>
              {who === "you" ? "You have" : `${member.full_name} has`} not been recorded against any
              activity.
            </EmptyRow>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Activity</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Attended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {profile.activities.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 text-gray-600 whitespace-nowrap">{formatDate(a.date)}</td>
                      <td className="py-2 text-gray-900">
                        {a.title}
                        {a.location && (
                          <span className="block text-xs text-gray-500">{a.location}</span>
                        )}
                      </td>
                      <td className="py-2 text-gray-600">{titleCase(a.type)}</td>
                      <td className="py-2 text-gray-600">{a.participant_role ?? "Participant"}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            a.attended ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {a.attended ? "Yes" : "No"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "transactions" && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="w-4 h-4 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">
              Transactions recorded against {isOwn ? "you" : "this member"}
            </h2>
          </div>
          {profile.transactions.length === 0 ? (
            <EmptyRow>
              No cooperative transaction names {isOwn ? "you" : "this member"}. Contributions are
              listed separately under Savings &amp; loans.
            </EmptyRow>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2">Date</th>
                    <th className="py-2">Description</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Recorded by</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {profile.transactions.map((t) => (
                    <tr key={t.id} className={t.status !== "completed" ? "opacity-60" : ""}>
                      <td className="py-2 text-gray-600 whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="py-2 text-gray-900">
                        {t.description}
                        {t.reference && (
                          <span className="block text-xs text-gray-500">{t.reference}</span>
                        )}
                      </td>
                      <td className="py-2 text-gray-600">{t.category}</td>
                      <td className="py-2 text-gray-600">
                        {t.payment_method ? titleCase(t.payment_method) : "—"}
                      </td>
                      <td className="py-2 text-gray-600">{t.recorded_by_name ?? "—"}</td>
                      <td
                        className={`py-2 text-right font-medium ${
                          t.type === "income" ? "text-[#2D6A4F]" : "text-red-600"
                        }`}
                      >
                        {t.type === "income" ? "+" : "−"} {money(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "history" && <MemberHistory memberId={id ?? "me"} />}

      {tab === "record" && (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Status changes and warnings</h2>
            {profile.statusLog.length === 0 ? (
              <EmptyRow>Nothing on record. No suspensions, no reinstatements.</EmptyRow>
            ) : (
              <div className="space-y-3">
                {profile.statusLog.map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-xl border p-4 ${
                      s.new_status === "suspended"
                        ? "border-red-200 bg-red-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {titleCase(s.old_status)} → {titleCase(s.new_status)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(s.changed_at)}
                        {s.changed_by_name && ` · ${s.changed_by_name}`}
                      </p>
                    </div>
                    {s.reason && <p className="text-sm text-gray-700 mt-1.5">{s.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {profile.exitRequests.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserMinus className="w-4 h-4 text-gray-700" />
                <h2 className="text-lg font-semibold text-gray-900">Requests to leave</h2>
              </div>
              <div className="space-y-3">
                {profile.exitRequests.map((r) => (
                  <div key={r.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {titleCase(r.reason_category)}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status] ?? "bg-amber-100 text-amber-800"}`}
                      >
                        {titleCase(r.status)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1.5">{r.reason_detail}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Filed {formatDate(r.created_at)}
                      {r.decided_at && ` · answered ${formatDate(r.decided_at)}`}
                    </p>
                    {r.decision_note && (
                      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        {r.decision_note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
