import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { fetchAllMembers, RegisterMember } from "../services/members";
import { Card } from "./Card";
import { Button } from "./Button";
import { CheckCircle2, Users, XCircle } from "lucide-react";

/**
 * The activity's register: who was invited, and who actually came.
 *
 * Attendance is what the monthly audit and the sector, district and RCA
 * officers read to tell whether members still take part. It could not be
 * entered at all — the old form asked for a raw member id and sent a body the
 * backend rejected. This lists the cooperative's members with two ticks each.
 */

interface Participant {
  member_id: string;
  full_name: string;
  attended: boolean;
}

interface Row {
  registered: boolean;
  attended: boolean;
}

export function AttendanceRegister({
  activityId,
  cooperativeId,
  status,
  canEdit,
  onSaved,
}: {
  activityId: string;
  cooperativeId: string | null;
  status: string;
  canEdit: boolean;
  onSaved?: (registered: number, attended: number) => void;
}) {
  const [members, setMembers] = useState<RegisterMember[]>([]);
  const [saved, setSaved] = useState<Record<string, Row>>({});
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const editable = canEdit && status !== "cancelled";
  // Attendance only means something once the activity is under way or done.
  const canMarkAttendance = status === "ongoing" || status === "completed";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [participantsRes, register] = await Promise.all([
        api.get<{ data: Participant[] }>(`/activities/${activityId}/participants`),
        editable ? fetchAllMembers(cooperativeId) : Promise.resolve([] as RegisterMember[]),
      ]);
      const current: Record<string, Row> = {};
      for (const p of participantsRes.data ?? []) {
        current[p.member_id] = { registered: true, attended: p.attended };
      }
      // Read-only viewers see the participants only.
      const list: RegisterMember[] = editable
        ? register.filter((m) => m.status === "active" || current[m.id])
        : (participantsRes.data ?? []).map((p) => ({
            id: p.member_id, full_name: p.full_name, membership_number: null,
            gender: null, status: "active", role: null, phone: null,
          }));
      setMembers(list);
      setSaved(current);
      setRows(current);
    } catch (err: any) {
      setError(err?.message ?? "Could not load the register.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, editable]);

  const row = (id: string): Row => rows[id] ?? { registered: false, attended: false };
  const set = (id: string, next: Partial<Row>) => {
    const merged = { ...row(id), ...next };
    // Attending implies being on the register; un-registering clears attendance.
    if (next.attended) merged.registered = true;
    if (next.registered === false) merged.attended = false;
    setRows({ ...rows, [id]: merged });
    setMessage("");
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return members.filter(
      (m) => !q || m.full_name.toLowerCase().includes(q) || (m.membership_number ?? "").toLowerCase().includes(q)
    );
  }, [members, filter]);

  const registeredCount = Object.values(rows).filter((r) => r.registered).length;
  const attendedCount = Object.values(rows).filter((r) => r.attended).length;
  const dirty = members.some((m) => {
    const a = row(m.id);
    const b = saved[m.id] ?? { registered: false, attended: false };
    return a.registered !== b.registered || a.attended !== b.attended;
  });

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const before = (id: string) => saved[id] ?? { registered: false, attended: false };
      const add = { attended: [] as string[], absent: [] as string[] };
      const changed: Array<{ memberId: string; attended: boolean }> = [];
      const removed: string[] = [];

      for (const m of members) {
        const now = row(m.id);
        const was = before(m.id);
        if (now.registered && !was.registered) (now.attended ? add.attended : add.absent).push(m.id);
        else if (!now.registered && was.registered) removed.push(m.id);
        else if (now.registered && now.attended !== was.attended) changed.push({ memberId: m.id, attended: now.attended });
      }

      if (add.attended.length) {
        await api.post(`/activities/${activityId}/participants`, { memberIds: add.attended, attended: true });
      }
      if (add.absent.length) {
        await api.post(`/activities/${activityId}/participants`, { memberIds: add.absent, attended: false });
      }
      if (changed.length) {
        await api.patch(`/activities/${activityId}/attendance`, { attendance: changed });
      }
      for (const memberId of removed) {
        await api.delete(`/activities/${activityId}/participants/${memberId}`);
      }

      setSaved(rows);
      setMessage(`Saved: ${registeredCount} registered, ${attendedCount} attended.`);
      onSaved?.(registeredCount, attendedCount);
    } catch (err: any) {
      setError(err?.message ?? "Could not save the register.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const bulk = (fn: (id: string) => Row) => {
    const next = { ...rows };
    for (const m of visible) next[m.id] = fn(m.id);
    setRows(next);
    setMessage("");
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Register and attendance
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            <strong>{registeredCount}</strong> registered · <strong>{attendedCount}</strong> attended
            {registeredCount > 0 && canMarkAttendance && ` (${Math.round((attendedCount / registeredCount) * 100)}%)`}
          </p>
        </div>
        {editable && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a member…"
            className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
          />
        )}
      </div>

      {editable && !canMarkAttendance && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Register the members you are inviting now. Mark who attended once the activity is under way
          or done — change its status above first.
        </p>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => bulk((id) => ({ ...row(id), registered: true }))}>
            Register all {filter ? "shown" : "active members"}
          </Button>
          {canMarkAttendance && (
            <Button
              variant="outline"
              onClick={() => bulk((id) => (row(id).registered ? { registered: true, attended: true } : row(id)))}
            >
              Mark all registered as attended
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading the register…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-500">
          {editable ? "This cooperative has no active members on the register." : "Nobody was registered for this activity."}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2 text-center">Registered</th>
                <th className="px-3 py-2 text-center">Attended</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const r = row(m.id);
                return (
                  <tr key={m.id} className={`border-t border-gray-100 ${r.attended ? "bg-green-50/50" : ""}`}>
                    <td className="px-3 py-1.5 text-gray-900">{m.full_name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{m.membership_number ?? "—"}</td>
                    <td className="px-3 py-1.5 text-center">
                      {editable ? (
                        <input
                          type="checkbox"
                          checked={r.registered}
                          onChange={(e) => set(m.id, { registered: e.target.checked })}
                          aria-label={`${m.full_name} registered`}
                        />
                      ) : r.registered ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-gray-500" />
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {editable && canMarkAttendance ? (
                        <input
                          type="checkbox"
                          checked={r.attended}
                          onChange={(e) => set(m.id, { attended: e.target.checked })}
                          aria-label={`${m.full_name} attended`}
                        />
                      ) : r.attended ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                      ) : r.registered ? (
                        <XCircle className="mx-auto h-4 w-4 text-gray-300" />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}
      {editable && (
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : dirty ? "Save the register" : "Saved"}
        </Button>
      )}
    </Card>
  );
}
