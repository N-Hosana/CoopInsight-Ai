import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Plus, ArrowLeft, Save, X } from "lucide-react";
import { useDataEntryCooperative } from "../components/DataEntryCooperative";
import { fetchAllMembers, RegisterMember } from "../services/members";
import { api } from "../services/api";

/**
 * Recording the cooperative's money movements, several at a time.
 *
 * Six kinds, each sent to the endpoint that owns it:
 *
 *   Income / Expense   POST  /transactions
 *   Savings            POST  /members/:id/contributions
 *   Loan               POST  /members/:id/loans
 *   Loan repayment     PATCH /members/:id/loans/:loanId/repayment
 *   Dividend           POST  /members/:id/dividends
 *
 * The four member kinds also post the matching cash entry in the cooperative's
 * books on the server, in the same database transaction, so the Financials
 * page, the member's file and the monthly audit all see the same money.
 */

type Kind = "income" | "expense" | "savings" | "loan" | "repayment" | "dividend";

const KINDS: Array<{ id: Kind; label: string; tone: string; flow: "in" | "out" }> = [
  { id: "income", label: "Income", tone: "bg-green-600", flow: "in" },
  { id: "expense", label: "Expense", tone: "bg-red-600", flow: "out" },
  { id: "savings", label: "Savings", tone: "bg-blue-600", flow: "in" },
  { id: "loan", label: "Loan", tone: "bg-purple-600", flow: "out" },
  { id: "repayment", label: "Loan repayment", tone: "bg-indigo-600", flow: "in" },
  { id: "dividend", label: "Dividend", tone: "bg-orange-600", flow: "out" },
];
const MEMBER_KINDS: Kind[] = ["savings", "loan", "repayment", "dividend"];

const CATEGORIES: Record<"income" | "expense", Array<{ id: string; label: string }>> = {
  income: [
    { id: "product_sales", label: "Product sales" },
    { id: "service_fees", label: "Service fees" },
    { id: "member_contributions", label: "Member contributions (lump sum)" },
    { id: "grants", label: "Grants" },
    { id: "donations", label: "Donations" },
  ],
  expense: [
    { id: "operational_costs", label: "Operational costs" },
    { id: "salaries", label: "Salaries" },
    { id: "equipment", label: "Equipment" },
    { id: "utilities", label: "Utilities" },
    { id: "training", label: "Training" },
  ],
};

const SAVINGS_TYPES = [
  { id: "savings", label: "Savings deposit" },
  { id: "share_capital", label: "Share capital" },
  { id: "special_levy", label: "Special levy" },
];

const PAYMENT_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "mobile_money", label: "Mobile money" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "cheque", label: "Cheque" },
];

interface Loan {
  id: string;
  amount: string;
  balance: string;
  purpose: string;
  status: string;
  due_at: string;
}

