import { useCallback, useEffect, useState } from "react";
import { Download, Printer, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../services/api";
import { downloadFromApi, printFromApi } from "../services/pdf";
import { ScopePicker, defaultScope, scopeQuery, type ScopeValue } from "./ScopePicker";
import { Card } from "./Card";
import { Button } from "./Button";

/**
 * Everyone who asked the agency for something, and where it stands.
 *
 * Formation, dissolution, certificate changes, issues reported, members asking
 * to leave, audits and external support — one list, filtered by the same
 * who-and-when picker as the reports. The PDF and Print buttons produce the
 * same register as a registered, verifiable document.
 */

interface Row {
  source: string;
  id: string;
  reference: string;
  kind: string;
  kindLabel: string;
  group: string;
  requester: string;
  requesterRole: string | null;
  cooperative: string | null;
  sector: string | null;
  stage: string;
  statusLabel: string;
  state: "open" | "approved" | "rejected" | "closed";
  submittedAt: string;
  dueAt: string | null;
  overdue: boolean;
}

interface Summary {
  total: number;
  open: number;
  approved: number;
  rejected: number;
  closed: number;
  overdue: number;
  atSector: number;
  atDistrict: number;
  atRca: number;
}

const GROUPS = [
  { id: "all", label: "Everything" },
  { id: "requests", label: "Formation, dissolution & certificates" },
  { id: "audits", label: "Audits" },
  { id: "issues", label: "Issues" },
  { id: "exits", label: "Leaving" },
  { id: "funding", label: "External support" },
];

const STATES = [
  { id: "all", label: "Any state" },
  { id: "open", label: "Open" },
  { id: "approved", label: "Approved / completed" },
  { id: "rejected", label: "Refused" },
  { id: "closed", label: "Withdrawn / cancelled" },
];

const STATE_STYLE: Record<Row["state"], string> = {
  open: "bg-[#D4A574]/15 text-[#8A6233] ring-[#D4A574]/40",
  approved: "bg-[#2D6A4F]/5 text-[#2D6A4F] ring-[#2D6A4F]/20",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  closed: "bg-gray-100 text-gray-600 ring-gray-200",
};

const STAGE_STEPS = ["Sector officer", "District office", "RCA"];

const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const select = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]";

/** Sector → district → RCA, with the current step filled in. */
function Ladder({ stage, state }: { stage: string; state: Row["state"] }) {
  const at = STAGE_STEPS.indexOf(stage);
  if (at < 0) return <span className="text-gray-700">{stage}</span>;
  return (
    <span className="flex items-center gap-1" title={`Now with: ${stage}`}>
      {STAGE_STEPS.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 w-5 rounded-full ${i < at ? "bg-[#2D6A4F]" : i === at && state === "open" ? "bg-[#D4A574]" : "bg-gray-200"}`}
        />
      ))}
      <span className="ml-1.5 text-gray-700">{stage}</span>
    </span>
  );
}

export function RequestsRegister() {
  const [scope, setScope] = useState<ScopeValue>(defaultScope);
  const [group, setGroup] = useState("all");
  const [state, setState] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (scope.from > scope.to) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: Row[]; summary: Summary; scope: { label: string } }>(
        `/requests-register?${scopeQuery(scope, { group, state })}`
      );
      setRows(res.data ?? []);
      setSummary(res.summary);
      setLabel(res.scope?.label ?? "");
    } catch (err: any) {
      setError(err?.message ?? "Could not load the register.");
    } finally {
      setLoading(false);
    }
  }, [scope, group, state]);

  useEffect(() => { load(); }, [load]);

  const pdfPath = `/requests-register/pdf?${scopeQuery(scope)}`;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err: any) { setError(err?.message ?? "That did not work."); } finally { setBusy(false); }
  };

  const single = rows.length > 0 && rows.every((r) => r.cooperative === rows[0].cooperative);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <ScopePicker value={scope} onChange={setScope} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <select className={select} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Kind of request">
              {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <select className={select} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
              {STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => printFromApi(pdfPath))}>
              <span className="flex items-center gap-1.5"><Printer className="h-4 w-4" />Print</span>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act(() => downloadFromApi(pdfPath, "requests-register.pdf"))}>
              <span className="flex items-center gap-1.5"><Download className="h-4 w-4" />Download PDF</span>
            </Button>
          </div>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Requests", value: summary.total, tone: "text-gray-900" },
            { label: "Open", value: summary.open, tone: "text-[#8A6233]" },
            { label: "Approved / completed", value: summary.approved, tone: "text-[#2D6A4F]" },
            { label: "Refused", value: summary.rejected, tone: "text-red-700" },
            { label: "Past response date", value: summary.overdue, tone: summary.overdue ? "text-red-700" : "text-gray-900" },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t.label}</p>
              <p className={`mt-1 text-2xl font-bold ${t.tone}`}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{label}</span>
            {summary && summary.open > 0 && (
              <span className="ml-2 text-gray-500">
                · open: {summary.atSector} with sector, {summary.atDistrict} with district, {summary.atRca} with the RCA
              </span>
            )}
          </p>
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-[#2D6A4F]" />}
        </div>
        {rows.length === 0 && !loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">No requests in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Requested by</th>
                  {!single && <th className="px-4 py-3 font-medium">Cooperative</th>}
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Now with</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{r.kindLabel}</p>
                      <p className="font-mono text-xs text-gray-400">{r.reference}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{r.requester}</p>
                      {r.requesterRole && <p className="text-xs text-gray-500">{r.requesterRole}</p>}
                    </td>
                    {!single && (
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{r.cooperative ?? "—"}</p>
                        {r.sector && <p className="text-xs text-gray-500">{r.sector} sector</p>}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{day(r.submittedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3"><Ladder stage={r.stage} state={r.state} /></td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATE_STYLE[r.state]}`}>
                        {r.statusLabel}
                      </span>
                      {r.overdue ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                          <AlertTriangle className="h-3 w-3" /> Response was due {day(r.dueAt)}
                        </p>
                      ) : r.state === "open" && r.dueAt ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" /> Due {day(r.dueAt)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
