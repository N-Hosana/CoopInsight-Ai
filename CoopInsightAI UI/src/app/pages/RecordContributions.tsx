import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useDataEntryCooperative } from "../components/DataEntryCooperative";
import { api } from "../services/api";
import { fetchAllMembers, RegisterMember } from "../services/members";
import { ArrowLeft, HandCoins } from "lucide-react";

/**
 * A collection day: what each member paid in, entered as one sheet.
 *
 * Contributions are what the audit reads to tell whether members are still
 * putting money in. There was an endpoint for them but no screen, so the only
 * contributions on the system were the seeded ones.
 */

const TYPES = [
  { id: "savings", label: "Savings" },
  { id: "share_capital", label: "Share capital" },
  { id: "special_levy", label: "Special levy" },
];

export function RecordContributions() {
  const target = useDataEntryCooperative();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const [members, setMembers] = useState<RegisterMember[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [type, setType] = useState("savings");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [fill, setFill] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMembers([]);
    setAmounts({});
    if (!target.cooperativeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAllMembers(target.picks ? target.cooperativeId : null)
      .then((list) => setMembers(list.filter((m) => m.status === "active")))
      .catch((err: any) => setError(err?.message ?? "Could not load the member register."))
      .finally(() => setLoading(false));
  }, [target.cooperativeId, target.picks]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return members.filter(
      (m) => !q || m.full_name.toLowerCase().includes(q) || (m.membership_number ?? "").toLowerCase().includes(q)
    );
  }, [members, filter]);

  const entries = Object.entries(amounts)
    .map(([memberId, v]) => ({ memberId, amount: Number(v) }))
    .filter((e) => Number.isFinite(e.amount) && e.amount > 0);
  const total = entries.reduce((a, e) => a + e.amount, 0);
  const invalid = Object.values(amounts).some((v) => v !== "" && !(Number(v) > 0));

  const submit = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string }>("/members/contributions/batch", {
        cooperativeId: target.cooperativeId,
        date,
        type,
        paymentMethod,
        notes: notes.trim() || undefined,
        entries,
      });
      setMessage(res.message);
      setAmounts({});
      setNotes("");
    } catch (err: any) {
      setError(err?.message ?? "Could not record the contributions. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!target.allowed) {
    return (
      <Card className="p-8 text-center text-gray-600">
        Contributions are recorded by the cooperative's manager or an administrator.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(`/records${target.query}`)} className="flex items-center gap-2 text-sm text-[#2D6A4F] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Records
      </button>
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <HandCoins className="h-6 w-6 text-[#2D6A4F]" />
          Record contributions
        </h1>
        <p className="mt-1 max-w-3xl text-gray-600">
          Enter what each member paid on one collection day. Leave a member blank if they did not
          pay. Every amount is saved together, or none is, and the total is entered in the
          cooperative's books as one receipt.
        </p>
      </div>

      {target.picker}

      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Date collected *</label>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type *</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Received by</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile money</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. monthly meeting"
              className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a member…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Same amount for everyone shown</label>
              <input type="number" min={0} value={fill} onChange={(e) => setFill(e.target.value)}
                className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <Button variant="outline" disabled={!(Number(fill) > 0)}
              onClick={() => {
                const next = { ...amounts };
                for (const m of visible) next[m.id] = fill;
                setAmounts(next);
              }}>
              Apply
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading members…</p>
        ) : !target.cooperativeId ? (
          <p className="text-sm text-gray-500">Choose a cooperative above.</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-500">No active members on the register. Add members first.</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">No.</th>
                  <th className="px-3 py-2 text-right">Amount (RWF)</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const v = amounts[m.id] ?? "";
                  const bad = v !== "" && !(Number(v) > 0);
                  return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-900">{m.full_name}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{m.membership_number ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" min={0} value={v}
                          onChange={(e) => setAmounts({ ...amounts, [m.id]: e.target.value })}
                          className={`w-36 rounded-md border px-2 py-1 text-right ${bad ? "border-red-400" : "border-gray-300"}`}
                          aria-label={`Amount for ${m.full_name}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-700">
            <strong>{entries.length}</strong> member(s) · <strong>{total.toLocaleString()} RWF</strong>
          </p>
          <Button onClick={submit} disabled={busy || entries.length === 0 || invalid || !date}>
            {busy ? "Saving…" : "Record contributions"}
          </Button>
        </div>
        {invalid && <p className="text-sm text-red-600">Amounts must be positive numbers.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}
      </Card>
    </div>
  );
}
