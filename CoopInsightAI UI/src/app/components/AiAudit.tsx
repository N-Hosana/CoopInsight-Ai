import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, AlertTriangle, AlertOctagon, Info, CheckCircle2, PlayCircle, Download, Printer,
  History, ChevronRight, RefreshCw, ArrowDownRight, ArrowUpRight, Minus, Building2, MapPin,
} from "lucide-react";
import { api } from "../services/api";
import { downloadPdf, printPdf } from "../services/pdf";
import { loadScopeOptions, type ScopeOptions } from "./ScopePicker";
import { Card } from "./Card";
import { Button } from "./Button";
import { MoreInfo } from "./MoreInfo";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AI AUDIT — run on demand, from what the AI service finds
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Replaces the Monthly audit page, which showed stored rows from earlier runs
 * and so said the same thing every visit. Here the officer or manager picks a
 * cooperative (or a whole sector) and a month, and the backend
 * (services/aiAudit.ts) asks the AI service for that month's functionality
 * scores, transaction anomalies, member engagement, peer standing and outlook,
 * and turns them into a score, findings with their evidence and source, and
 * strengths. Every run is kept, so the next one can say what changed.
 */

interface Part { key: string; label: string; weight: number; score: number | null; note: string }
interface Finding { severity: "high" | "medium" | "low"; area: string; title: string; evidence: string; source: string; action?: string }
interface Result {
  id?: string;
  cooperativeId: string;
  cooperativeName: string;
  sector: string | null;
  period: string;
  periodLabel: string;
  score: number | null;
  band: string;
  verdict: string;
  parts: Part[];
  findings: Finding[];
  strengths: string[];
  previousPeriod: { period: string; score: number | null; band: string | null } | null;
  sinceLastRun: { runAt: string; score: number | null; band: string; period: string } | null;
  sources: string[];
  unreachable: string[];
  runAt: string;
  runByName?: string;
}
interface ManyRow {
  id: string | null; cooperativeId: string; cooperativeName: string; sector: string | null;
  score: number | null; band: string; findings: number; high: number; topFinding: string | null; previousScore: number | null;
}
interface HistoryRow {
  id: string; cooperative_name: string; sector: string | null; period: string; score: number | null; band: string;
  findings_count: number; high_count: number; run_at: string; run_by_name: string | null;
}

