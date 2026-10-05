import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import {
  FileText,
  Download,
  Eye,
  X,
  CalendarClock,
  Trash2,
  Plus,
  AlertTriangle,
  Wallet,
  Users,
  PiggyBank,
  Landmark,
  ShieldCheck,
  BarChart3,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This page had eight panels — a template generator, an export-options picker,
 * a charts toggle, a custom report builder, an executive-summary previewer, a
 * report library, an available-reports list and a history archive — and most of
 * them fabricated their contents in the browser and threw them away on reload.
 * The schedules were a hardcoded array with fictional recipients, and the View
 * and Download buttons opened `file_url`, which the backend always set to the
 * literal string "pending".
 *
 * What is actually needed is three things, so there are three:
 *
 *   1. GENERATE   pick what kind of report, over what period, for whom
 *   2. YOUR REPORTS  what has been generated, grouped by kind, each one
 *                    genuinely viewable and downloadable
 *   3. SCHEDULES  reports that run on a timetable, created and deleted here
 *
 * The classifications are kept — they are how anyone finds anything — but every
 * button now does what it says.
 */

interface Template {
  id: string;
  name: string;
  description: string;
  type: string;
  parameters: string[];
}

interface ReportRow {
  id: string;
  title: string;
  type: string;
  format: string;
  file_url: string | null;
  row_count: number | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  created_at: string;
  cooperative_id: string | null;
}

interface ReportContent {
  title: string;
  type: string;
  cooperativeName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  summary: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; note?: string; columns: string[]; rows: Array<Array<string | number | null>> }>;
  rowCount: number;
}

interface Schedule {
  id: string;
  title: string;
  type: string;
  frequency: string;
  format: string;
  recipients: string[] | string;
  next_run_at: string | null;
  active: boolean;
}

