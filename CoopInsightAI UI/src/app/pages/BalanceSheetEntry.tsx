import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useDataEntryCooperative } from "../components/DataEntryCooperative";
import { api } from "../services/api";
import { ArrowLeft, Scale } from "lucide-react";

/**
 * Filing the cooperative's balance sheet.
 *
 * The audit expects one a year and flags a cooperative that has never filed one,
 * but there was no way to file it — the table could be read, never written.
 * The manager enters the closing figures; the sheet must balance before it is
 * accepted, and filing again for the same closing date corrects it.
 */

const SECTIONS = [
  {
    id: "assets",
    title: "Assets",
    fields: [
      { key: "cash", label: "Cash in hand" },
      { key: "bankBalance", label: "Bank and mobile money balance" },
      { key: "loansOutstanding", label: "Loans owed to the cooperative by members" },
      { key: "inventory", label: "Stock / inventory" },
      { key: "fixedAssets", label: "Fixed assets (land, buildings, equipment)" },
    ],
  },
  {
    id: "liabilities",
    title: "Liabilities",
    fields: [
      { key: "memberSavings", label: "Members' savings held" },
      { key: "externalLoans", label: "Loans owed by the cooperative" },
      { key: "accountsPayable", label: "Unpaid bills (accounts payable)" },
    ],
  },
  {
    id: "equity",
    title: "Equity",
    fields: [
      { key: "shareCapital", label: "Share capital" },
      { key: "retainedEarnings", label: "Retained earnings (negative after a loss)" },
    ],
  },
] as const;

type Values = Record<string, string>;

interface FiledSheet {
  id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
}

export function BalanceSheetEntry() {
  const target = useDataEntryCooperative();
  const navigate = useNavigate();
  const lastYear = new Date().getFullYear() - 1;

  const [periodStart, setPeriodStart] = useState(`${lastYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${lastYear}-12-31`);
  const [values, setValues] = useState<Values>({});
  const [history, setHistory] = useState<FiledSheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadHistory = () =>
    api
      .get<{ data: FiledSheet[] }>(`/transactions/balance-sheets${target.picks ? target.query : ""}`)
      .then((res) => setHistory(res.data ?? []))
      .catch(() => setHistory([]));

  useEffect(() => {
    setHistory([]);
    if (target.cooperativeId) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.cooperativeId]);

  const num = (k: string) => {
    const n = Number(values[k] ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const total = (id: string) =>
    SECTIONS.find((s) => s.id === id)!.fields.reduce((a, f) => a + num(f.key), 0);
  const assets = total("assets");
  const liabilities = total("liabilities");
  const equity = total("equity");
  const difference = assets - (liabilities + equity);
  const balanced = Math.abs(difference) <= 1;

  const submit = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = { cooperativeId: target.cooperativeId, periodStart, periodEnd };
      for (const s of SECTIONS) for (const f of s.fields) body[f.key] = num(f.key);
      const res = await api.post<{ message: string }>("/transactions/balance-sheet", body);
      setMessage(res.message);
      await loadHistory();
    } catch (err: any) {
      setError(err?.message ?? "Could not file the balance sheet.");
    } finally {
      setBusy(false);
    }
  };

  if (!target.allowed) {
    return (
      <Card className="p-8 text-center text-gray-600">
        The balance sheet is filed by the cooperative's manager or an administrator.
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
          <Scale className="h-6 w-6 text-[#2D6A4F]" />
          File a balance sheet
        </h1>
        <p className="mt-1 max-w-3xl text-gray-600">
          The cooperative's position at the close of a financial period, usually the year. Assets
          must equal liabilities plus equity. Filing again for the same closing date replaces the
          earlier figures.
        </p>
      </div>

      {target.picker}

      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:w-2/3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Period start *</label>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Period end (closing date) *</label>
            <input type="date" value={periodEnd} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Card key={s.id} className="p-6 space-y-3">
            <h2 className="font-semibold text-gray-900">{s.title}</h2>
            {s.fields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-sm text-gray-700">{f.label}</label>
                <input type="number" value={values[f.key] ?? ""}
                  min={f.key === "retainedEarnings" ? undefined : 0}
                  onChange={(e) => {
                    setValues({ ...values, [f.key]: e.target.value });
                    setMessage("");
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-right" />
              </div>
            ))}
            <p className="border-t border-gray-200 pt-2 text-right text-sm font-semibold text-gray-900">
              {total(s.id).toLocaleString()} RWF
            </p>
          </Card>
        ))}
      </div>

      <Card className={`p-5 ${balanced ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-gray-900">
            Assets <strong>{assets.toLocaleString()}</strong> · Liabilities + equity{" "}
            <strong>{(liabilities + equity).toLocaleString()}</strong> RWF
            {balanced ? (
              <span className="ml-2 font-semibold text-green-800">Balanced</span>
            ) : (
              <span className="ml-2 font-semibold text-amber-800">Off by {difference.toLocaleString()} RWF</span>
            )}
          </p>
          <div className="flex gap-2">
            {!balanced && (
              <Button
                variant="outline"
                onClick={() => setValues({ ...values, retainedEarnings: String(num("retainedEarnings") + difference) })}
                title="Retained earnings is the usual balancing figure: what the cooperative has accumulated."
              >
                Balance with retained earnings
              </Button>
            )}
            <Button onClick={submit} disabled={busy || !balanced || assets === 0 || !periodStart || !periodEnd || !target.cooperativeId}>
              {busy ? "Filing…" : "File the balance sheet"}
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-gray-900">Filed so far</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No balance sheet has been filed yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.period_start).toLocaleDateString()} – {new Date(h.period_end).toLocaleDateString()}
                <span className="text-gray-400"> · filed {new Date(h.generated_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
