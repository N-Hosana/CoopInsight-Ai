import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { downloadFromApi } from "../services/pdf";
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
  CalendarCheck,
  Stethoscope,
  BookOpen,
} from "lucide-react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The reports a cooperative is actually asked for — by its general assembly,
 * its sector cooperative officer, the RCA or a lender — generated from its own
 * records and downloaded as a PDF: letterhead, period, a plain reading of the
 * figures, tables with totals, and the offices that sign it.
 *
 *   1. GENERATE      choose the report and the period
 *   2. YOUR REPORTS  what has been generated; read it here or download it
 *   3. SCHEDULES     reports that run on a timetable
 *
 * A manager's reports are about their own cooperative. Officers and
 * administrators choose a cooperative, or leave it blank for every one in
 * their reach.
 */

interface Template {
  id: string;
  name: string;
  description: string;
  audience?: string;
  type: string;
  /** A position report describes where things stand today; it takes no period. */
  position?: boolean;
}

interface ReportRow {
  id: string;
  title: string;
  type: string;
  format: string;
  file_url: string | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  created_at: string;
  cooperative_id: string | null;
  cooperative_name?: string | null;
  generated_by_name?: string | null;
}

interface ReportSection {
  title: string;
  note?: string;
  paragraphs?: string[];
  facts?: Array<{ label: string; value: string }>;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  totals?: Array<string | number | null>;
}

interface ReportContent {
  title: string;
  type: string;
  cooperativeName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  preparedBy?: string | null;
  narrative?: string[];
  summary: Array<{ label: string; value: string }>;
  sections: ReportSection[];
  signatories?: string[];
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

const TYPE_STYLE: Record<string, { icon: typeof FileText; tone: string }> = {
  financial_summary: { icon: Wallet, tone: "bg-[#2D6A4F]/10 text-[#2D6A4F]" },
  savings_growth: { icon: PiggyBank, tone: "bg-emerald-100 text-emerald-700" },
  loan_performance: { icon: Landmark, tone: "bg-amber-100 text-amber-800" },
  member_activity: { icon: Users, tone: "bg-indigo-100 text-indigo-700" },
  activities: { icon: CalendarCheck, tone: "bg-teal-100 text-teal-700" },
  budget_variance: { icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
  compliance: { icon: ShieldCheck, tone: "bg-purple-100 text-purple-700" },
  audit: { icon: Stethoscope, tone: "bg-rose-100 text-rose-700" },
  annual: { icon: BookOpen, tone: "bg-gray-100 text-gray-700" },
};

const FREQUENCIES = ["monthly", "quarterly", "annually"];

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The periods a cooperative reports on, so nobody has to type dates. */
function periods(): Array<{ id: string; label: string; from: string; to: string }> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  return [
    { id: "this_year", label: `This year so far (${y})`, from: iso(new Date(y, 0, 1)), to: iso(now) },
    { id: "last_year", label: `Last year (${y - 1})`, from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) },
    { id: "last_quarter", label: "Last quarter", from: iso(new Date(y, q * 3 - 3, 1)), to: iso(new Date(y, q * 3, 0)) },
    { id: "last_month", label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { id: "last_12", label: "Last 12 months", from: iso(new Date(y - 1, m, now.getDate() + 1)), to: iso(now) },
  ];
}

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

  const presets = useMemo(periods, []);
  const [form, setForm] = useState({
    type: "financial_summary",
    preset: "this_year",
    from: presets[0].from,
    to: presets[0].to,
    cooperativeId: "",
  });

  const [filter, setFilter] = useState("All");
  const [viewing, setViewing] = useState<{ row: ReportRow; content: ReportContent } | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = templates.find((t) => t.type === form.type);