/** How each classification is presented. Icons make the list scannable. */
const TYPE_STYLE: Record<string, { icon: typeof FileText; tone: string }> = {
  financial_summary: { icon: Wallet, tone: "bg-[#2D6A4F]/10 text-[#2D6A4F]" },
  member_activity: { icon: Users, tone: "bg-indigo-100 text-indigo-700" },
  savings_growth: { icon: PiggyBank, tone: "bg-emerald-100 text-emerald-700" },
  loan_performance: { icon: Landmark, tone: "bg-amber-100 text-amber-800" },
  compliance: { icon: ShieldCheck, tone: "bg-purple-100 text-purple-700" },
  budget_variance: { icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
  annual: { icon: FileText, tone: "bg-gray-100 text-gray-700" },
};

const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annually"];

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** First of the month twelve months back, and today — a sensible default span. */
const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getFullYear() - 1, to.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

export function Reports() {
  const { user } = useAuth();
  const isOversight = ["admin", "generalManager", "government"].includes(user?.role ?? "");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [cooperatives, setCooperatives] = useState<Array<{ id: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const range = defaultRange();
  const [form, setForm] = useState({
    type: "financial_summary",
    from: range.from,
    to: range.to,
    cooperativeId: "",
  });

  const [filter, setFilter] = useState("All");
  const [viewing, setViewing] = useState<ReportContent | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    type: "financial_summary",
    frequency: "monthly",
    recipients: user?.email ?? "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [t, r, s] = await Promise.all([
        api.get<{ data: Template[] }>("/reports/templates"),
        api.get<{ data: ReportRow[] }>("/reports?limit=50"),
        api.get<{ data: Schedule[] }>("/reports/schedules"),
      ]);
      setTemplates(t.data ?? []);
      setReports(r.data ?? []);
      setSchedules(s.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (isOversight) {
      api
        .get<{ data: Array<{ id: string; name: string }> }>("/cooperatives?limit=100")
        .then((r) => setCooperatives(r.data ?? []))
        .catch(() => setCooperatives([]));
    }
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string }>("/reports/generate", {
        type: form.type,
        from: form.from,
        to: form.to,
        format: "csv",
        cooperativeId: form.cooperativeId || undefined,
      });
      setMessage(res.message);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not generate the report.");
    } finally {
      setGenerating(false);
    }
  };

  /** Opens the stored content in a panel — this is what "View" means. */
  const view = async (report: ReportRow) => {
    setBusy(report.id);
    setError("");
    try {
      const token = localStorage.getItem("coopinsight_access_token");
      const res = await fetch(`${BASE_URL}/reports/${report.id}/download?format=json`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Could not open this report.");
      }
      setViewing(await res.json());
    } catch (err: any) {
      setError(err?.message ?? "Could not open this report.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Downloads the real file.
   *
   * It goes through fetch rather than a plain link because the endpoint needs
   * the bearer token; the blob is then handed to the browser as a save.
   */
  const download = async (report: ReportRow, format: "csv" | "json") => {
    setBusy(report.id);
    setError("");
    try {
      const token = localStorage.getItem("coopinsight_access_token");
      const res = await fetch(`${BASE_URL}/reports/${report.id}/download?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Could not download this report.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? "Could not download this report.");
    } finally {
      setBusy(null);
    }
  };

  const createSchedule = async () => {
    const recipients = scheduleForm.recipients
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!recipients.length) return setError("Who should the scheduled report go to?");

    setBusy("schedule");
    setError("");
    try {
      await api.post("/reports/schedule", {
        type: scheduleForm.type,
        frequency: scheduleForm.frequency,
        format: "csv",
        recipients,
      });
      setMessage("Schedule created.");
      setShowSchedule(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not create the schedule.");
    } finally {
      setBusy(null);
    }
  };

  const deleteSchedule = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await api.delete(`/reports/schedules/${id}`);
      setMessage("Schedule removed.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove the schedule.");
    } finally {
      setBusy(null);
    }
  };

  const nameFor = (type: string) =>
    templates.find((t) => t.type === type)?.name ?? type.replace(/_/g, " ");

  const visible = useMemo(
    () => (filter === "All" ? reports : reports.filter((r) => r.type === filter)),
    [reports, filter]
  );

  /** Counts per classification, so the filter chips carry their own evidence. */
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of reports) out[r.type] = (out[r.type] ?? 0) + 1;
    return out;
  }, [reports]);

  if (loading) return <p className="text-gray-500">Loading reports…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-600 mt-1 max-w-3xl">
          Generate a report from the cooperative's own records, read it here, and download it as a
          spreadsheet. Every report is a snapshot: it keeps the figures as they stood when it was
          run, so it still means the same thing when it is read months later.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── 1. Generate ──────────────────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900">Generate a report</h2>
        <p className="mt-1 text-sm text-gray-600">
          {templates.find((t) => t.type === form.type)?.description ??
            "Choose what kind of report you need."}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Kind of report"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={templates.map((t) => ({ value: t.type, label: t.name }))}
          />
          <Input
            label="From"
            type="date"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
          <Input
            label="To"
            type="date"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
          {isOversight ? (
            <Select
              label="Cooperative"
              value={form.cooperativeId}
              onChange={(e) => setForm({ ...form, cooperativeId: e.target.value })}
              options={[
                { value: "", label: "All in scope" },
                ...cooperatives.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Cooperative</label>
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                {user?.cooperativeName ?? "Your cooperative"}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5">
          <Button onClick={generate} disabled={generating}>
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {generating ? "Generating…" : "Generate"}
            </span>
          </Button>
        </div>
      </Card>

      {/* ── 2. What has been generated ───────────────────────────────────── */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Your reports</h2>
          <div className="flex flex-wrap gap-2">
            {["All", ...Object.keys(counts)].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === t
                    ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "All" ? "All" : nameFor(t)}
                <span
                  className={`rounded-full px-1.5 font-semibold ${
                    filter === t ? "bg-white/20" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t === "All" ? reports.length : counts[t]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Card className="p-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-3 font-medium text-gray-900">Nothing generated yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Use the panel above — a report takes a moment and is saved here.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => {
              const style = TYPE_STYLE[r.type] ?? TYPE_STYLE.annual;
              const Icon = style.icon;
              const downloadable = Boolean(r.file_url && r.file_url !== "unavailable");
              return (
                <Card key={r.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`rounded-lg p-2.5 ${style.tone}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900">{r.title}</p>
                        <p className="text-sm text-gray-500">
                          {nameFor(r.type)}
                          {r.period_from && r.period_to &&
                            ` · ${formatDate(r.period_from)} to ${formatDate(r.period_to)}`}
                          {` · generated ${formatDate(r.generated_at ?? r.created_at)}`}
                        </p>
                        {r.row_count != null && (
                          <p className="text-xs text-gray-400">
                            {r.row_count} row{r.row_count === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {downloadable ? (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => view(r)}>
                            <span className="flex items-center gap-1.5">
                              <Eye className="h-4 w-4" />
                              View
                            </span>
                          </Button>
                          <Button size="sm" disabled={busy === r.id} onClick={() => download(r, "csv")}>
                            <span className="flex items-center gap-1.5">
                              <Download className="h-4 w-4" />
                              CSV
                            </span>
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => download(r, "json")}>
                            JSON
                          </Button>
                        </>
                      ) : (
                        // Honest about the old rows rather than offering a
                        // button that opens nothing.
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          No file — generate it again
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 3. Schedules ─────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 h-5 w-5 text-gray-700" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Scheduled reports</h2>
              <p className="text-sm text-gray-600">
                Reports that run on a timetable and go out to a named list of people.
              </p>
            </div>
          </div>
          {!showSchedule && (
            <Button variant="outline" onClick={() => setShowSchedule(true)}>
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add a schedule
              </span>
            </Button>
          )}
        </div>

        {showSchedule && (
          <div className="mt-5 space-y-4 border-t border-gray-200 pt-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Kind of report"
                value={scheduleForm.type}
                onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                options={templates.map((t) => ({ value: t.type, label: t.name }))}
              />
              <Select
                label="How often"
                value={scheduleForm.frequency}
                onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}
                options={FREQUENCIES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))}
              />
              <Input
                label="Send to (comma separated)"
                value={scheduleForm.recipients}
                onChange={(e) => setScheduleForm({ ...scheduleForm, recipients: e.target.value })}
                placeholder="name@example.rw, other@example.rw"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy === "schedule"} onClick={createSchedule}>
                {busy === "schedule" ? "Saving…" : "Create the schedule"}
              </Button>
              <Button variant="outline" onClick={() => setShowSchedule(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {schedules.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing is scheduled. Reports are only produced when someone asks for one.
            </p>
          ) : (
            schedules.map((s) => {
              const recipients = Array.isArray(s.recipients)
                ? s.recipients
                : (() => {
                    try {
                      return JSON.parse(String(s.recipients));
                    } catch {
                      return [String(s.recipients)];
                    }
                  })();
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4"
                >
                  <div>
                    <p className="font-medium text-gray-900">{s.title || nameFor(s.type)}</p>
                    <p className="text-sm text-gray-600 capitalize">
                      {s.frequency}
                      {s.next_run_at && ` · next run ${formatDate(s.next_run_at)}`}
                    </p>
                    <p className="text-xs text-gray-500">To: {recipients.join(", ")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === s.id}
                    onClick={() => deleteSchedule(s.id)}
                  >
                    <span className="flex items-center gap-1.5">
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </span>
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* ── The viewer ───────────────────────────────────────────────────── */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-5xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{viewing.title}</h2>
                <p className="text-sm text-gray-500">
                  {viewing.cooperativeName ?? "All cooperatives in scope"}
                  {viewing.periodFrom && viewing.periodTo &&
                    ` · ${formatDate(viewing.periodFrom)} to ${formatDate(viewing.periodTo)}`}
                  {` · generated ${formatDate(viewing.generatedAt)}`}
                </p>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              {viewing.summary.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {viewing.summary.map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-200 p-4">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {viewing.sections.map((section) => (
                <div key={section.title}>
                  <p className="font-medium text-gray-900">{section.title}</p>
                  {section.note && <p className="text-xs text-gray-500">{section.note}</p>}
                  <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {section.columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-700">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {section.rows.length === 0 ? (
                          <tr>
                            <td colSpan={section.columns.length} className="px-3 py-4 text-center text-gray-500">
                              Nothing in this period.
                            </td>
                          </tr>
                        ) : (
                          section.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td key={j} className="whitespace-nowrap px-3 py-2 text-gray-800">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-200 p-6">
              <Button variant="outline" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