interface Draft {
  kind: Kind;
  amount: string;
  date: string;
  paymentMethod: string;
  reference: string;
  // income / expense
  category: string;
  description: string;
  // member kinds
  memberId: string;
  memberName: string;
  savingsType: string;
  purpose: string;
  dueDate: string;
  interestRate: string;
  loanId: string;
  loanLabel: string;
  period: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (kind: Kind = "income"): Draft => ({
  kind,
  amount: "",
  date: today(),
  paymentMethod: "cash",
  reference: "",
  category: kind === "expense" ? CATEGORIES.expense[0].id : CATEGORIES.income[0].id,
  description: "",
  memberId: "",
  memberName: "",
  savingsType: "savings",
  purpose: "",
  dueDate: "",
  interestRate: "",
  loanId: "",
  loanLabel: "",
  period: String(new Date().getFullYear() - 1),
});

const kindOf = (k: Kind) => KINDS.find((x) => x.id === k)!;
const rwf = (n: number) => `RWF ${n.toLocaleString("en-RW")}`;

/** What one draft says, in a line. */
function summarise(d: Draft): string {
  switch (d.kind) {
    case "income":
    case "expense":
      return `${CATEGORIES[d.kind].find((c) => c.id === d.category)?.label} — ${d.description}`;
    case "savings":
      return `${SAVINGS_TYPES.find((t) => t.id === d.savingsType)?.label} from ${d.memberName}`;
    case "loan":
      return `Loan to ${d.memberName} for ${d.purpose}, due ${d.dueDate}${d.interestRate ? ` at ${d.interestRate}%` : ""}`;
    case "repayment":
      return `Repayment from ${d.memberName} on ${d.loanLabel}`;
    case "dividend":
      return `Dividend for ${d.period} to ${d.memberName}`;
  }
}

/** The call that records one draft. */
function send(d: Draft, cooperativeId: string | null) {
  const amount = Number(d.amount);
  const common = { paymentMethod: d.paymentMethod, reference: d.reference.trim() || undefined };
  switch (d.kind) {
    case "income":
    case "expense":
      return api.post("/transactions", {
        cooperativeId, type: d.kind, category: d.category, amount, date: d.date,
        description: d.description.trim(), ...common,
      });
    case "savings":
      return api.post(`/members/${d.memberId}/contributions`, {
        amount, type: d.savingsType, date: d.date, notes: d.description.trim() || undefined, ...common,
      });
    case "loan":
      return api.post(`/members/${d.memberId}/loans`, {
        amount, purpose: d.purpose.trim(), due_at: d.dueDate, issued_on: d.date,
        interest_rate: d.interestRate ? Number(d.interestRate) : 0, ...common,
      });
    case "repayment":
      return api.patch(`/members/${d.memberId}/loans/${d.loanId}/repayment`, {
        amount, date: d.date, notes: d.description.trim() || undefined, ...common,
      });
    case "dividend":
      return api.post(`/members/${d.memberId}/dividends`, {
        amount, period: d.period.trim(), paid_at: d.date, ...common,
      });
  }
}

export function RecordTransaction() {
  const navigate = useNavigate();
  const target = useDataEntryCooperative();
  const [batch, setBatch] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [members, setMembers] = useState<RegisterMember[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const memberKind = MEMBER_KINDS.includes(draft.kind);

  // The register, for the member kinds.
  useEffect(() => {
    setMembers([]);
    setBatch([]);
    if (!target.cooperativeId) return;
    fetchAllMembers(target.picks ? target.cooperativeId : null)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [target.cooperativeId, target.picks]);

  // A repayment is against one of the member's open loans.
  useEffect(() => {
    setLoans([]);
    if (draft.kind !== "repayment" || !draft.memberId) return;
    api
      .get<{ data: Loan[] }>(`/members/${draft.memberId}/loans`)
      .then((res) => setLoans((res.data ?? []).filter((l) => l.status !== "repaid")))
      .catch(() => setLoans([]));
  }, [draft.kind, draft.memberId]);

  const eligibleMembers = useMemo(
    () => members.filter((m) => (draft.kind === "loan" ? m.status === "active" : true)),
    [members, draft.kind]
  );

  if (!target.allowed) {
    return (
      <div className="max-w-4xl mx-auto py-10">
        <Card className="p-6 text-center">
          <p className="text-gray-600">Transactions are recorded by the cooperative's manager or an administrator.</p>
          <Button onClick={() => navigate("/")} className="mt-4">Go to Dashboard</Button>
        </Card>
      </div>
    );
  }

  const selectedLoan = loans.find((l) => l.id === draft.loanId);
  const problems: string[] = [];
  if (!(Number(draft.amount) > 0)) problems.push("an amount");
  if (!draft.date || draft.date > today()) problems.push("a date that is not in the future");
  if (!memberKind && !draft.description.trim()) problems.push("a description");
  if (memberKind && !draft.memberId) problems.push("a member");
  if (draft.kind === "loan") {
    if (!draft.purpose.trim()) problems.push("the loan's purpose");
    if (!draft.dueDate || draft.dueDate <= draft.date) problems.push("a due date after the loan date");
  }
  if (draft.kind === "repayment") {
    if (!draft.loanId) problems.push("the loan being repaid");
    else if (selectedLoan && Number(draft.amount) > Number(selectedLoan.balance)) problems.push("an amount no more than the balance owed");
  }
  if (draft.kind === "dividend" && !draft.period.trim()) problems.push("the period the dividend is for");

  const addToBatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBatch([...batch, draft]);
    setDraft({ ...emptyDraft(draft.kind), date: draft.date, paymentMethod: draft.paymentMethod });
    setSuccessMessage(null);
  };

  const submitAll = async () => {
    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    let saved = 0;
    try {
      for (const d of batch) {
        await send(d, target.cooperativeId);
        saved += 1;
      }
      setSuccessMessage(`${saved} record(s) saved to ${target.cooperativeName ?? "the cooperative"}'s books.`);
      setBatch([]);
      setLoans([]);
    } catch (err: any) {
      // Keep what was not saved so it can be corrected and resent.
      setBatch(batch.slice(saved));
      setErrorMessage(
        `${saved} saved. "${summarise(batch[saved])}" was refused: ${err?.message ?? "unknown error"}. ` +
          "It and the ones after it are still in the batch."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const moneyIn = batch.filter((d) => kindOf(d.kind).flow === "in").reduce((a, d) => a + Number(d.amount), 0);
  const moneyOut = batch.filter((d) => kindOf(d.kind).flow === "out").reduce((a, d) => a + Number(d.amount), 0);

  const field = "w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2D6A4F] bg-white";
  const label = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-8">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(target.picks ? `/records${target.query}` : "/financials")} className="flex items-center gap-2 text-[#2D6A4F] hover:text-[#1B5E20]">
          <ArrowLeft className="w-4 h-4" />
          {target.picks ? "Back to Records" : "Back to Financials"}
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Record transactions</h1>
      </div>

      {target.picker}

      {successMessage && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-800 text-sm font-medium">{successMessage}</div>
      )}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm font-medium">{errorMessage}</div>
      )}

      {!target.cooperativeId ? (
        <Card className="p-8 text-center text-gray-600">Choose a cooperative above to record its transactions.</Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Add a record</h2>
              <form onSubmit={addToBatch} className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setDraft({ ...emptyDraft(k.id), date: draft.date, paymentMethod: draft.paymentMethod })}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                        draft.kind === k.id ? `${k.tone} text-white` : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                {memberKind && (
                  <div>
                    <label className={label}>Member *</label>
                    <select
                      value={draft.memberId}
                      onChange={(e) => {
                        const m = members.find((x) => x.id === e.target.value);
                        setDraft({ ...draft, memberId: e.target.value, memberName: m?.full_name ?? "", loanId: "", loanLabel: "" });
                      }}
                      className={field}
                    >
                      <option value="">Choose a member…</option>
                      {eligibleMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}{m.membership_number ? ` (${m.membership_number})` : ""}{m.status !== "active" ? ` — ${m.status}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(draft.kind === "income" || draft.kind === "expense") && (
                  <div>
                    <label className={label}>Category *</label>
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={field}>
                      {CATEGORIES[draft.kind].map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Loans, repayments, dividends and member savings have their own kinds above, so they are
                      also recorded against the member.
                    </p>
                  </div>
                )}

                {draft.kind === "savings" && (
                  <div>
                    <label className={label}>Type *</label>
                    <select value={draft.savingsType} onChange={(e) => setDraft({ ...draft, savingsType: e.target.value })} className={field}>
                      {SAVINGS_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                )}

                {draft.kind === "loan" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-3">
                      <label className={label}>Purpose *</label>
                      <input value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder="e.g. Seeds for the season" className={field} />
                    </div>
                    <div>
                      <label className={label}>Due date *</label>
                      <input type="date" value={draft.dueDate} min={draft.date} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} className={field} />
                    </div>
                    <div>
                      <label className={label}>Interest rate (%)</label>
                      <input type="number" min={0} max={100} step="0.1" value={draft.interestRate} onChange={(e) => setDraft({ ...draft, interestRate: e.target.value })} placeholder="0" className={field} />
                    </div>
                  </div>
                )}

                {draft.kind === "repayment" && draft.memberId && (
                  <div>
                    <label className={label}>Loan being repaid *</label>
                    {loans.length === 0 ? (
                      <p className="text-sm text-gray-500">{draft.memberName} has no open loan.</p>
                    ) : (
                      <select
                        value={draft.loanId}
                        onChange={(e) => {
                          const l = loans.find((x) => x.id === e.target.value);
                          setDraft({
                            ...draft,
                            loanId: e.target.value,
                            loanLabel: l ? `${l.purpose} (${rwf(Number(l.balance))} owed)` : "",
                          });
                        }}
                        className={field}
                      >
                        <option value="">Choose the loan…</option>
                        {loans.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.purpose} — {rwf(Number(l.balance))} of {rwf(Number(l.amount))} owed, due {new Date(l.due_at).toLocaleDateString()}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {draft.kind === "dividend" && (
                  <div>
                    <label className={label}>For the period *</label>
                    <input value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })} placeholder="e.g. 2025" className={field} />
                    <p className="mt-1 text-xs text-gray-500">One dividend per member per period.</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={label}>Amount (RWF) *</label>
                    <input type="number" min={1} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="0" className={field} />
                  </div>
                  <div>
                    <label className={label}>{draft.kind === "loan" ? "Date paid out *" : "Date *"}</label>
                    <input type="date" value={draft.date} max={today()} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={field} />
                  </div>
                </div>

                <div>
                  <label className={label}>{memberKind ? "Notes" : "Description *"}</label>
                  <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder={draft.kind === "expense" ? "e.g. Transport to market" : draft.kind === "income" ? "e.g. Sale of 40 bags of maize" : "Optional"}
                    className={field} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={label}>{kindOf(draft.kind).flow === "in" ? "Received by" : "Paid by"}</label>
                    <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })} className={field}>
                      {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Receipt / reference</label>
                    <input type="text" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="Optional" className={field} />
                  </div>
                </div>

                {problems.length > 0 && <p className="text-xs text-gray-500">Still needed: {problems.join(", ")}.</p>}
                <Button type="submit" className="w-full" disabled={problems.length > 0}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add to batch
                </Button>
              </form>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Batch ({batch.length})</h2>
              {batch.length === 0 ? (
                <p className="text-sm text-gray-600">Nothing added yet. Add each record above, then submit them together.</p>
              ) : (
                <div className="space-y-2">
                  {batch.map((d, idx) => {
                    const k = kindOf(d.kind);
                    return (
                      <div key={idx} className="flex items-start justify-between rounded-lg border border-gray-200 p-3">
                        <div>
                          <p className="text-xs text-gray-600">
                            <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white ${k.tone}`}>{k.label}</span>
                            {d.date} · {PAYMENT_METHODS.find((m) => m.id === d.paymentMethod)?.label}
                            {d.reference && ` · Ref ${d.reference}`}
                          </p>
                          <p className="mt-1 font-medium text-gray-900">{summarise(d)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold ${k.flow === "in" ? "text-green-800" : "text-red-800"}`}>
                            {k.flow === "in" ? "+" : "−"} {rwf(Number(d.amount))}
                          </p>
                          <button type="button" onClick={() => setBatch(batch.filter((_, i) => i !== idx))} className="p-1 text-gray-500 hover:text-red-700" aria-label="Remove">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-6 bg-blue-50 border-blue-200">
              <h3 className="font-semibold text-gray-900 mb-4">Batch summary</h3>
              <div className="space-y-3 text-sm">
                <p className="flex justify-between"><span className="text-gray-600">Money in</span><span className="font-semibold text-green-800">{rwf(moneyIn)}</span></p>
                <p className="flex justify-between"><span className="text-gray-600">Money out</span><span className="font-semibold text-red-800">{rwf(moneyOut)}</span></p>
                <p className="flex justify-between border-t border-blue-200 pt-3"><span className="text-gray-600">Net</span><span className="font-bold text-gray-900">{rwf(moneyIn - moneyOut)}</span></p>
                <div className="border-t border-blue-200 pt-3 space-y-1">
                  {KINDS.map((k) => {
                    const n = batch.filter((d) => d.kind === k.id).length;
                    return n ? <p key={k.id} className="text-gray-700">{k.label}: {n}</p> : null;
                  })}
                </div>
              </div>
            </Card>

            {batch.length > 0 && (
              <Button onClick={submitAll} disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed">
                <Save className="w-4 h-4 mr-2" />
                {isSubmitting ? "Saving..." : `Submit ${batch.length} record(s)`}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