  const generate = async () => {
    setGenerating(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string; data: ReportRow & { content: ReportContent } }>("/reports/generate", {
        type: form.type,
        from: form.from,
        to: form.to,
        format: "pdf",
        cooperativeId: form.cooperativeId || undefined,
      });
      setMessage(res.message);
      await load();
      // Show it straight away: the point of generating is to read it.
      if (res.data?.content) setViewing({ row: res.data, content: res.data.content });
    } catch (err: any) {
      setError(err?.message ?? "Could not generate the report.");
    } finally {
      setGenerating(false);
    }
  };

  /** Opens the stored report on screen. */
  const view = async (report: ReportRow) => {
    setBusy(report.id);
    setError("");
    try {
      const res = await api.get<{ data: ReportRow & { content: ReportContent | null } }>(`/reports/${report.id}`);
      if (!res.data?.content) throw new Error("This report has no stored contents. Generate it again.");
      setViewing({ row: report, content: res.data.content });
    } catch (err: any) {
      setError(err?.message ?? "Could not open this report.");
    } finally {
      setBusy(null);
    }
  };

  /** Downloads the report: a PDF to print and sign, or the figures for a spreadsheet. */
  const download = async (report: ReportRow, format: "pdf" | "csv") => {
    setBusy(report.id);
    setError("");
    try {
      await downloadFromApi(
        `/reports/${report.id}/download?format=${format}`,
        `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format}`
      );
    } catch (err: any) {
      setError(err?.message ?? "Could not download this report.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (report: ReportRow) => {
    if (!window.confirm(`Delete "${report.title}"? The figures can be generated again.`)) return;
    setBusy(report.id);
    setError("");
    try {
      await api.delete(`/reports/${report.id}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not delete this report.");
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
        format: "pdf",
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
          {isOversight
            ? "Reports on the cooperatives you supervise, built from their own records."
            : `The reports ${user?.cooperativeName ?? "your cooperative"} is asked for — by its general assembly, the sector officer, the RCA or a lender — built from its own records.`}{" "}
          Each one downloads as a PDF ready to print and sign, and keeps the figures as they stood on
          the day it was generated.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── 1. Generate ──────────────────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900">Generate a report</h2>
        <p className="mt-1 text-sm text-gray-600">Choose the report you need.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const style = TYPE_STYLE[t.type] ?? TYPE_STYLE.annual;
            const Icon = style.icon;
            const selected = form.type === t.type;
            return (
              <button
                key={t.type}
                onClick={() => setForm({ ...form, type: t.type })}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selected ? "border-[#2D6A4F] bg-[#2D6A4F]/5 ring-1 ring-[#2D6A4F]" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-lg p-2 ${style.tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="font-semibold text-gray-900">{t.name}</p>
                </div>
                <p className="mt-2 text-sm text-gray-600">{t.description}</p>
                {t.audience && <p className="mt-2 text-xs text-gray-400">For: {t.audience}</p>}
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-4 border-t border-gray-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          {chosen?.position ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-sm font-medium text-gray-700">Period</label>
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                This report shows the position as it stands today, so it takes no period.
              </p>
            </div>
          ) : (
            <>
              <Select
                label="Period"
                value={form.preset}
                onChange={(e) => {
                  const p = presets.find((x) => x.id === e.target.value);
                  setForm(p ? { ...form, preset: p.id, from: p.from, to: p.to } : { ...form, preset: "custom" });
                }}
                options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Choose dates…" }]}
              />
              <Input label="From" type="date" value={form.from}
                onChange={(e) => setForm({ ...form, preset: "custom", from: e.target.value })} />
              <Input label="To" type="date" value={form.to}
                onChange={(e) => setForm({ ...form, preset: "custom", to: e.target.value })} />
            </>
          )}
          {isOversight ? (
            <Select
              label="Cooperative"
              value={form.cooperativeId}
              onChange={(e) => setForm({ ...form, cooperativeId: e.target.value })}
              options={[{ value: "", label: "All in my scope" }, ...cooperatives.map((c) => ({ value: c.id, label: c.name }))]}
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
          <Button onClick={generate} disabled={generating || (!chosen?.position && form.from > form.to)}>
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {generating ? "Generating…" : `Generate the ${chosen?.name ?? "report"}`}
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
                  filter === t ? "border-[#2D6A4F] bg-[#2D6A4F] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "All" ? "All" : nameFor(t)}
                <span className={`rounded-full px-1.5 font-semibold ${filter === t ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>
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
            <p className="mt-1 text-sm text-gray-500">Choose a report above. It is saved here once generated.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => {
              const style = TYPE_STYLE[r.type] ?? TYPE_STYLE.annual;
              const Icon = style.icon;
              const available = Boolean(r.file_url && r.file_url !== "unavailable");
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
                          {isOversight && `${r.cooperative_name ?? "All cooperatives"} · `}
                          {r.period_from && r.period_to
                            ? `${formatDate(r.period_from)} to ${formatDate(r.period_to)}`
                            : "Position on the day"}
                        </p>
                        <p className="text-xs text-gray-400">
                          Generated {formatDate(r.generated_at ?? r.created_at)}
                          {r.generated_by_name && ` by ${r.generated_by_name}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {available ? (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => view(r)}>
                            <span className="flex items-center gap-1.5"><Eye className="h-4 w-4" />Read</span>
                          </Button>
                          <Button size="sm" disabled={busy === r.id} onClick={() => download(r, "pdf")}>
                            <span className="flex items-center gap-1.5"><Download className="h-4 w-4" />PDF</span>
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => download(r, "csv")} >
                            Spreadsheet
                          </Button>
                          <button onClick={() => remove(r)} disabled={busy === r.id} className="p-2 text-gray-400 hover:text-red-600" aria-label="Delete report">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
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
              <p className="text-sm text-gray-600">Reports that run on a timetable and go out to a named list of people.</p>
            </div>
          </div>
          {!showSchedule && (
            <Button variant="outline" onClick={() => setShowSchedule(true)}>
              <span className="flex items-center gap-2"><Plus className="h-4 w-4" />Add a schedule</span>
            </Button>
          )}
        </div>

        {showSchedule && (
          <div className="mt-5 space-y-4 border-t border-gray-200 pt-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Report" value={scheduleForm.type}
                onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                options={templates.map((t) => ({ value: t.type, label: t.name }))} />
              <Select label="How often" value={scheduleForm.frequency}
                onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}
                options={FREQUENCIES.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
              <Input label="Send to (comma separated)" value={scheduleForm.recipients}
                onChange={(e) => setScheduleForm({ ...scheduleForm, recipients: e.target.value })}
                placeholder="name@example.rw, other@example.rw" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy === "schedule"} onClick={createSchedule}>
                {busy === "schedule" ? "Saving…" : "Create the schedule"}
              </Button>
              <Button variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {schedules.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing is scheduled. Reports are only produced when someone asks for one.</p>
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
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
                  <div>
                    <p className="font-medium text-gray-900">{s.title || nameFor(s.type)}</p>
                    <p className="text-sm text-gray-600 capitalize">
                      {s.frequency}
                      {s.next_run_at && ` · next run ${formatDate(s.next_run_at)}`}
                    </p>
                    <p className="text-xs text-gray-500">To: {recipients.join(", ")}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => deleteSchedule(s.id)}>
                    <span className="flex items-center gap-1.5"><Trash2 className="h-4 w-4" />Remove</span>
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* ── The reader ───────────────────────────────────────────────────── */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-5xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
              <div>
                <p className="text-sm font-semibold text-[#2D6A4F]">{viewing.content.cooperativeName ?? "All cooperatives in scope"}</p>
                <h2 className="text-xl font-semibold text-gray-900">{viewing.content.title}</h2>
                <p className="text-sm text-gray-500">
                  {viewing.content.periodFrom && viewing.content.periodTo
                    ? `${formatDate(viewing.content.periodFrom)} to ${formatDate(viewing.content.periodTo)}`
                    : "Position on the day"}
                  {` · generated ${formatDate(viewing.content.generatedAt)}`}
                  {viewing.content.preparedBy && ` by ${viewing.content.preparedBy}`}
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              {(viewing.content.narrative ?? []).map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-gray-800">{p}</p>
              ))}

              {viewing.content.summary.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {viewing.content.summary.map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-200 p-4">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {viewing.content.sections.map((section) => (
                <div key={section.title}>
                  <p className="font-semibold text-gray-900">{section.title}</p>
                  {section.note && <p className="text-xs text-gray-500">{section.note}</p>}
                  {(section.paragraphs ?? []).map((p, i) => (
                    <p key={i} className="mt-2 text-sm leading-relaxed text-gray-800">{p}</p>
                  ))}
                  {section.facts && section.facts.length > 0 && (
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {section.facts.map((f) => (
                        <div key={f.label} className="flex justify-between gap-4 border-b border-gray-100 py-1">
                          <dt className="text-gray-500">{f.label}</dt>
                          <dd className="text-right font-medium text-gray-900">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {section.columns && section.columns.length > 0 && (
                    <div className="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50">
                          <tr>
                            {section.columns.map((c, i) => (
                              <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-700">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {(section.rows ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={section.columns.length} className="px-3 py-4 text-center text-gray-500">
                                Nothing recorded for this period.
                              </td>
                            </tr>
                          ) : (
                            (section.rows ?? []).map((row, i) => (
                              <tr key={i}>
                                {row.map((cell, j) => (
                                  <td key={j} className="px-3 py-2 text-gray-800">{cell}</td>
                                ))}
                              </tr>
                            ))
                          )}
                          {section.totals && (
                            <tr className="bg-gray-50 font-semibold">
                              {section.totals.map((cell, j) => (
                                <td key={j} className="px-3 py-2 text-gray-900">{cell}</td>
                              ))}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {viewing.content.signatories && viewing.content.signatories.length > 0 && (
                <p className="border-t border-gray-200 pt-4 text-xs text-gray-500">
                  The PDF carries signature lines for: {viewing.content.signatories.join(", ")}.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-200 p-6">
              <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
              <Button disabled={busy === viewing.row.id} onClick={() => download(viewing.row, "pdf")}>
                <span className="flex items-center gap-2"><Download className="h-4 w-4" />Download PDF</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
