import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { Card } from "./Card";
import { GASABO_SECTORS } from "../data/gasaboData";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock, MapPin, Users, XCircle, AlertTriangle } from "lucide-react";

/**
 * What cooperatives are doing, have done and plan to do — and who turns up.
 *
 * Read-only, for the oversight chain. A sector officer sees the cooperatives in
 * their sector; the district office sees every sector; the RCA sees every
 * district. Attendance is the point: an assembly "held" with four of ninety
 * members present is not the same fact as one held with sixty.
 */

interface OversightActivity {
  id: string;
  title: string;
  type: string;
  status: "planned" | "ongoing" | "completed" | "cancelled";
  date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  outcome: string | null;
  cancellation_reason: string | null;
  cooperative_id: string;
  cooperative_name: string;
  sector: string;
  district: string;
  overdue: boolean;
  invited: number;
  attended: number;
}

interface Stats {
  name?: string;
  activities: number;
  planned: number;
  ongoing: number;
  completed: number;
  cancelled: number;
  overdue: number;
  invited: number;
  attended: number;
  cooperatives_active: number;
  distinct_attendees: number;
  attendanceRate: number | null;
  cooperativesTotal?: number;
}

interface Participant {
  id: string;
  member_id: string;
  full_name: string;
  membership_number: string | null;
  gender: string | null;
  phone: string | null;
  member_role: string | null;
  role: string | null;
  attended: boolean;
  notes: string | null;
}

const STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "ongoing", label: "Being done" },
  { id: "planned", label: "Planned" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const WINDOWS = [
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "365", label: "Last 12 months" },
  { id: "", label: "All time" },
];

const TYPES = ["meeting", "training", "production", "sales", "distribution", "planning"];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

