import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import {
  UserMinus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Undo2,
  Inbox,
  ShieldQuestion,
  Calculator,
  Wallet,
} from "lucide-react";

interface ExitRequest {
  id: string;
  cooperative_id: string;
  cooperative_name: string;
  member_id: string | null;
  membership_number: string | null;
  member_savings: string | null;
  requested_by: string;
  requester_name: string;
  requester_email: string;
  reason_category: string;
  reason_detail: string;
  preferred_exit_date: string | null;
  savings_instruction: string;
  contact_phone: string | null;
  status: "pending" | "under_review" | "approved" | "rejected" | "withdrawn";
  response_due_at: string;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

interface MemberRecord {
  id: string;
  membership_number: string;
  total_savings: string;
  full_name: string;
}

const REASON_LABELS: Record<string, string> = {
  relocation: "I am relocating",
  financial_hardship: "Financial hardship",
  joining_another_cooperative: "Joining another cooperative",
  dissatisfied_with_management: "Dissatisfied with how the cooperative is run",
  health: "Health reasons",
  retirement: "Retirement",
  business_closed: "My business has closed",
  other: "Other reason",
};

const SAVINGS_LABELS: Record<string, string> = {
  refund_mobile_money: "Refund my savings by mobile money",
  refund_bank_transfer: "Refund my savings by bank transfer",
  refund_cash: "Refund my savings in cash at the office",
  donate_to_cooperative: "Leave my savings to the cooperative",
  no_savings_held: "I hold no savings with the cooperative",
};

const STATUS_STYLES: Record<string, { label: string; badge: string; Icon: typeof Clock }> = {
  pending: { label: "Awaiting response", badge: "bg-amber-100 text-amber-800", Icon: Clock },
  under_review: { label: "Under review", badge: "bg-blue-100 text-blue-800", Icon: ShieldQuestion },
  approved: { label: "Approved", badge: "bg-green-100 text-green-800", Icon: CheckCircle2 },
  rejected: { label: "Not approved", badge: "bg-red-100 text-red-700", Icon: XCircle },
  withdrawn: { label: "Withdrawn by you", badge: "bg-gray-100 text-gray-700", Icon: Undo2 },
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Whole days from now until the deadline; negative once it has passed. */
const daysUntil = (value: string) =>
  Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);

const money = (v: number | string | null | undefined) =>
  v == null ? "—" : `RWF ${Number(v).toLocaleString()}`;

interface Settlement {
  member: { id: string; fullName: string; membershipNumber: string; membershipDate: string };
  cooperative: { id: string; name: string; memberCount: number; totalMemberSavings: number; shareCapital: number };
  ownFunds: { savings: number; shareCapital: number; specialLevies: number; total: number };
  shareOfCooperative: {
    distributableNetWorth: number;
    sharePercentage: number;
    amount: number;
    basis: string;
    estimated: boolean;
  };
  deductions: { outstandingLoans: number; total: number };
  grossEntitlement: number;
  netPayable: number;
  balanceOwedToCooperative: number;
  warnings: string[];
  disclaimer: string;
  calculatedAt: string;
}

/**
 * "What do I walk away with?" — own funds, plus a share of what the cooperative
 * itself is worth, less anything still owed.
 */
function SettlementCalculator() {
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  const calculate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: Settlement }>("/membership/settlement");
      setSettlement(res.data);
      setShown(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not calculate your settlement.");
      setShown(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-gray-700" />
            <h3 className="text-lg font-semibold text-gray-900">What you would leave with</h3>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Your savings and share capital, plus your share of what the cooperative is worth, less anything you still owe.
          </p>
        </div>
        <Button variant="outline" onClick={calculate} disabled={loading}>
          {loading ? "Calculating…" : shown ? "Recalculate" : "Calculate my settlement"}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {settlement && (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl bg-[#2D6A4F] px-5 py-4 text-white">
            <p className="text-xs uppercase tracking-wide opacity-80">Estimated net payable to you</p>
            <p className="text-3xl font-semibold mt-1">{money(settlement.netPayable)}</p>
            {settlement.balanceOwedToCooperative > 0 && (
              <p className="text-sm mt-2 text-red-100">
                You would still owe {money(settlement.balanceOwedToCooperative)} to the cooperative.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-2.5 text-gray-600">Your savings balance</td>
                  <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.savings)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">Share capital you paid in</td>
                  <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.shareCapital)}</td>
                </tr>
                {settlement.ownFunds.specialLevies > 0 && (
                  <tr>
                    <td className="py-2.5 text-gray-600">Special levies paid</td>
                    <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.specialLevies)}</td>
                  </tr>
                )}
                <tr className="bg-gray-50">
                  <td className="py-2.5 pl-2 font-medium text-gray-900">Your own funds</td>
                  <td className="py-2.5 pr-2 text-right font-semibold text-gray-900">{money(settlement.ownFunds.total)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">
                    Your share of the cooperative's value
                    <span className="block text-xs text-gray-500">
                      {settlement.shareOfCooperative.sharePercentage}% of {money(settlement.shareOfCooperative.distributableNetWorth)} distributable
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-medium text-gray-900">
                    {money(settlement.shareOfCooperative.amount)}
                  </td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="py-2.5 pl-2 font-medium text-gray-900">Gross entitlement</td>
                  <td className="py-2.5 pr-2 text-right font-semibold text-gray-900">{money(settlement.grossEntitlement)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">Less outstanding loans</td>
                  <td className="py-2.5 text-right font-medium text-red-600">
                    {settlement.deductions.outstandingLoans > 0 ? `− ${money(settlement.deductions.outstandingLoans)}` : "—"}
                  </td>
                </tr>
                <tr className="border-t-2 border-gray-300">
                  <td className="py-3 font-semibold text-gray-900">Net payable</td>
                  <td className="py-3 text-right text-lg font-semibold text-[#2D6A4F]">{money(settlement.netPayable)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-gray-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <Wallet className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">How the cooperative's value was measured: </span>
                {settlement.shareOfCooperative.basis}
              </p>
            </div>
          </div>

          {settlement.warnings.length > 0 && (
            <ul className="space-y-2">
              {settlement.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-gray-500 border-t border-gray-200 pt-3">{settlement.disclaimer}</p>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const { Icon } = style;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
      <Icon className="w-3.5 h-3.5" />
      {style.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Member view — file a request, then track it
// ─────────────────────────────────────────────────────────────────────────────

function MemberView({ responseWindowDays }: { responseWindowDays: number }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [memberRecord, setMemberRecord] = useState<MemberRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [form, setForm] = useState({
    reasonCategory: "",
    reasonDetail: "",
    preferredExitDate: "",
    savingsInstruction: "refund_mobile_money",
    contactPhone: user?.phone ?? "",
    acknowledgedTerms: false,
  });

  const fetchRequests = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.get<{ data: ExitRequest[]; memberRecord: MemberRecord | null }>(
        "/membership/exit-requests/mine"
      );
      setRequests(data.data ?? []);
      setMemberRecord(data.memberRecord ?? null);
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load your membership requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const openRequest = useMemo(
    () => requests.find((r) => r.status === "pending" || r.status === "under_review") ?? null,
    [requests]
  );
  const history = useMemo(() => requests.filter((r) => r.id !== openRequest?.id), [requests, openRequest]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!form.reasonCategory) return setFormError("Choose the reason that best describes your situation.");
    if (form.reasonDetail.trim().length < 20)
      return setFormError("Please explain your reason in at least 20 characters.");
    if (!form.acknowledgedTerms)
      return setFormError("Please confirm you understand what happens when you leave the cooperative.");

    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>("/membership/exit-requests", {
        reasonCategory: form.reasonCategory,
        reasonDetail: form.reasonDetail.trim(),
        preferredExitDate: form.preferredExitDate || undefined,
        savingsInstruction: form.savingsInstruction,
        contactPhone: form.contactPhone || undefined,
        acknowledgedTerms: form.acknowledgedTerms,
      });
      setSuccessMessage(res.message);
      setShowForm(false);
      setForm({
        reasonCategory: "",
        reasonDetail: "",
        preferredExitDate: "",
        savingsInstruction: "refund_mobile_money",
        contactPhone: user?.phone ?? "",
        acknowledgedTerms: false,
      });
      await fetchRequests();
    } catch (err: any) {
      setFormError(err?.message ?? "Could not submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    setLoadError("");
    try {
      await api.patch(`/membership/exit-requests/${id}/withdraw`, {});
      setSuccessMessage("Your request has been withdrawn. You remain a member.");
      await fetchRequests();
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not withdraw the request.");
    }
  };

  if (loading) {
    return <p className="text-gray-500">Loading your membership status…</p>;
  }

  if (!user?.cooperativeId) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <p className="font-medium text-gray-900">You are not currently linked to a cooperative</p>
            <p className="text-sm text-gray-600 mt-1">
              There is no membership to withdraw from. If this looks wrong, contact your cooperative manager.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {successMessage}
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
      )}

      {/* Membership summary */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Your cooperative</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{user.cooperativeName}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-gray-600">
              {memberRecord?.membership_number && (
                <span>
                  Membership no. <span className="font-medium text-gray-900">{memberRecord.membership_number}</span>
                </span>
              )}
              {memberRecord?.total_savings != null && (
                <span>
                  Savings held{" "}
                  <span className="font-medium text-gray-900">
                    RWF {Number(memberRecord.total_savings).toLocaleString()}
                  </span>
                </span>
              )}
            </div>
          </div>

          {!openRequest && !showForm && (
            <Button variant="danger" onClick={() => { setShowForm(true); setSuccessMessage(""); }}>
              <span className="flex items-center gap-2">
                <UserMinus className="w-4 h-4" />
                Request removal from cooperative
              </span>
            </Button>
          )}
        </div>

        {!memberRecord && (
          <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
            We could not match your account to an entry in the member register. You can still file a request — the
            manager will match it manually.
          </p>
        )}
      </Card>

      {/* What you would walk away with */}
      <SettlementCalculator />

      {/* Open request tracker */}
      {openRequest && (
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Your removal request</h3>
              <p className="text-sm text-gray-500 mt-0.5">Submitted {formatDate(openRequest.created_at)}</p>
            </div>
            <StatusBadge status={openRequest.status} />
          </div>

          {(() => {
            const remaining = daysUntil(openRequest.response_due_at);
            const overdue = remaining < 0;
            return (
              <div
                className={`mt-5 rounded-xl border px-4 py-3 ${
                  overdue ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className={`w-4 h-4 ${overdue ? "text-red-600" : "text-blue-600"}`} />
                  <p className={`text-sm font-medium ${overdue ? "text-red-800" : "text-blue-900"}`}>
                    {overdue
                      ? `Response overdue by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"}`
                      : `Response due in ${remaining} day${remaining === 1 ? "" : "s"}`}
                  </p>
                </div>
                <p className={`text-xs mt-1 ${overdue ? "text-red-700" : "text-blue-800"}`}>
                  {user.cooperativeName} committed to respond by {formatDate(openRequest.response_due_at)}.
                  {overdue && " You may escalate this to your sector cooperative officer."}
                </p>
              </div>
            );
          })()}

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-gray-500">Reason</dt>
              <dd className="font-medium text-gray-900">
                {REASON_LABELS[openRequest.reason_category] ?? openRequest.reason_category}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Preferred exit date</dt>
              <dd className="font-medium text-gray-900">{formatDate(openRequest.preferred_exit_date)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">What you told the cooperative</dt>
              <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{openRequest.reason_detail}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Savings instruction</dt>
              <dd className="font-medium text-gray-900">
                {SAVINGS_LABELS[openRequest.savings_instruction] ?? openRequest.savings_instruction}
              </dd>
            </div>
          </dl>

          <div className="mt-6 border-t border-gray-200 pt-4">
            <Button variant="outline" onClick={() => handleWithdraw(openRequest.id)}>
              <span className="flex items-center gap-2">
                <Undo2 className="w-4 h-4" />
                Withdraw this request
              </span>
            </Button>
          </div>
        </Card>
      )}

      {/* The form */}
      {showForm && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900">Request removal from {user.cooperativeName}</h3>
          <p className="text-sm text-gray-600 mt-1">
            Tell the cooperative why you want to leave. They have {responseWindowDays} days to respond, and you will be
            notified of the outcome here and in your notifications.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Select
              label="Reason for leaving *"
              value={form.reasonCategory}
              onChange={(e) => setForm({ ...form, reasonCategory: e.target.value })}
              options={[
                { value: "", label: "Select a reason…" },
                ...Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Explain in your own words *
              </label>
              <textarea
                rows={5}
                value={form.reasonDetail}
                onChange={(e) => setForm({ ...form, reasonDetail: e.target.value })}
                placeholder="Describe your situation so the cooperative leadership can consider your request properly."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {form.reasonDetail.trim().length}/20 characters minimum
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Preferred exit date"
                type="date"
                value={form.preferredExitDate}
                onChange={(e) => setForm({ ...form, preferredExitDate: e.target.value })}
              />
              <Input
                label="Phone to reach you on"
                type="tel"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="+250 7xx xxx xxx"
              />
            </div>

            <Select
              label="What should happen to your savings?"
              value={form.savingsInstruction}
              onChange={(e) => setForm({ ...form, savingsInstruction: e.target.value })}
              options={Object.entries(SAVINGS_LABELS).map(([value, label]) => ({ value, label }))}
            />

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.acknowledgedTerms}
                onChange={(e) => setForm({ ...form, acknowledgedTerms: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#2D6A4F] focus:ring-[#2D6A4F]"
              />
              <span className="text-sm text-gray-700">
                I understand that if this request is approved I will be removed from the member register, lose access to
                cooperative activities and services, and any outstanding obligations must be settled before my savings
                are released. *
              </span>
            </label>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="submit" variant="danger" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setFormError(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Past requests */}
      {history.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Previous requests</h3>
          <div className="space-y-4">
            {history.map((r) => (
              <div key={r.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {REASON_LABELS[r.reason_category] ?? r.reason_category}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Submitted {formatDate(r.created_at)}
                      {r.decided_at && ` · Answered ${formatDate(r.decided_at)}`}
                      {r.decided_by_name && ` by ${r.decided_by_name}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.decision_note && (
                  <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{r.decision_note}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer view — the manager/admin queue
// ─────────────────────────────────────────────────────────────────────────────

function ReviewerView() {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ data: ExitRequest[] }>("/membership/exit-requests");
      setRequests(data.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load removal requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const decide = async (id: string, decision: "under_review" | "approved" | "rejected") => {
    setError("");
    setMessage("");
    if (decision === "rejected" && !notes[id]?.trim()) {
      setError("Add a note explaining the decision before rejecting a request.");
      return;
    }
    setBusyId(id);
    try {
      const res = await api.patch<{ message: string }>(`/membership/exit-requests/${id}/decision`, {
        decision,
        note: notes[id]?.trim() || undefined,
      });
      setMessage(res.message);
      setNotes({ ...notes, [id]: "" });
      await fetchRequests();
    } catch (err: any) {
      setError(err?.message ?? "Could not record the decision.");
    } finally {
      setBusyId(null);
    }
  };

  const open = requests.filter((r) => r.status === "pending" || r.status === "under_review");
  const closed = requests.filter((r) => r.status !== "pending" && r.status !== "under_review");

  if (loading) return <p className="text-gray-500">Loading removal requests…</p>;

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {open.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No requests awaiting a response</p>
          <p className="text-sm text-gray-500 mt-1">Members who ask to leave will appear here.</p>
        </Card>
      ) : (
        open.map((r) => {
          const remaining = daysUntil(r.response_due_at);
          const overdue = remaining < 0;
          return (
            <Card key={r.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{r.requester_name}</p>
                  <p className="text-sm text-gray-500">
                    {r.cooperative_name}
                    {r.membership_number && ` · ${r.membership_number}`}
                    {` · submitted ${formatDate(r.created_at)}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={r.status} />
                  <span className={`text-xs font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                    {overdue
                      ? `Overdue by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"}`
                      : `Due in ${remaining} day${remaining === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>

              <dl className="mt-5 grid gap-4 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-gray-500">Reason</dt>
                  <dd className="font-medium text-gray-900">
                    {REASON_LABELS[r.reason_category] ?? r.reason_category}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Preferred exit date</dt>
                  <dd className="font-medium text-gray-900">{formatDate(r.preferred_exit_date)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Savings held</dt>
                  <dd className="font-medium text-gray-900">
                    {r.member_savings != null ? `RWF ${Number(r.member_savings).toLocaleString()}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Savings instruction</dt>
                  <dd className="font-medium text-gray-900">
                    {SAVINGS_LABELS[r.savings_instruction] ?? r.savings_instruction}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">Member's explanation</dt>
                  <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{r.reason_detail}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">Contact</dt>
                  <dd className="text-gray-900">
                    {r.contact_phone ?? "—"} · {r.requester_email}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note to the member {r.status === "pending" ? "(required to reject)" : ""}
                </label>
                <textarea
                  rows={2}
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  placeholder="Explain the decision, or what the member must do next."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
                />
                <div className="flex flex-wrap gap-3 mt-3">
                  {r.status === "pending" && (
                    <Button variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, "under_review")}>
                      Mark under review
                    </Button>
                  )}
                  <Button variant="primary" disabled={busyId === r.id} onClick={() => decide(r.id, "approved")}>
                    Approve removal
                  </Button>
                  <Button variant="danger" disabled={busyId === r.id} onClick={() => decide(r.id, "rejected")}>
                    Reject
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Approving removes the member from the register and unlinks their login from the cooperative.
                </p>
              </div>
            </Card>
          );
        })
      )}

      {closed.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Answered requests</h3>
          <div className="space-y-3">
            {closed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
                <div>
                  <p className="font-medium text-gray-900">{r.requester_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.cooperative_name} · {REASON_LABELS[r.reason_category] ?? r.reason_category}
                    {r.decided_at && ` · answered ${formatDate(r.decided_at)}`}
                    {r.decided_by_name && ` by ${r.decided_by_name}`}
                  </p>
                  {r.decision_note && <p className="text-sm text-gray-700 mt-2">{r.decision_note}</p>}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Membership() {
  const { user } = useAuth();
  const isReviewer = ["manager", "admin", "generalManager", "cooperative"].includes(user?.role ?? "");
  const [responseWindowDays, setResponseWindowDays] = useState(14);

  useEffect(() => {
    api
      .get<{ data: { responseWindowDays: number } }>("/membership/policy")
      .then((res) => setResponseWindowDays(res.data.responseWindowDays))
      .catch(() => {
        /* fall back to the default window */
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Membership</h1>
        <p className="text-gray-600 mt-1">
          {isReviewer
            ? `Removal requests filed by your members. Each one must be answered within ${responseWindowDays} days.`
            : `Manage your membership, or ask to be removed from your cooperative. Requests are answered within ${responseWindowDays} days.`}
        </p>
      </div>

      {isReviewer ? <ReviewerView /> : <MemberView responseWindowDays={responseWindowDays} />}
    </div>
  );
}
