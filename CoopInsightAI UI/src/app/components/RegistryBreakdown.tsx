import { Fragment, useEffect, useState } from "react";
import { api } from "../services/api";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * The five register categories, counted per sector or per district.
 *
 * The district office supervises sectors and the RCA supervises districts, so
 * each sees the register cut by the level directly beneath it. Every count is a
 * link: clicking it opens the register on that category, narrowed to that place.
 */

type Counts = Record<string, number>;

interface Group {
  key: string;
  name: string;
  level: "district" | "sector";
  district: string;
  counts: Counts;
  onRegister: number;
  reasons: Counts;
  children?: Group[];
}

interface Breakdown {
  by: "sector" | "district";
  groups: Group[];
  total: Group;
  categories: Array<{ id: string; label: string }>;
  reasons: Array<{ id: string; label: string }>;
}

export interface Place {
  sector?: string;
  district?: string;
  label: string;
}

const CELL_TONE: Record<string, string> = {
  not_active: "text-red-700",
  at_risk: "text-amber-700",
};

export function RegistryBreakdown({ onSelect }: { onSelect: (view: string, place: Place | null) => void }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [by, setBy] = useState<"sector" | "district" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ data: Breakdown }>(`/cooperatives/registry/breakdown${by ? `?by=${by}` : ""}`)
      .then((res) => {
        setData(res.data);
        // With a single district, open it: there is nothing else to look at.
        if (res.data.by === "district" && res.data.groups.length === 1) {
          setOpen(new Set([res.data.groups[0].key]));
        }
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the breakdown."));
  }, [by]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading the breakdown…</p>;

  const reasonText = (g: Group) =>
    data.reasons
      .filter((r) => g.reasons[r.id] > 0)
      .map((r) => `${r.label}: ${g.reasons[r.id]}`)
      .join(" · ");

  const placeOf = (g: Group): Place | null =>
    g.key === "total"
      ? null
      : g.level === "district"
        ? { district: g.name, label: `${g.name} district` }
        : { sector: g.name, district: g.district, label: `${g.name} sector` };

  const row = (g: Group, depth: number) => {
    const expandable = !!g.children?.length;
    const isOpen = open.has(g.key);
    return (
      <Fragment key={`${g.level}-${g.district}-${g.key}`}>
        <tr className={`border-b border-gray-100 ${g.key === "total" ? "bg-gray-50 font-semibold" : ""}`}>
          <td className="py-2 pr-3">
            <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
              {expandable ? (
                <button
                  onClick={() => {
                    const next = new Set(open);
                    if (isOpen) next.delete(g.key);
                    else next.add(g.key);
                    setOpen(next);
                  }}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              ) : (
                <span className="w-4" />
              )}
              <span className="text-gray-900">{g.name}</span>
              {g.level === "district" && g.key !== "total" && (
                <span className="text-xs font-normal text-gray-400">district</span>
              )}
            </div>
          </td>
          <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{g.onRegister}</td>
          {data.categories.map((c) => {
            const n = g.counts[c.id] ?? 0;
            return (
              <td key={c.id} className="py-2 pr-3 text-right tabular-nums">
                {n > 0 ? (
                  <button
                    onClick={() => onSelect(c.id, placeOf(g))}
                    title={c.id === "not_active" ? reasonText(g) : `Open ${c.label.toLowerCase()} in ${g.name}`}
                    className={`underline-offset-2 hover:underline ${CELL_TONE[c.id] ?? "text-gray-900"}`}
                  >
                    {n}
                  </button>
                ) : (
                  <span className="text-gray-300">0</span>
                )}
              </td>
            );
          })}
          <td className="py-2 pl-2 text-xs font-normal text-gray-500">{reasonText(g) || "—"}</td>
        </tr>
        {expandable && isOpen && g.children!.map((child) => row(child, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          The register by {data.by}. Click a count to open that category in that {data.by}.
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
          {(["district", "sector"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBy(b)}
              className={`rounded-md px-3 py-1 ${data.by === b ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              By {b}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">{data.by === "district" ? "District / sector" : "Sector"}</th>
              <th className="py-2 pr-3 text-right">On register</th>
              {data.categories.map((c) => (
                <th key={c.id} className="py-2 pr-3 text-right">{c.label}</th>
              ))}
              <th className="py-2 pl-2">Why not active</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => row(g, 0))}
            {data.groups.length > 1 && row(data.total, 0)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