function StatusBadge({ a }: { a: OversightActivity }) {
  if (a.overdue) {
    return (
      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700" title="Planned for a date that has passed, with no result recorded.">
        Overdue — not recorded
      </span>
    );
  }
  const styles: Record<string, string> = {
    planned: "bg-blue-100 text-blue-800",
    ongoing: "bg-amber-100 text-amber-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-gray-100 text-gray-600",
  };
  const labels: Record<string, string> = {
    planned: "Planned",
    ongoing: "Being done",
    completed: "Done",
    cancelled: "Cancelled",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[a.status]}`}>{labels[a.status]}</span>;
}

function Attendance({ activityId }: { activityId: string }) {
  const [rows, setRows] = useState<Participant[] | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"all" | "attended" | "absent">("all");

  useEffect(() => {
    api
      .get<{ data: Participant[] }>(`/activities/${activityId}/participants`)
      .then((res) => setRows(res.data ?? []))
      .catch((err: any) => setError(err?.message ?? "Could not load the attendance list."));
  }, [activityId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-gray-500">Loading attendance…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-500">No members were registered for this activity.</p>;

  const attended = rows.filter((r) => r.attended);
  const women = attended.filter((r) => (r.gender ?? "").toLowerCase() === "female").length;
  const visible = rows.filter((r) => (show === "all" ? true : show === "attended" ? r.attended : !r.attended));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">
          <strong>{attended.length}</strong> of {rows.length} registered attended
          {attended.length > 0 && <> · {women} women, {attended.length - women} men or unrecorded</>}
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
          {(["all", "attended", "absent"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setShow(s)}
              className={`rounded-md px-2.5 py-1 capitalize ${show === s ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">No.</th>
              <th className="px-3 py-2">Gender</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Attended</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-900">{p.full_name}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{p.membership_number ?? "—"}</td>
                <td className="px-3 py-1.5 capitalize text-gray-600">{p.gender ?? "—"}</td>
                <td className="px-3 py-1.5 capitalize text-gray-600">{p.role ?? p.member_role ?? "member"}</td>
                <td className="px-3 py-1.5">
                  {p.attended ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Attended" />
                  ) : (
                    <XCircle className="h-4 w-4 text-gray-400" aria-label="Absent" />
                  )}
                </td>
                <td className="px-3 py-1.5 text-gray-600">{p.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ActivityOversight() {
  const { user } = useAuth();
  const isSectorOfficer = user?.role === "government" && user?.oversightLevel === "sector";

  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sector, setSector] = useState("");
  const [windowDays, setWindowDays] = useState("90");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<OversightActivity[]>([]);
  const [summary, setSummary] = useState<Stats | null>(null);
  const [breakdown, setBreakdown] = useState<{ by: string; groups: Stats[] } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (sector) params.set("sector", sector);
    if (search.trim()) params.set("search", search.trim());
    if (windowDays) {
      const from = new Date();
      from.setDate(from.getDate() - Number(windowDays));
      params.set("from", from.toISOString().slice(0, 10));
    }
    setLoading(true);
    setError("");
    const t = setTimeout(() => {
      api
        .get<any>(`/activities/oversight?${params.toString()}`)
        .then((res) => {
          setRows(res.data ?? []);
          setSummary(res.summary ?? null);
          setBreakdown(res.breakdown ?? null);
          setTruncated(!!res.truncated);
        })
        .catch((err: any) => setError(err?.message ?? "Could not load activities."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [status, type, sector, windowDays, search]);

  const counts: Record<string, number | undefined> = {
    "": summary?.activities,
    ongoing: summary?.ongoing,
    planned: summary?.planned,
    overdue: summary?.overdue,
    completed: summary?.completed,
    cancelled: summary?.cancelled,
  };
  const groupLabel = breakdown?.by === "district" ? "District" : breakdown?.by === "sector" ? "Sector" : "Cooperative";

  return (
    <div className="space-y-6">
      {/* Headline */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Being done", value: summary.ongoing, Icon: Clock, tone: "text-amber-700" },
            { label: "Planned (upcoming)", value: summary.planned, Icon: CalendarClock, tone: "text-blue-700" },
            { label: "Done", value: summary.completed, Icon: CheckCircle2, tone: "text-green-700" },
            { label: "Overdue, not recorded", value: summary.overdue, Icon: AlertTriangle, tone: summary.overdue ? "text-red-700" : "text-gray-900" },
            { label: "Attendance (done)", value: pct(summary.attendanceRate), Icon: Users, tone: "text-gray-900", sub: `${summary.attended} of ${summary.invited} registered` },
            { label: "Distinct attendees", value: summary.distinct_attendees, Icon: Users, tone: "text-gray-900", sub: `${summary.cooperatives_active} cooperatives held activities` },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                <t.Icon className="h-3.5 w-3.5" /> {t.label}
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
              {t.sub && <p className="text-xs text-gray-500">{t.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="p-5">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                status === s.id ? "border-[#2D6A4F] bg-[#2D6A4F] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {s.label}
              {counts[s.id] != null && (
                <span className={`rounded-full px-1.5 text-xs font-semibold ${status === s.id ? "bg-white/20" : s.id === "overdue" && counts[s.id] ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                  {counts[s.id]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity or cooperative…"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
          />
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Every type</option>
            {TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          {!isSectorOfficer && (
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">Every sector</option>
              {GASABO_SECTORS.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          )}
          <select value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>{w.label}{w.id ? " + upcoming" : ""}</option>
            ))}
          </select>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* By sector / district / cooperative */}
      {breakdown && breakdown.groups.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">By {groupLabel.toLowerCase()}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">{groupLabel}</th>
                  <th className="py-2 pr-3 text-right">Being done</th>
                  <th className="py-2 pr-3 text-right">Planned</th>
                  <th className="py-2 pr-3 text-right">Done</th>
                  <th className="py-2 pr-3 text-right">Overdue</th>
                  <th className="py-2 pr-3 text-right">Cancelled</th>
                  <th className="py-2 pr-3 text-right">Attendance</th>
                  <th className="py-2 pr-3 text-right">Attendees</th>
                  {breakdown.by !== "cooperative" && <th className="py-2 pr-3 text-right">Coops holding activities</th>}
                </tr>
              </thead>
              <tbody>
                {breakdown.groups.map((g) => {
                  const silent = g.activities === 0;
                  return (
                    <tr
                      key={g.name}
                      onClick={() => breakdown.by === "sector" && setSector(sector === g.name ? "" : String(g.name))}
                      className={`border-b border-gray-100 ${breakdown.by === "sector" ? "cursor-pointer hover:bg-gray-50" : ""} ${sector === g.name ? "bg-[#2D6A4F]/5" : ""}`}
                    >
                      <td className="py-2 pr-3 font-medium text-gray-900">
                        {g.name}
                        {silent && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">No activity</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.ongoing}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.planned}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.completed}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${g.overdue ? "font-semibold text-red-700" : ""}`}>{g.overdue}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.cancelled}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${g.attendanceRate != null && g.attendanceRate < 50 ? "text-amber-700" : ""}`}>{pct(g.attendanceRate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.distinct_attendees}</td>
                      {breakdown.by !== "cooperative" && (
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {g.cooperatives_active} / {g.cooperativesTotal ?? g.cooperatives_active}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Attendance is attended ÷ registered, over activities already done.
            {breakdown.by === "sector" && " Click a sector to narrow the list to it."}
          </p>
        </Card>
      )}

      {/* The activities themselves */}
      <div className="space-y-3">
        {loading && <p className="text-sm text-gray-500">Loading activities…</p>}
        {!loading && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-600">
            No activities match these filters.
          </div>
        )}
        {!loading &&
          rows.map((a) => {
            const isOpen = open === a.id;
            const rate = a.invited > 0 ? Math.round((a.attended / a.invited) * 100) : null;
            return (
              <Card key={a.id} className="overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : a.id)} className="w-full p-5 text-left hover:bg-gray-50">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        <span className="text-xs uppercase tracking-wide text-gray-500">{a.type}</span>
                        <StatusBadge a={a} />
                      </div>
                      <h3 className="mt-1 text-lg font-semibold text-gray-900">{a.title}</h3>
                      <p className="text-sm text-gray-600">
                        {a.cooperative_name} · {a.sector} sector{!isSectorOfficer && `, ${a.district}`}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{fmtDate(a.date)}{a.start_time && ` · ${a.start_time.slice(0, 5)}`}{a.end_time && `–${a.end_time.slice(0, 5)}`}</span>
                        {a.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{a.location}</span>}
                      </p>
                    </div>
                    <div className="w-44 text-right">
                      {a.status === "completed" ? (
                        <>
                          <p className="text-sm text-gray-500">Attended</p>
                          <p className="text-lg font-semibold text-gray-900 tabular-nums">
                            {a.attended} / {a.invited}
                            {rate != null && <span className="ml-1 text-sm font-normal text-gray-500">({rate}%)</span>}
                          </p>
                          <div className="mt-1 h-1.5 rounded-full bg-gray-200">
                            <div className={`h-1.5 rounded-full ${rate != null && rate < 50 ? "bg-amber-500" : "bg-[#2D6A4F]"}`} style={{ width: `${rate ?? 0}%` }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-gray-500">Registered</p>
                          <p className="text-lg font-semibold text-gray-900 tabular-nums">{a.invited}</p>
                        </>
                      )}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-4 border-t border-gray-200 bg-gray-50/50 p-5">
                    {a.description && <p className="text-sm text-gray-700">{a.description}</p>}
                    {a.outcome && (
                      <p className="text-sm text-gray-700"><strong>Outcome:</strong> {a.outcome}</p>
                    )}
                    {a.cancellation_reason && (
                      <p className="text-sm text-gray-700"><strong>Cancelled because:</strong> {a.cancellation_reason}</p>
                    )}
                    <Attendance activityId={a.id} />
                  </div>
                )}
              </Card>
            );
          })}
        {truncated && (
          <p className="text-xs text-gray-500">Showing the first 300 activities. Narrow the filters to see the rest.</p>
        )}
      </div>
    </div>
  );
}