// Status colours carry the rating — always with an icon and a word.
const BAND: Record<string, { label: string; tone: string; Icon: typeof ShieldCheck }> = {
  sound: { label: "Sound", tone: "bg-[#2D6A4F]/5 text-[#2D6A4F] ring-[#2D6A4F]/20", Icon: ShieldCheck },
  needs_attention: { label: "Needs attention", tone: "bg-[#D4A574]/15 text-[#8A6233] ring-[#D4A574]/40", Icon: AlertTriangle },
  at_risk: { label: "At risk", tone: "bg-[#D4A574]/25 text-[#7A5530] ring-[#D4A574]/50", Icon: AlertTriangle },
  critical: { label: "Critical", tone: "bg-red-50 text-red-800 ring-red-200", Icon: AlertOctagon },
  not_measurable: { label: "Not measurable", tone: "bg-gray-100 text-gray-600 ring-gray-200", Icon: Info },
};
const SEVERITY: Record<Finding["severity"], { label: string; tone: string; Icon: typeof Info }> = {
  high: { label: "Serious", tone: "text-red-700 bg-red-50 ring-red-200", Icon: AlertOctagon },
  medium: { label: "Attention", tone: "text-[#8A6233] bg-[#D4A574]/15 ring-[#D4A574]/40", Icon: AlertTriangle },
  low: { label: "Note", tone: "text-gray-600 bg-gray-100 ring-gray-200", Icon: Info },
};

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthWords = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};
const when = (v: string) => new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function BandChip({ band }: { band: string }) {
  const b = BAND[band] ?? BAND.not_measurable;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${b.tone}`}>
      <b.Icon className="h-3.5 w-3.5" /> {b.label}
    </span>
  );
}

/** A 0–100 meter: one hue, value written beside it, rounded end at the value. */
function Meter({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-full bg-gray-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        {value != null && <div className="h-2 rounded-full bg-[#2D6A4F]" style={{ width: `${Math.max(2, value)}%` }} />}
      </div>
      <span className="w-12 text-right text-sm font-semibold tabular-nums text-gray-900">{value == null ? "—" : Math.round(value)}</span>
    </div>
  );
}

function Delta({ from, to }: { from: number | null; to: number | null }) {
  if (from == null || to == null) return null;
  const d = Math.round((to - from) * 10) / 10;
  const Icon = d > 0.4 ? ArrowUpRight : d < -0.4 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-gray-600">
      <Icon className="h-3.5 w-3.5" />
      {d > 0 ? "+" : ""}{d}
    </span>
  );
}

const select = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500";

/** The audit as a registered, verifiable PDF (same engine as every report). */
function pdfSpec(r: Result) {
  return {
    title: `AI Audit — ${r.cooperativeName}`,
    subtitle: `For ${r.periodLabel}`,
    cooperativeId: r.cooperativeId,
    narrative: [r.verdict],
    summary: [
      { label: "Audit score", value: r.score == null ? "—" : `${r.score} / 100` },
      { label: "Rating", value: BAND[r.band]?.label ?? r.band },
      { label: "Findings", value: String(r.findings.length) },
      { label: "Serious", value: String(r.findings.filter((f) => f.severity === "high").length) },
    ],
    sections: [
      {
        title: "How the score is made",
        columns: ["Part", "Weight", "Score", "Basis"],
        rows: r.parts.map((p) => [p.label, `${Math.round(p.weight * 100)}%`, p.score == null ? "not measured" : Math.round(p.score), p.note]),
      },
      {
        title: "Findings",
        columns: ["Severity", "Area", "Finding", "Evidence", "Action"],
        rows: r.findings.map((f) => [SEVERITY[f.severity].label, f.area, f.title, `${f.evidence} (${f.source})`, f.action ?? ""]),
      },
      ...(r.strengths.length ? [{ title: "Strengths", paragraphs: r.strengths }] : []),
      { title: "Sources", paragraphs: [`Computed by the CoopInsightAI AI service from: ${r.sources.join("; ") || "—"}.`] },
    ],
    signatories: ["Audited by", "Reviewed by"],
  };
}

export function AiAudit() {
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  const [sector, setSector] = useState("");
  const [cooperativeId, setCooperativeId] = useState("");
  const [period, setPeriod] = useState(lastMonth);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [many, setMany] = useState<{ label: string; period: string; rows: ManyRow[] } | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadScopeOptions().then(setOptions).catch((e) => setError(e?.message ?? "Could not load your scope.")); }, []);

  const loadHistory = useCallback(() => {
    api.get<{ data: HistoryRow[] }>("/ai-audit/history").then((r) => setHistory(r.data ?? [])).catch(() => setHistory([]));
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const coops = useMemo(
    () => (options?.cooperatives ?? []).filter((c) => !sector || c.sector === sector),
    [options, sector]
  );
  const multi = options?.mode !== "cooperative";

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    setMany(null);
    try {
      const res = await api.post<{ mode: string; data: any }>("/ai-audit/run", {
        period,
        cooperativeId: cooperativeId || undefined,
        sector: sector || undefined,
      });
      if (res.mode === "single") setResult(res.data);
      else setMany(res.data);
      loadHistory();
    } catch (err: any) {
      setError(err?.message ?? "The audit could not be run.");
    } finally {
      setRunning(false);
    }
  };

  const open = async (id: string | null) => {
    if (!id) return;
    setError("");
    try {
      const r = await api.get<{ data: Result }>(`/ai-audit/${id}`);
      setResult(r.data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err?.message ?? "Could not open that audit.");
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err: any) { setError(err?.message ?? "That did not work."); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      {/* ── Run ─────────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Run an AI audit</h2>
            <p className="mt-1 text-sm text-gray-600">Pick a month and run.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {options?.mode === "cooperative" && (
            <div className="sm:col-span-2">
              <span className={label}>Cooperative</span>
              <p className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <Building2 className="h-4 w-4 text-[#2D6A4F]" /> {options.fixedCooperative?.name}
              </p>
            </div>
          )}
          {multi && options && (
            <>
              <div>
                <span className={label}>Sector</span>
                {options.canChooseSector ? (
                  <select className={select} value={sector} onChange={(e) => { setSector(e.target.value); setCooperativeId(""); }}>
                    <option value="">All sectors</option>
                    {options.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <p className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <MapPin className="h-4 w-4 text-[#2D6A4F]" /> {options.fixedSector} sector
                  </p>
                )}
              </div>
              <div>
                <span className={label}>Cooperative</span>
                <select className={select} value={cooperativeId} onChange={(e) => setCooperativeId(e.target.value)}>
                  <option value="">Every cooperative{sector || options.fixedSector ? ` in ${sector || options.fixedSector}` : ""}</option>
                  {coops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <span className={label}>Month audited</span>
            <input type="month" className={select} value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={run} disabled={running || !period} className="w-full">
              <span className="flex items-center justify-center gap-2">
                {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                {running ? "Auditing…" : multi && !cooperativeId ? "Audit all" : "Run audit"}
              </span>
            </Button>
          </div>
        </div>
        {period === thisMonth() && (
          <p className="mt-3 text-xs text-[#8A6233]">{monthWords(period)} is not over yet — the audit reads the month so far.</p>
        )}
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* ── Many: one row per cooperative, weakest first ───────────────────── */}
      {many && (
        <Card className="p-0">
          <div className="border-b border-gray-100 px-6 py-4">
            <h3 className="font-semibold text-gray-900">{many.label}</h3>
            <p className="text-sm text-gray-500">{monthWords(many.period)} · weakest first · open a row for its findings</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Cooperative</th>
                  <th className="w-56 px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Findings</th>
                  <th className="px-4 py-3 font-medium">Most pressing</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {many.rows.map((r) => (
                  <tr key={r.cooperativeId} className="cursor-pointer hover:bg-gray-50" onClick={() => open(r.id)}>
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{r.cooperativeName}</p>
                      <p className="text-xs text-gray-500">{r.sector} sector</p>
                    </td>
                    <td className="px-4 py-3">
                      <Meter value={r.score} />
                      <Delta from={r.previousScore} to={r.score} />
                    </td>
                    <td className="px-4 py-3"><BandChip band={r.band} /></td>
                    <td className="px-4 py-3 text-gray-700">{r.findings}{r.high ? <span className="text-red-700"> · {r.high} serious</span> : null}</td>
                    <td className="max-w-xs px-4 py-3 text-gray-600">{r.topFinding ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── One cooperative ───────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#2D6A4F]">{result.cooperativeName}{result.sector ? ` · ${result.sector} sector` : ""}</p>
                <h3 className="mt-1 text-xl font-bold text-gray-900">AI audit — {result.periodLabel}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-700">{result.verdict}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                  <span>Run {when(result.runAt)}{result.runByName ? ` by ${result.runByName}` : ""}</span>
                  {result.sinceLastRun && (
                    <span>
                      Previous audit ({monthWords(result.sinceLastRun.period)}, {when(result.sinceLastRun.runAt)}): {result.sinceLastRun.score ?? "—"}{" "}
                      <Delta from={result.sinceLastRun.score} to={result.score} />
                    </span>
                  )}
                </div>
              </div>
              {/* The headline: one number, its rating, nothing else. */}
              <div className="text-center">
                <p className="text-5xl font-bold tabular-nums text-gray-900">{result.score == null ? "—" : Math.round(result.score)}</p>
                <p className="mb-2 text-xs text-gray-500">out of 100</p>
                <BandChip band={result.band} />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => printPdf(pdfSpec(result)))}>
                <span className="flex items-center gap-1.5"><Printer className="h-4 w-4" />Print</span>
              </Button>
              <Button size="sm" disabled={busy} onClick={() => act(() => downloadPdf(pdfSpec(result)))}>
                <span className="flex items-center gap-1.5"><Download className="h-4 w-4" />Download PDF</span>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="p-6 lg:col-span-2">
              <h4 className="font-semibold text-gray-900">Score breakdown</h4>
              <div className="mt-4 space-y-4">
                {result.parts.map((p) => (
                  <div key={p.key}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-800">{p.label}</span>
                      <span className="text-xs text-gray-500">weight {Math.round(p.weight * 100)}%</span>
                    </div>
                    <Meter value={p.score} />
                    <p className="mt-1 text-xs leading-snug text-gray-500">{p.note}</p>
                  </div>
                ))}
              </div>
              {result.previousPeriod && (
                <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
                  Operating score in {monthWords(result.previousPeriod.period)}: {result.previousPeriod.score ?? "—"}
                </p>
              )}
            </Card>

            <Card className="p-6 lg:col-span-3">
              <h4 className="font-semibold text-gray-900">Findings <span className="ml-1 text-sm font-normal text-gray-500">{result.findings.length}</span></h4>
              {result.findings.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">Nothing to report for this month.</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {result.findings.map((f, i) => {
                    const s = SEVERITY[f.severity];
                    return (
                      <li key={i} className="py-3">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${s.tone}`}>
                            <s.Icon className="h-3 w-3" /> {s.label}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{f.title}</p>
                            <p className="mt-0.5 text-sm text-gray-600">{f.evidence}</p>
                            {f.action && <p className="mt-1 text-sm text-[#1B4332]">→ {f.action}</p>}
                            <p className="mt-1 text-xs text-gray-400">{f.area} · {f.source}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {result.strengths.length > 0 && (
            <Card className="p-6">
              <h4 className="font-semibold text-gray-900">Strengths</h4>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {result.strengths.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#2D6A4F]" /> {s}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.unreachable.length > 0 && (
            <p className="text-xs text-[#8A6233]">Not available this run: {result.unreachable.join(", ")}.</p>
          )}
        </div>
      )}

      {/* ── Past runs ───────────────────────────────────────────────────── */}
      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
          <History className="h-4 w-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">Past audits</h3>
        </div>
        {history.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">No audits run yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {history.map((h) => (
                <tr key={h.id} className="cursor-pointer hover:bg-gray-50" onClick={() => open(h.id)}>
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900">{h.cooperative_name}</p>
                    <p className="text-xs text-gray-500">{monthWords(h.period)}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-gray-900">{h.score ?? "—"}</td>
                  <td className="px-4 py-3"><BandChip band={h.band} /></td>
                  <td className="px-4 py-3 text-gray-600">{h.findings_count} findings{h.high_count ? ` · ${h.high_count} serious` : ""}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{when(h.run_at)}{h.run_by_name ? ` · ${h.run_by_name}` : ""}</td>
                  <td className="px-4 py-3 text-gray-400"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <MoreInfo title="How the AI audit works">
        <p>The score (0–100) combines five parts: operating and governing 40%, unusual transactions 20%, member engagement 20%, standing among peers 10%, three-month outlook 10%. A part the AI cannot measure is left out.</p>
        <p>Ratings: 75+ sound · 55–74 needs attention · 35–54 at risk · below 35 critical.</p>
        <p>The same records for the same month give the same result. New records, a new month or a newly flagged transaction change it. Engagement and peer standing use today's data; the outlook is skipped for past months.</p>
        {result && result.sources.length > 0 && <p className="text-xs">Last run used: {result.sources.join("; ")}.</p>}
      </MoreInfo>
    </div>
  );
}
