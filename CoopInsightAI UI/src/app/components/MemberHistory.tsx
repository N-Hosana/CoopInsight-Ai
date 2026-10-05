import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Card } from "./Card";

/**
 * A member's whole history, newest first, a page at a time — what the
 * dashboard's "My recent activity" opens onto with "View all".
 */

interface Entry {
  kind: string;
  id: string;
  at: string;
  amount: number | null;
  title: string;
  flow: "in" | "out" | null;
  note: string | null;
}

const FILTERS = [
  { id: "", label: "Everything" },
  { id: "contribution", label: "Payments in" },
  { id: "loan", label: "Loans" },
  { id: "repayment", label: "Repayments" },
  { id: "dividend", label: "Dividends" },
  { id: "attended", label: "Attended" },
  { id: "missed", label: "Missed" },
  { id: "status", label: "Membership changes" },
];

const PAGE_SIZE = 25;

export function MemberHistory({ memberId }: { memberId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get<{ data: Entry[]; pagination: { total: number } }>(
        `/members/${memberId}/history?limit=${PAGE_SIZE}&page=${page}${kind ? `&kind=${kind}` : ""}`
      )
      .then((res) => {
        setEntries(res.data ?? []);
        setTotal(res.pagination?.total ?? 0);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the history."))
      .finally(() => setLoading(false));
  }, [memberId, page, kind]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setKind(f.id);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${
              kind === f.id ? "border-[#2D6A4F] bg-[#2D6A4F] text-white" : "border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing recorded{kind ? " of this kind" : ""}.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {entries.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm text-gray-900">{e.title}</p>
                {e.note && <p className="text-xs text-gray-500">{e.note}</p>}
              </div>
              <div className="text-right">
                {e.amount != null && (
                  <p className={`text-sm font-semibold ${e.flow === "in" ? "text-green-700" : e.flow === "out" ? "text-gray-900" : "text-gray-700"}`}>
                    {Math.round(e.amount).toLocaleString()} RWF
                  </p>
                )}
                <p className="text-xs text-gray-400">{new Date(e.at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-sm text-gray-600">
        <span>{total} entr{total === 1 ? "y" : "ies"}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">
            Newer
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">
            Older
          </button>
        </div>
      </div>
    </Card>
  );
}
