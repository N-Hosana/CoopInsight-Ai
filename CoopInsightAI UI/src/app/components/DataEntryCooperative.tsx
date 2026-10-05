import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

/**
 * Which cooperative a data-entry page is writing to.
 *
 * A manager keeps their own cooperative's books, so for them this is fixed.
 * An administrator or the general manager enters records for whichever
 * cooperative they choose — that is how a cooperative with nobody on the system
 * still gets its records kept. The choice lives in the URL (`?cooperativeId=`)
 * so moving between the entry pages keeps it, and a link can carry it.
 *
 * The backend enforces the same rule (`writableCooperative`): a manager can
 * never write elsewhere whatever this page sends.
 */

interface Option {
  id: string;
  name: string;
  sector: string;
}

export interface DataEntryTarget {
  /** The cooperative being written to, or null while an administrator has not chosen. */
  cooperativeId: string | null;
  cooperativeName: string | null;
  /** True for administrators, who pick; false for a manager, who cannot. */
  picks: boolean;
  /** The account may enter records at all. */
  allowed: boolean;
  /** `?cooperativeId=…` to append to a link to another entry page, or "". */
  query: string;
  /** The dropdown, for administrators; null for a manager. */
  picker: JSX.Element | null;
}

const KEEPERS = ["manager", "cooperative"];
const ADMINISTRATORS = ["admin", "generalManager"];

export function useDataEntryCooperative(): DataEntryTarget {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [options, setOptions] = useState<Option[]>([]);

  const picks = ADMINISTRATORS.includes(user?.role ?? "");
  const keeper = KEEPERS.includes(user?.role ?? "");

  useEffect(() => {
    if (!picks) return;
    api
      .get<{ data: Array<{ id: string; name: string; sector: string }> }>("/cooperatives?view=all&page=1&limit=100")
      .then((res) =>
        setOptions(
          (res.data ?? [])
            .map((c) => ({ id: c.id, name: c.name, sector: c.sector }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setOptions([]));
  }, [picks]);

  if (keeper) {
    const id = user?.cooperativeId ?? null;
    return {
      cooperativeId: id,
      cooperativeName: user?.cooperativeName ?? null,
      picks: false,
      allowed: !!id,
      query: "",
      picker: null,
    };
  }

  if (!picks) {
    return { cooperativeId: null, cooperativeName: null, picks: false, allowed: false, query: "", picker: null };
  }

  const chosen = params.get("cooperativeId");
  const current = options.find((o) => o.id === chosen) ?? null;

  const picker = (
    <div className="rounded-xl border border-[#2D6A4F]/30 bg-[#2D6A4F]/5 p-4">
      <label className="mb-1 block text-sm font-medium text-gray-800">Recording for cooperative</label>
      <select
        value={chosen ?? ""}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("cooperativeId", e.target.value);
          else next.delete("cooperativeId");
          setParams(next, { replace: true });
        }}
        className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2"
      >
        <option value="">Choose a cooperative…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} — {o.sector}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-600">
        As an administrator you can keep records for any cooperative. Everything entered here is
        saved against the one chosen.
      </p>
    </div>
  );

  return {
    cooperativeId: chosen,
    cooperativeName: current?.name ?? null,
    picks: true,
    allowed: true,
    query: chosen ? `?cooperativeId=${chosen}` : "",
    picker,
  };
}
