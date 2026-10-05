import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Plus, CalendarPlus, Calendar, BarChart3, ChevronLeft, ChevronRight, MapPin, Users } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { downloadIcs } from "../services/calendar";

/**
 * The cooperative's activities: planned, under way, done.
 *
 * This page read `response.data.activities` from an endpoint that returns the
 * list as `data`, and expected `scheduled_date` and capitalised statuses where
 * the API sends `date` and lowercase — so it always said "No activities found".
 * "Export" now produces a calendar file of the activities on screen; written
 * reports belong on the Reports page.
 */

type Status = "planned" | "ongoing" | "completed" | "cancelled";

interface Activity {
  id: string;
  type: string;
  title: string;
  cooperative_name: string;
  cooperative_id: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: Status;
  location: string | null;
  participant_count: number;
  created_by_name: string | null;
}

interface Summary {
  totalActivities: number;
  completed: number;
  planned: number;
  ongoing: number;
  cancelled: number;
  completionRate: number;
}

const STATUS_LABEL: Record<Status, string> = {
  planned: "Planned",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<Status, string> = {
  planned: "bg-gray-100 text-gray-800",
  ongoing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

const dayKey = (d: string) => d.slice(0, 10);
const formatDate = (d: string) =>
  d ? new Date(`${dayKey(d)}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "N/A";

export function Activities() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [status, setStatus] = useState<"" | Status>("");
  const [cooperative, setCooperative] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const canManage = ["manager", "cooperative", "admin", "generalManager"].includes(user?.role ?? "");
  const ownCooperativeOnly = ["manager", "cooperative", "member"].includes(user?.role ?? "");

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: "1", limit: "100" });
      if (status) params.set("status", status);
      if (dateRange.start) params.set("from", dateRange.start);
      if (dateRange.end) params.set("to", dateRange.end);
      const [list, totals] = await Promise.all([
        api.get<{ data: Activity[] }>(`/activities?${params.toString()}`),
        api.get<{ data: Summary }>(
          `/activities/summary${dateRange.start || dateRange.end ? `?${new URLSearchParams({ ...(dateRange.start ? { from: dateRange.start } : {}), ...(dateRange.end ? { to: dateRange.end } : {}) })}` : ""}`
        ),
      ]);
      setActivities(
        (list.data ?? []).map((a: any) => ({ ...a, participant_count: Number(a.participant_count ?? 0) }))
      );
      setSummary(totals.data ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to load activities.");
    } finally {
      setLoading(false);
    }
  }, [status, dateRange.start, dateRange.end]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm("Delete this planned activity?")) return;
    try {
      await api.delete(`/activities/${id}`);
      fetchActivities();
    } catch (err: any) {
      alert(err?.message || "Failed to delete the activity.");
    }
  };

  const cooperativeOptions = useMemo(
    () => Array.from(new Set(activities.map((a) => a.cooperative_name).filter(Boolean))).sort(),
    [activities]
  );

  const filteredActivities = activities.filter((a) => {
    if (cooperative && a.cooperative_name !== cooperative) return false;
    const q = searchQuery.trim().toLowerCase();
    return (
      !q ||
      a.title.toLowerCase().includes(q) ||
      (a.description ?? "").toLowerCase().includes(q) ||
      (a.cooperative_name ?? "").toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q)
    );
  });

  const exportCalendar = () => {
    downloadIcs(
      filteredActivities.map((a) => ({
        id: a.id,
        title: ownCooperativeOnly ? a.title : `${a.title} — ${a.cooperative_name}`,
        date: a.date,
        startTime: a.start_time,
        endTime: a.end_time,
        location: a.location,
        description: a.description,
        status: a.status,
      })),
      `activities-${new Date().toISOString().slice(0, 10)}`,
      ownCooperativeOnly && user?.cooperativeName ? `${user.cooperativeName} activities` : "Cooperative activities"
    );
  };

  // ── Month grid ─────────────────────────────────────────────────────────────
  const byDay = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of filteredActivities) {
      const k = dayKey(a.date);
      map.set(k, [...(map.get(k) ?? []), a]);
    }
    return map;
  }, [filteredActivities]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    // Weeks start on Monday.
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: Array<{ key: string; day: number } | null> = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ key, day: d });
    }
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-[1440px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Activities</h1>
          <p className="text-gray-600 mt-1">
            {ownCooperativeOnly
              ? `What ${user?.cooperativeName ?? "your cooperative"} has planned, has under way and has done`
              : "Cooperative activities, outcomes and attendance"}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={exportCalendar} disabled={!filteredActivities.length}>
            <CalendarPlus className="w-4 h-4 mr-2" />
            Export calendar
          </Button>
          {canManage && (
            <Button onClick={() => navigate("/activities/new")}>
              <Plus className="w-4 h-4 inline-block mr-2" />
              Add activity
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex gap-2">
          {(["list", "calendar"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                viewMode === m ? "bg-[#2D6A4F] text-white" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {m === "calendar" && <Calendar className="w-4 h-4 inline mr-2" />}
              {m === "list" ? "List view" : "Calendar view"}
            </button>
          ))}
        </div>
        <div className={`grid w-full grid-cols-1 gap-3 sm:grid-cols-2 ${ownCooperativeOnly ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Title, type…"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
            />
          </div>
          {!ownCooperativeOnly && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Cooperative</label>
              <select className="w-full rounded-lg border border-gray-300 px-4 py-3" value={cooperative} onChange={(e) => setCooperative(e.target.value)}>
                <option value="">All cooperatives</option>
                {cooperativeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select className="w-full rounded-lg border border-gray-300 px-4 py-3" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From</label>
            <input type="date" className="w-full rounded-lg border border-gray-300 px-4 py-3" value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To</label>
            <input type="date" className="w-full rounded-lg border border-gray-300 px-4 py-3" value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} />
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-500">Loading activities…</div>}
      {error && !loading && <div className="text-center py-12 text-red-600">{error}</div>}

      {!loading && !error && viewMode === "list" && (
        <div className="space-y-4">
          {filteredActivities.length === 0 && <div className="text-center py-12 text-gray-500">No activities found.</div>}
          {filteredActivities.map((a) => (
            <Card key={a.id} className="p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/activities/${a.id}`)}>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h3 className="font-semibold text-gray-900 text-lg">{a.title}</h3>
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                {a.status === "planned" && dayKey(a.date) < todayKey && (
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-800">Date passed — not recorded</span>
                )}
                {!ownCooperativeOnly && (
                  <span className="text-sm font-medium px-3 py-1 rounded-full bg-slate-100 text-slate-700">{a.cooperative_name}</span>
                )}
              </div>
              {a.description && <p className="text-gray-600 mb-3">{a.description}</p>}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" />{formatDate(a.date)}{a.start_time && ` · ${a.start_time.slice(0, 5)}`}</span>
                {a.location && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{a.location}</span>}
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" />{a.participant_count} registered</span>
                <span className="capitalize text-gray-500">{a.type}</span>
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-gray-200">
                {a.status === "planned" && canManage && (
                  <button className="text-red-500 hover:text-red-700 text-sm font-medium" onClick={(e) => handleDelete(a.id, e)}>
                    Delete
                  </button>
                )}
                <span className="text-[#2D6A4F] text-sm font-medium">View details →</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && viewMode === "calendar" && (
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border p-2 hover:bg-gray-50" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </h2>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border p-2 hover:bg-gray-50" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-sm">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="bg-gray-50 px-2 py-1.5 text-center text-xs font-medium uppercase text-gray-500">{d}</div>
            ))}
            {cells.map((c, i) => (
              <div key={c?.key ?? `blank-${i}`} className={`min-h-[96px] bg-white p-1.5 ${c?.key === todayKey ? "ring-2 ring-inset ring-[#2D6A4F]" : ""}`}>
                {c && (
                  <>
                    <p className="text-xs text-gray-500">{c.day}</p>
                    <div className="mt-1 space-y-1">
                      {(byDay.get(c.key) ?? []).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => navigate(`/activities/${a.id}`)}
                          className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs ${STATUS_STYLE[a.status]}`}
                          title={`${a.title}${ownCooperativeOnly ? "" : ` — ${a.cooperative_name}`}`}
                        >
                          {a.start_time ? `${a.start_time.slice(0, 5)} ` : ""}{a.title}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {summary && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <BarChart3 className="w-5 h-5 text-[#2D6A4F]" />
            <h2 className="text-lg font-semibold text-gray-900">At a glance</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Total", value: summary.totalActivities, tone: "bg-gray-50 text-gray-900" },
              { label: "Completed", value: summary.completed, tone: "bg-green-50 text-green-900" },
              { label: "Ongoing", value: summary.ongoing, tone: "bg-blue-50 text-blue-900" },
              { label: "Planned", value: summary.planned, tone: "bg-gray-50 text-gray-900" },
              { label: "Completion rate", value: `${summary.completionRate}%`, tone: "bg-[#2D6A4F]/5 text-[#1b4332]" },
            ].map((t) => (
              <div key={t.label} className={`rounded-lg p-4 ${t.tone}`}>
                <p className="text-sm opacity-80 mb-2">{t.label}</p>
                <p className="text-2xl font-bold">{t.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
