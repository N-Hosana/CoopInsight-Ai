import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { downloadFromApi, printFromApi } from "../services/pdf";
import { MoreInfo } from "../components/MoreInfo";
import { ScopePicker, defaultScope, type ScopeValue } from "../components/ScopePicker";
import { DocumentView, dateTime, type DocumentInfo, type ReportContent } from "../components/DocumentView";
import {
  FileText, Download, Eye, X, Trash2, Printer, LayoutDashboard, Wallet, ClipboardList, ShieldCheck,
  User, FileSpreadsheet, Search, AlertTriangle,
} from "lucide-react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two things on one page, nothing else:
 *
 *   1. CREATE   pick one of a few reports, say who and when it covers
 *   2. LIBRARY  what has been generated — open it, download it, print it
 *
 * The page used to offer nine report types, a filter strip and a schedule
 * section whose schedules nothing ever ran. It now offers the four reports
 * people ask for (a member gets their own statement), and every one is a
 * registered document: letterhead, the date and time it was generated, who
 * generated it, and a verification code anyone can check at /verify.
 *
 * What each account may cover is decided by the server; see ScopePicker.
 */

interface Template {
  id: string;
  type: string;
  name: string;
  title: string;
  description: string;
  position?: boolean;
}

interface ReportRow {
  id: string;
  title: string;
  type: string;
  file_url: string | null;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  created_at: string;
  cooperative_name?: string | null;
  scope_label?: string | null;
  generated_by_name?: string | null;
  reference?: string | null;
  verification_code?: string | null;
}

const TYPE_ICON: Record<string, typeof FileText> = {
  general: LayoutDashboard,
  financial_summary: Wallet,
  requests_register: ClipboardList,
  compliance: ShieldCheck,
  member_statement: User,
};

const shortDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const fileName = (title: string, ext: string) => `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;

export function Reports() {
  const { user } = useAuth();
  const isMember = user?.role === "member";

  const [templates, setTemplates] = useState<Template[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [type, setType] = useState("");
  const [scope, setScope] = useState<ScopeValue>(defaultScope);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<{ row: ReportRow; content: ReportContent; document: DocumentInfo | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api.get<{ data: Template[] }>("/reports/templates"),
        api.get<{ data: ReportRow[] }>("/reports?limit=100"),
      ]);
      setTemplates(t.data ?? []);
      setReports(r.data ?? []);
      setType((current) => current || t.data?.[0]?.type || "");
    } catch (err: any) {
      setError(err?.message ?? "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const chosen = templates.find((t) => t.type === type);

  const run = async (fn: () => Promise<void>, id: string) => {
    setBusy(id);
    setError("");
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!chosen) return;
    setGenerating(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string; data: ReportRow & { content: ReportContent; document: DocumentInfo } }>(
        "/reports/generate",
        {
          type: chosen.type,
          from: scope.from,
          to: scope.to,
          format: "pdf",
          sector: scope.sector || undefined,
          cooperativeId: scope.cooperativeId || undefined,
        }
      );
      setMessage(res.message);
      await load();
      // Show it straight away: the point of generating is to read it.
      if (res.data?.content) setViewing({ row: res.data, content: res.data.content, document: res.data.document ?? null });
    } catch (err: any) {
      setError(err?.message ?? "Could not generate the report.");
    } finally {
      setGenerating(false);
    }
  };

  const open = (row: ReportRow) =>
    run(async () => {
      const res = await api.get<{ data: ReportRow & { content: ReportContent | null; document: DocumentInfo | null } }>(`/reports/${row.id}`);
      if (!res.data?.content) throw new Error("This report has no stored contents. Generate it again.");
      setViewing({ row, content: res.data.content, document: res.data.document });
    }, row.id);

  const download = (row: ReportRow, format: "pdf" | "csv") =>
    run(() => downloadFromApi(`/reports/${row.id}/download?format=${format}`, fileName(row.title, format)), row.id);

  const print = (row: ReportRow) => run(() => printFromApi(`/reports/${row.id}/download?format=pdf`), row.id);

  const remove = (row: ReportRow) => {
    if (!window.confirm(`Delete "${row.title}"? It can be generated again, but it will get a new reference.`)) return;
    run(async () => {
      await api.delete(`/reports/${row.id}`);
      await load();
    }, row.id);
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      [r.title, r.scope_label, r.cooperative_name, r.reference, r.generated_by_name].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [reports, search]);

  if (loading) return <p className="text-gray-500">Loading reports…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
        <p className="mt-1 max-w-3xl text-gray-600">
          {isMember ? "Your statement, ready to download or print." : "Generate, download or print a report."}
        </p>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* ── 1. Create ──────────────────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900">Create a report</h2>

        {templates.length > 1 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => {
              const Icon = TYPE_ICON[t.type] ?? FileText;
              const selected = type === t.type;
              return (
                <button
                  key={t.type}
                  onClick={() => setType(t.type)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                    selected ? "border-[#2D6A4F] bg-[#2D6A4F]/5 ring-1 ring-[#2D6A4F]" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span className={`rounded-lg p-2 ${selected ? "bg-[#2D6A4F] text-white" : "bg-gray-100 text-gray-600"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{t.name}</span>
                    <span className="block text-xs leading-snug text-gray-500">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {templates.length === 1 && chosen && (
          <p className="mt-1 text-sm text-gray-600">{chosen.description}</p>
        )}

        <div className="mt-5 border-t border-gray-100 pt-5">
          <ScopePicker value={scope} onChange={setScope} showPeriod={!chosen?.position} />
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={generate} disabled={!chosen || generating || (!chosen.position && scope.from > scope.to)}>
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {generating ? "Generating…" : `Generate ${chosen?.name ?? "report"}`}
            </span>
          </Button>
        </div>
      </Card>

      {/* ── 2. Library ─────────────────────────────────────────────────── */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {isMember ? "Your statements" : "Generated reports"}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{reports.length}</span>
          </h2>
          {reports.length > 5 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, cooperative, reference…"
                className="w-72 rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              />
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 font-medium text-gray-900">{reports.length ? "Nothing matches that search" : "Nothing generated yet"}</p>
            <p className="mt-1 text-sm text-gray-500">Reports you generate are kept here with their reference.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Report</th>
                  <th className="px-4 py-3 font-medium">Covers</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Generated</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((r) => {
                  const Icon = TYPE_ICON[r.type] ?? FileText;
                  const available = Boolean(r.file_url && r.file_url !== "unavailable");
                  const disabled = busy === r.id;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <button onClick={() => available && open(r)} className="flex items-center gap-3 text-left" disabled={!available}>
                          <span className="rounded-lg bg-[#2D6A4F]/10 p-2 text-[#2D6A4F]"><Icon className="h-4 w-4" /></span>
                          <span className="font-medium text-gray-900 hover:underline">{r.title}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.scope_label ?? r.cooperative_name ?? "All cooperatives"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {r.period_from && r.period_to ? `${shortDate(r.period_from)} – ${shortDate(r.period_to)}` : "As at the day"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {dateTime(r.generated_at ?? r.created_at)}
                        {r.generated_by_name && <span className="block text-xs text-gray-400">{r.generated_by_name}</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.reference ?? "—"}</td>
                      <td className="px-6 py-3">
                        {available ? (
                          <div className="flex items-center justify-end gap-1">
                            <IconButton label="Open" onClick={() => open(r)} disabled={disabled}><Eye className="h-4 w-4" /></IconButton>
                            <IconButton label="Download PDF" onClick={() => download(r, "pdf")} disabled={disabled}><Download className="h-4 w-4" /></IconButton>
                            <IconButton label="Print" onClick={() => print(r)} disabled={disabled}><Printer className="h-4 w-4" /></IconButton>
                            <IconButton label="Delete" onClick={() => remove(r)} disabled={disabled} danger><Trash2 className="h-4 w-4" /></IconButton>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" /> Generate again
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <MoreInfo title="About reports">
        <p>Each report keeps its figures as they stood when it was generated, and shows the date and time, who made it, and a reference.</p>
        <p>The verification code on every page lets anyone check a printed report at <span className="font-mono">/verify</span>.</p>
        <p>Managers report on their cooperative, sector officers on their sector, district and RCA officers on any sector or cooperative.</p>
      </MoreInfo>

      {/* ── The reader ─────────────────────────────────────────────────── */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setViewing(null)}>
          <div className="my-6 w-full max-w-5xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-2xl border-b border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
              <p className="truncate text-sm font-medium text-gray-700">{viewing.content.title}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={busy === viewing.row.id} onClick={() => download(viewing.row, "csv")}>
                  <span className="flex items-center gap-1.5"><FileSpreadsheet className="h-4 w-4" />Spreadsheet</span>
                </Button>
                <Button size="sm" variant="outline" disabled={busy === viewing.row.id} onClick={() => print(viewing.row)}>
                  <span className="flex items-center gap-1.5"><Printer className="h-4 w-4" />Print</span>
                </Button>
                <Button size="sm" disabled={busy === viewing.row.id} onClick={() => download(viewing.row, "pdf")}>
                  <span className="flex items-center gap-1.5"><Download className="h-4 w-4" />Download PDF</span>
                </Button>
                <button onClick={() => setViewing(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-8">
              <DocumentView content={viewing.content} document={viewing.document} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label, onClick, disabled, danger, children,
}: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-lg p-2 text-gray-500 transition-colors disabled:opacity-40 ${
        danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-[#2D6A4F]/10 hover:text-[#2D6A4F]"
      }`}
    >
      {children}
    </button>
  );
}
