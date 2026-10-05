import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";
import { Button } from "./Button";
import { CalendarClock, Users } from "lucide-react";

/**
 * Calling one of the two general assemblies of a dissolution.
 *
 * The meeting is added to the activities calendar with every active member
 * registered, and every member gets the notice — the backend does all of that
 * in one call. Assemblies already called for this stage are listed, each
 * opening its activity.
 */

interface Assembly {
  id: string;
  purpose: "dissolution_decision" | "dissolution_distribution";
  request_id: string | null;
  activity_id: string | null;
  scheduled_for: string;
  location: string;
  members_registered: number;
  activity_status: string | null;
}

/** The earliest the assembly can sit: three days' notice for an extraordinary assembly. */
function earliest(): string {
  const d = new Date(Date.now() + 3 * 86_400_000 + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function AssemblyCaller({
  stage,
  requestId,
  cooperativeId,
  intro,
}: {
  stage: "decision" | "distribution";
  requestId?: string;
  cooperativeId?: string | null;
  intro: string;
}) {
  const navigate = useNavigate();
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [open, setOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const purpose = stage === "decision" ? "dissolution_decision" : "dissolution_distribution";

  const load = () =>
    api
      .get<{ data: Assembly[] }>(`/cooperative-requests/dissolution/assemblies${cooperativeId ? `?cooperativeId=${cooperativeId}` : ""}`)
      .then((res) =>
        setAssemblies(
          (res.data ?? []).filter((a) => a.purpose === purpose && (stage === "decision" || a.request_id === requestId))
        )
      )
      .catch(() => setAssemblies([]));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, requestId, cooperativeId]);

  const call = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string }>("/cooperative-requests/dissolution/assembly", {
        stage,
        requestId,
        cooperativeId: cooperativeId ?? undefined,
        scheduledFor,
        location: location.trim(),
        agenda: agenda.trim() || undefined,
      });
      setMessage(res.message);
      setOpen(false);
      setScheduledFor("");
      setLocation("");
      setAgenda("");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not call the assembly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#2D6A4F]/30 bg-[#2D6A4F]/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#2D6A4F]" />
          <p className="text-sm text-gray-800">{intro}</p>
        </div>
        {!open && (
          <Button size="sm" onClick={() => { setOpen(true); setScheduledFor(earliest()); }}>
            Call the general assembly
          </Button>
        )}
      </div>

      {assemblies.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {assemblies.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
              <Users className="h-3.5 w-3.5 text-gray-500" />
              Called for {new Date(a.scheduled_for).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} at {a.location}
              <span className="text-gray-500">· {a.members_registered} members registered</span>
              {a.activity_status && <span className="rounded-full bg-white px-2 py-0.5 text-xs capitalize text-gray-600">{a.activity_status}</span>}
              {a.activity_id && (
                <button onClick={() => navigate(`/activities/${a.activity_id}`)} className="text-xs font-medium text-[#2D6A4F] hover:underline">
                  Open the activity →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Date and time *</label>
            <input type="datetime-local" value={scheduledFor} min={earliest()} onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            <p className="mt-1 text-[11px] text-gray-500">An extraordinary assembly needs at least 3 days' notice.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Venue *</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Cooperative hall, Remera"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-700">Agenda (leave blank for the standard one)</label>
            <textarea rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button size="sm" disabled={busy || !scheduledFor || !location.trim()} onClick={call}>
              {busy ? "Calling…" : "Call it and notify every member"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-2 text-sm text-green-700">{message}</p>}
    </div>
  );
}
