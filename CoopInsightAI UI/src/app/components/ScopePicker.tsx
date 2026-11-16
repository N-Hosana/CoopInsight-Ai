import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, User, CalendarRange } from "lucide-react";
import { api } from "../services/api";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO AND WHEN — ONE PICKER FOR EVERY REPORT AND REGISTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The server decides what an account may cover (services/reportScope.ts) and
 * tells this component through /reports/scope-options. The picker only ever
 * offers those choices:
 *
 *   member          nothing to choose — their own records
 *   manager         nothing to choose — their cooperative
 *   sector officer  their sector (fixed); any cooperative in it, or all
 *   district / RCA  any sector, then any cooperative in it, or all
 *
 * and everyone picks the period. Anything it sends is checked again on the
 * server, so the picker is a convenience, not the control.
 */

export interface ScopeOptions {
  mode: "member" | "cooperative" | "sector" | "district";
  fixedCooperative: { id: string; name: string; sector: string | null } | null;
  fixedSector: string | null;
  canChooseSector: boolean;
  canChooseCooperative: boolean;
  sectors: string[];
  cooperatives: Array<{ id: string; name: string; sector: string | null }>;
}

export interface ScopeValue {
  sector: string;
  cooperativeId: string;
  preset: string;
  from: string;
  to: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The periods people report on, so nobody has to type dates. */
export function periodPresets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  return [
    { id: "this_year", label: `This year (${y})`, from: iso(new Date(y, 0, 1)), to: iso(now) },
    { id: "last_quarter", label: "Last quarter", from: iso(new Date(y, q * 3 - 3, 1)), to: iso(new Date(y, q * 3, 0)) },
    { id: "last_month", label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { id: "last_year", label: `Last year (${y - 1})`, from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) },
    { id: "last_12", label: "Last 12 months", from: iso(new Date(y - 1, m, now.getDate() + 1)), to: iso(now) },
  ];
}

export function defaultScope(): ScopeValue {
  const p = periodPresets()[0];
  return { sector: "", cooperativeId: "", preset: p.id, from: p.from, to: p.to };
}

/** Query string for an API call: `from`, `to`, and the sector/cooperative chosen. */
export function scopeQuery(v: ScopeValue, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ from: v.from, to: v.to, ...extra });
  if (v.sector) q.set("sector", v.sector);
  if (v.cooperativeId) q.set("cooperativeId", v.cooperativeId);
  for (const [k, val] of [...q.entries()]) if (!val || val === "all") q.delete(k);
  return q.toString();
}

// Cached per session: signing out and in as someone else must not reuse the
// previous account's choices.
let cached: { token: string | null; options: Promise<ScopeOptions> } | null = null;
export function loadScopeOptions(): Promise<ScopeOptions> {
  const token = localStorage.getItem("coopinsight_refresh_token");
  if (!cached || cached.token !== token) {
    const options = api.get<{ data: ScopeOptions }>("/reports/scope-options").then((r) => r.data);
    options.catch(() => { cached = null; });
    cached = { token, options };
  }
  return cached.options;
}

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500";

function Fixed({ icon: Icon, text }: { icon: typeof User; text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      <Icon className="h-4 w-4 flex-shrink-0 text-[#2D6A4F]" />
      <span className="truncate">{text}</span>
    </p>
  );
}

export function ScopePicker({
  value,
  onChange,
  showPeriod = true,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  /** False for a position report, which describes today and takes no period. */
  showPeriod?: boolean;
}) {
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  const [error, setError] = useState("");
  const presets = useMemo(periodPresets, []);

  useEffect(() => {
    loadScopeOptions().then(setOptions).catch((e) => setError(e?.message ?? "Could not load what you may report on."));
  }, []);

  const coopsInSector = useMemo(
    () => (options?.cooperatives ?? []).filter((c) => !value.sector || (c.sector ?? "") === value.sector),
    [options, value.sector]
  );

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!options) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Who */}
      {options.mode === "member" && (
        <div className="sm:col-span-2">
          <span className={label}>Covers</span>
          <Fixed icon={User} text={`Your own records${options.fixedCooperative ? ` — ${options.fixedCooperative.name}` : ""}`} />
        </div>
      )}
      {options.mode === "cooperative" && (
        <div className="sm:col-span-2">
          <span className={label}>Cooperative</span>
          <Fixed icon={Building2} text={options.fixedCooperative?.name ?? "Your cooperative"} />
        </div>
      )}
      {(options.mode === "sector" || options.mode === "district") && (
        <>
          <div>
            <span className={label}>Sector</span>
            {options.canChooseSector ? (
              <select
                className={field}
                value={value.sector}
                onChange={(e) => onChange({ ...value, sector: e.target.value, cooperativeId: "" })}
              >
                <option value="">All sectors</option>
                {options.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <Fixed icon={MapPin} text={`${options.fixedSector} sector`} />
            )}
          </div>
          <div>
            <span className={label}>Cooperative</span>
            <select
              className={field}
              value={value.cooperativeId}
              onChange={(e) => onChange({ ...value, cooperativeId: e.target.value })}
            >
              <option value="">
                All cooperatives{value.sector || options.fixedSector ? ` in ${value.sector || options.fixedSector}` : ""}
              </option>
              {coopsInSector.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </>
      )}

      {/* When */}
      {showPeriod ? (
        <>
          <div>
            <span className={label}>Period</span>
            <select
              className={field}
              value={value.preset}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                onChange(p ? { ...value, preset: p.id, from: p.from, to: p.to } : { ...value, preset: "custom" });
              }}
            >
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Choose dates…</option>
            </select>
          </div>
          <div>
            <span className={label}>From – to</span>
            <div className="flex items-center gap-1">
              <input type="date" className={field} value={value.from} max={value.to}
                onChange={(e) => onChange({ ...value, preset: "custom", from: e.target.value })} />
              <input type="date" className={field} value={value.to} min={value.from}
                onChange={(e) => onChange({ ...value, preset: "custom", to: e.target.value })} />
            </div>
          </div>
        </>
      ) : (
        <div className="sm:col-span-2">
          <span className={label}>Period</span>
          <Fixed icon={CalendarRange} text="Position as it stands today" />
        </div>
      )}
    </div>
  );
}
