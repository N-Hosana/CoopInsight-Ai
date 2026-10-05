import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Card } from "./Card";
import { MemberHistory } from "./MemberHistory";
import { CreditCard, DollarSign, PiggyBank, Wallet } from "lucide-react";

/**
 * A member's own financial history.
 *
 * The Financials page shows a cooperative's books — every transaction, the
 * balance sheet, all members' loans and savings. None of that is a member's to
 * read. This is what is theirs: what they have paid in, what they have borrowed
 * and repaid, and the dividends they have received, from `/members/me/profile`.
 */

interface Profile {
  member: { full_name: string; cooperative_name: string | null };
  financial: {
    savings: number;
    totalContributions: number;
    contributionsByType: Record<string, number>;
    contributionCount: number;
    lastContributionOn: string | null;
    outstandingLoans?: number;
    loanCount: number;
    dividendsPaid: number;
  };
  contributions: Array<{ id: string; amount: string; type: string; date: string; notes: string | null }>;
  loans: Array<{
    id: string;
    amount: string;
    balance: string;
    purpose: string;
    interest_rate: string;
    status: string;
    due_at?: string;
    issued_at?: string;
    repaid?: string;
    repayments?: Array<{ amount: string; date: string }> | null;
  }>;
  dividends: Array<{ id: string; amount: string; period: string; paid_at: string | null }>;
}

const rwf = (v: unknown) => `${Math.round(Number(v ?? 0)).toLocaleString()} RWF`;
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString() : "—");
const TYPE_LABEL: Record<string, string> = {
  savings: "Savings",
  share_capital: "Share capital",
  special_levy: "Special levy",
};

export function MyFinances() {
  const [p, setP] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"payments" | "loans" | "dividends" | "history">("payments");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: Profile }>("/members/me/profile")
      .then((res) => setP(res.data))
      .catch((err: any) => setError(err?.message ?? "Could not load your financial record."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="py-8 text-gray-500">Loading your financial history…</p>;
  if (error || !p) return <Card className="p-8 text-center text-gray-600">{error || "No financial record found."}</Card>;

  const f = p.financial;
  const owed = p.loans
    .filter((l) => l.status !== "repaid")
    .reduce((a, l) => a + Number(l.balance), 0);

  const tiles = [
    { label: "Savings balance", value: rwf(f.savings), sub: f.lastContributionOn ? `last paid in ${day(f.lastContributionOn)}` : "nothing paid in yet", Icon: PiggyBank, tone: "bg-purple-50 text-purple-600" },
    { label: "Total paid in", value: rwf(f.totalContributions || p.contributions.reduce((a, c) => a + Number(c.amount), 0)), sub: `${f.contributionCount} payment(s)`, Icon: Wallet, tone: "bg-green-50 text-green-600" },
    { label: "Loan owed", value: owed ? rwf(owed) : "None", sub: `${f.loanCount} loan(s) in total`, Icon: CreditCard, tone: "bg-orange-50 text-orange-600" },
    { label: "Dividends received", value: rwf(f.dividendsPaid), sub: `${p.dividends.length} payment(s)`, Icon: DollarSign, tone: "bg-blue-50 text-blue-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My finances</h1>
        <p className="mt-1 text-gray-600">
          Your own money with {p.member.cooperative_name ?? "the cooperative"}: what you paid in, borrowed, repaid
          and received.
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <div className={`p-3 rounded-lg inline-block mb-3 ${t.tone}`}>
              <t.Icon className="w-6 h-6" />
            </div>
            <p className="text-sm text-gray-600 mb-1">{t.label}</p>
            <p className="text-2xl font-bold text-gray-900">{t.value}</p>
            <p className="text-xs text-gray-500 mt-1">{t.sub}</p>
          </div>
        ))}
      </div>

      {Object.keys(f.contributionsByType ?? {}).length > 0 && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-gray-900 mb-2">Paid in, by kind</p>
          <div className="flex flex-wrap gap-6 text-sm">
            {Object.entries(f.contributionsByType).map(([k, v]) => (
              <span key={k}>
                <span className="text-gray-500">{TYPE_LABEL[k] ?? k}:</span>{" "}
                <span className="font-semibold text-gray-900">{rwf(v)}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          ["payments", `Payments in (${p.contributions.length})`],
          ["loans", `Loans (${p.loans.length})`],
          ["dividends", `Dividends (${p.dividends.length})`],
          ["history", "Full history"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? "bg-[#2D6A4F] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "payments" && (
        <Card className="overflow-x-auto">
          {p.contributions.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No payments recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Kind</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Note</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {p.contributions.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5">{day(c.date)}</td>
                    <td className="px-4 py-2.5">{TYPE_LABEL[c.type] ?? c.type}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-green-700">{rwf(c.amount)}</td>
                    <td className="px-4 py-2.5 text-gray-500">{c.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "loans" && (
        <div className="space-y-3">
          {p.loans.length === 0 && <Card className="p-6 text-sm text-gray-500">You have never taken a loan.</Card>}
          {p.loans.map((l) => {
            const paid = Number(l.repaid ?? Number(l.amount) - Number(l.balance));
            const progress = Number(l.amount) ? Math.min(100, Math.round((paid / Number(l.amount)) * 100)) : 0;
            return (
              <Card key={l.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{l.purpose}</p>
                    <p className="text-xs text-gray-500">
                      {rwf(l.amount)} at {Number(l.interest_rate)}% · issued {day(l.issued_at)} · due {day(l.due_at)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${l.status === "repaid" ? "bg-green-100 text-green-800" : l.status === "overdue" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                    {l.status === "repaid" ? "Repaid" : l.status === "overdue" ? "Overdue" : `${rwf(l.balance)} owed`}
                  </span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-gray-200">
                  <div className="h-2 rounded-full bg-[#2D6A4F]" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-gray-500">{progress}% repaid</p>
                {(l.repayments ?? []).length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-gray-700">
                    {(l.repayments ?? []).map((r, i) => (
                      <li key={i} className="flex justify-between border-t border-gray-100 pt-1">
                        <span>Repaid on {day(r.date)}</span>
                        <span className="font-medium">{rwf(r.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === "dividends" && (
        <Card className="overflow-x-auto">
          {p.dividends.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No dividends have been paid to you yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-3">Period</th><th className="px-4 py-3">Paid on</th><th className="px-4 py-3 text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {p.dividends.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5">{d.period}</td>
                    <td className="px-4 py-2.5">{day(d.paid_at)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{rwf(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "history" && <MemberHistory memberId="me" />}
    </div>
  );
}
