import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useDataEntryCooperative } from "../components/DataEntryCooperative";
import { api } from "../services/api";
import { AlertTriangle, CheckCircle2, ClipboardList, XCircle } from "lucide-react";

/**
 * The record-keeping checklist.
 *
 * Everything the sector, district and RCA officers see about a cooperative —
 * the monthly audit, the activity and attendance figures, the register
 * categories — is computed from what is recorded for it. This page lists each
 * of those records, says when it was last kept, and links to where it is
 * entered. A manager sees their own cooperative; an administrator picks one.
 */

interface RecordItem {
  key: string;
  label: string;
  status: "ok" | "due" | "missing";
  detail: string;
  last: string | null;
  action: { label: string; path: string };
}

const STATUS = {
  ok: { Icon: CheckCircle2, tone: "text-green-700", badge: "bg-green-100 text-green-800", label: "Up to date" },
  due: { Icon: AlertTriangle, tone: "text-amber-600", badge: "bg-amber-100 text-amber-800", label: "Needs attention" },
  missing: { Icon: XCircle, tone: "text-red-600", badge: "bg-red-100 text-red-700", label: "Not recorded" },
} as const;

// Entry pages that understand `?cooperativeId=`; the others are the
// cooperative's own pages and are reached as the manager.
const CARRIES_COOPERATIVE = ["/transactions/new", "/contributions/new", "/balance-sheets/new", "/activities/new"];

export function Records() {
  const navigate = useNavigate();
  const target = useDataEntryCooperative();
  const [items, setItems] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<{ ok: number; due: number; missing: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target.cooperativeId) {
      setItems([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    setError("");
    api
      .get<{ data: RecordItem[]; summary: { ok: number; due: number; missing: number } }>(
        `/cooperatives/${target.cooperativeId}/record-status`
      )
      .then((res) => {
        // Gaps first: the page exists to say what to do next.
        const order = { missing: 0, due: 1, ok: 2 };
        setItems([...(res.data ?? [])].sort((a, b) => order[a.status] - order[b.status]));
        setSummary(res.summary);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the record status."))
      .finally(() => setLoading(false));
  }, [target.cooperativeId]);

  if (!target.allowed) {
    return <Card className="p-8 text-center text-gray-600">Your account is not attached to a cooperative.</Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-[#2D6A4F]" />
          Records
        </h1>
        <p className="mt-1 max-w-3xl text-gray-600">
          What the sector, district and RCA see about {target.cooperativeName ?? "a cooperative"} comes
          from what is recorded here — the monthly audit reads every one of these. Keep them current
          and the cooperative is judged on what it actually does.
        </p>
      </div>

      {target.picker}

      {target.picks && !target.cooperativeId && (
        <Card className="p-8 text-center text-gray-600">Choose a cooperative to see and keep its records.</Card>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(["missing", "due", "ok"] as const).map((k) => (
            <div key={k} className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">{STATUS[k].label}</p>
              <p className={`mt-1 text-2xl font-semibold ${STATUS[k].tone}`}>{summary[k]}</p>
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-gray-500">Checking the records…</p>}

      <div className="space-y-3">
        {items.map((i) => {
          const s = STATUS[i.status];
          // Pages that belong to the cooperative itself (profile, documents,
          // its activity list) only make sense for its own manager.
          const reachable = !target.picks || CARRIES_COOPERATIVE.includes(i.action.path);
          return (
            <Card key={i.key} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.tone}`} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900">{i.label}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}>{s.label}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">{i.detail}</p>
                    {i.last && <p className="text-xs text-gray-400">Last recorded {new Date(i.last).toLocaleDateString()}</p>}
                  </div>
                </div>
                {reachable ? (
                  <Button
                    variant={i.status === "ok" ? "outline" : "primary"}
                    onClick={() =>
                      navigate(CARRIES_COOPERATIVE.includes(i.action.path) ? `${i.action.path}${target.query}` : i.action.path)
                    }
                  >
                    {i.action.label}
                  </Button>
                ) : (
                  <span className="text-xs text-gray-500">Kept by the cooperative's manager</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
