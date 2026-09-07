import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import {
  Activity,
  MapPin,
  Play,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Users,
  TrendingDown,
  HeartPulse,
  Info,
} from "lucide-react";

/**
 * The monthly functionality audit, and the field-visit list it produces.
 *
 * Cooperatives rarely announce that they have stopped working — they go quiet.
 * This page is where an officer sees who has gone quiet this month and goes to
 * find out why, before the members lose their savings.
 */

interface AuditRow {
  id: string;
  cooperative_id: string;
  cooperative_name: string;
  cooperative_type: string;
  cooperative_sector: string;
  member_count: string;
  functionality_score: string;
  engagement_score: string;
  composite_score: string;
  band: "healthy" | "monitor" | "at_risk" | "critical";
  visit_recommended: boolean;
  visit_priority: number | null;
  signals: {
    components?: Record<string, number>;
    engagementDetail?: Record<string, number>;
    dormant?: boolean;
    monthsSinceLastTransaction?: number | null;
    evidenceQuality?: number;
    flaggedOnSilenceAlone?: boolean;
    permitType?: string | null;
    permitExpiresOn?: string | null;
  } | null;
  reasons: string[] | null;
  recommended_actions: string[] | null;
  period: string;
}

interface Visit {
  id: string;
  cooperative_id: string;
  cooperative_name: string;
  cooperative_sector: string;
  cooperative_phone: string | null;
  priority: number;
  reason: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  assigned_to_name: string | null;
  scheduled_for: string | null;
  visited_at: string | null;
  findings: string | null;
  support_needed: string | null;
  outcome: string | null;
  band: string | null;
  composite_score: string | null;
  recommended_actions: string[] | null;
}

const BAND_STYLES: Record<string, { label: string; badge: string; bar: string }> = {
  healthy: { label: "Healthy", badge: "bg-green-100 text-green-800", bar: "bg-[#2D6A4F]" },
  monitor: { label: "Monitor", badge: "bg-blue-100 text-blue-800", bar: "bg-blue-500" },
  at_risk: { label: "At risk", badge: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  critical: { label: "Critical", badge: "bg-red-100 text-red-700", bar: "bg-red-600" },
};

const OUTCOME_LABELS: Record<string, string> = {
  operating_normally: "Operating normally — no concern",
  needs_support: "Still operating, needs support",
  referred_for_funding: "Referred to a funder for support",
  recommended_for_dissolution: "Has genuinely stopped — advise on dissolution",
  unreachable: "Could not be reached",
};

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

function BandBadge({ band }: { band: string }) {
  const s = BAND_STYLES[band] ?? BAND_STYLES.monitor;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.badge}`}>{s.label}</span>
  );
}

function ScoreBar({ value, band }: { value: number; band: string }) {
  const s = BAND_STYLES[band] ?? BAND_STYLES.monitor;
  return (
    <div className="h-2 w-full rounded-full bg-gray-200">
      <div className={`h-2 rounded-full ${s.bar}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "bad" | "good";
}) {
  const tones = {
    default: "text-gray-900",
    good: "text-[#2D6A4F]",
    warn: "text-amber-700",
    bad: "text-red-700",
  };
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function MonthlyAudit() {
  const { user } = useAuth();
  const canRun =
    ["admin", "generalManager"].includes(user?.role ?? "") || user?.role === "government";

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>("");
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<"visits" | "standings">("visits");

  const [visitForms, setVisitForms] = useState<
    Record<string, { findings: string; supportNeeded: string; outcome: string; scheduledFor: string }>
  >({});
  const [busyVisit, setBusyVisit] = useState<string | null>(null);

  const load = async (p?: string) => {
    setLoading(true);
    setError("");
    try {
      const [auditRes, visitRes] = await Promise.all([
        api.get<any>(`/audits/monthly${p ? `?period=${p}` : ""}`),
        api.get<{ data: Visit[] }>("/audits/visits"),
      ]);
      setRows(auditRes.data ?? []);
      setPeriods(auditRes.availablePeriods ?? []);
      setPeriod(auditRes.period ?? "");
      setSummary(auditRes.summary ?? null);
      setVisits(visitRes.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load the monthly audit.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runAudit = async () => {
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post<{ message: string }>("/audits/monthly/run", {});
      setMessage(res.message);
      await load();
    } catch (err: any) {
      setError(
        err?.message ??
          "Could not run the audit. The AI service must be running for the assessment to be computed."
      );
    } finally {
      setRunning(false);
    }
  };

  const updateVisit = async (id: string, patch: Record<string, unknown>) => {
    setBusyVisit(id);
    setError("");
    try {
      const res = await api.patch<{ message: string }>(`/audits/visits/${id}`, patch);
      setMessage(res.message);
      await load(period);
    } catch (err: any) {
      setError(err?.message ?? "Could not update the visit.");
    } finally {
      setBusyVisit(null);
    }
  };

  const openVisits = useMemo(
    () => visits.filter((v) => v.status === "pending" || v.status === "scheduled"),
    [visits]
  );
  const closedVisits = useMemo(
    () => visits.filter((v) => v.status === "completed" || v.status === "cancelled"),
    [visits]
  );

  if (loading) return <p className="text-gray-500">Loading the monthly audit…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Monthly cooperative audit</h1>
          <p className="text-gray-600 mt-1 max-w-3xl">
            Every cooperative in the district scored on whether it is still functioning and whether
            its members are still engaged. The bottom of the list becomes visits, so a cooperative
            that has gone quiet is found while something can still be done about it.
          </p>
        </div>
        {canRun && (
          <Button variant="primary" onClick={runAudit} disabled={running}>
            <span className="flex items-center gap-2">
              <Play className="w-4 h-4" />
              {running ? "Running…" : "Run this month's audit"}
            </span>
          </Button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <Activity className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No audit has been run yet</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            {canRun
              ? "Run the audit to score every cooperative in the district and raise the visit list. The AI service must be running."
              : "The district office has not yet run a monthly audit."}
          </p>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Cooperatives" value={summary?.total ?? rows.length} />
            <StatTile label="Healthy" value={summary?.healthy ?? 0} tone="good" />
            <StatTile label="Monitor" value={summary?.monitor ?? 0} />
            <StatTile label="At risk" value={summary?.atRisk ?? 0} tone="warn" />
            <StatTile label="Critical" value={summary?.critical ?? 0} tone="bad" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex rounded-lg border border-gray-200 p-1">
              {(["visits", "standings"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === t ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t === "visits" ? `Visit list (${openVisits.length})` : "District standings"}
                </button>
              ))}
            </div>

            {periods.length > 0 && (
              <div className="w-56">
                <Select
                  value={period}
                  onChange={(e) => load(e.target.value)}
                  options={periods.map((p) => ({
                    value: p,
                    label: new Date(`${p}-01`).toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    }),
                  }))}
                />
              </div>
            )}
          </div>

          {tab === "visits" ? (
            <div className="space-y-4">
              {openVisits.length === 0 ? (
                <Card className="p-10 text-center">
                  <CheckCircle2 className="w-8 h-8 text-[#2D6A4F] mx-auto" />
                  <p className="font-medium text-gray-900 mt-3">Nobody needs a visit</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Every cooperative in scope is trading, meeting and keeping its members engaged.
                  </p>
                </Card>
              ) : (
                openVisits.map((v) => {
                  const form = visitForms[v.id] ?? {
                    findings: "",
                    supportNeeded: "",
                    outcome: "",
                    scheduledFor: "",
                  };
                  return (
                    <Card key={v.id} className="p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-gray-700" />
                            <p className="text-lg font-semibold text-gray-900">
                              {v.cooperative_name}
                            </p>
                            {v.band && <BandBadge band={v.band} />}
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            {v.cooperative_sector} sector
                            {v.cooperative_phone && ` · ${v.cooperative_phone}`}
                            {v.assigned_to_name && ` · assigned to ${v.assigned_to_name}`}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            v.priority === 1
                              ? "bg-red-100 text-red-700"
                              : v.priority === 2
                                ? "bg-amber-100 text-amber-800"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          Priority {v.priority}
                        </span>
                      </div>

                      <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-800">
                        {v.reason}
                      </p>

                      {v.recommended_actions && v.recommended_actions.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                            What to do
                          </p>
                          <ul className="space-y-1.5">
                            {v.recommended_actions.map((a, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2D6A4F]" />
                                {a}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-5 border-t border-gray-200 pt-4 space-y-4">
                        {v.status === "pending" && (
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="w-52">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Schedule the visit
                              </label>
                              <input
                                type="date"
                                value={form.scheduledFor}
                                onChange={(e) =>
                                  setVisitForms({
                                    ...visitForms,
                                    [v.id]: { ...form, scheduledFor: e.target.value },
                                  })
                                }
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                              />
                            </div>
                            <Button
                              variant="outline"
                              disabled={busyVisit === v.id || !form.scheduledFor}
                              onClick={() =>
                                updateVisit(v.id, {
                                  status: "scheduled",
                                  scheduledFor: form.scheduledFor,
                                })
                              }
                            >
                              Schedule
                            </Button>
                          </div>
                        )}

                        {v.status === "scheduled" && (
                          <p className="text-sm text-blue-800">
                            Scheduled for {formatDate(v.scheduled_for)}.
                          </p>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            What you found *
                          </label>
                          <textarea
                            rows={3}
                            value={form.findings}
                            onChange={(e) =>
                              setVisitForms({
                                ...visitForms,
                                [v.id]: { ...form, findings: e.target.value },
                              })
                            }
                            placeholder="Is it still operating? Who did you speak to? What is actually wrong?"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <Select
                            label="Outcome *"
                            value={form.outcome}
                            onChange={(e) =>
                              setVisitForms({
                                ...visitForms,
                                [v.id]: { ...form, outcome: e.target.value },
                              })
                            }
                            options={[
                              { value: "", label: "Select the outcome…" },
                              ...Object.entries(OUTCOME_LABELS).map(([value, label]) => ({
                                value,
                                label,
                              })),
                            ]}
                          />
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Support needed
                            </label>
                            <input
                              value={form.supportNeeded}
                              onChange={(e) =>
                                setVisitForms({
                                  ...visitForms,
                                  [v.id]: { ...form, supportNeeded: e.target.value },
                                })
                              }
                              placeholder="e.g. bookkeeping help, a facilitated assembly"
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                            />
                          </div>
                        </div>

                        <Button
                          variant="primary"
                          disabled={busyVisit === v.id}
                          onClick={() =>
                            updateVisit(v.id, {
                              status: "completed",
                              findings: form.findings,
                              supportNeeded: form.supportNeeded || undefined,
                              outcome: form.outcome,
                            })
                          }
                        >
                          {busyVisit === v.id ? "Saving…" : "Close the visit"}
                        </Button>
                        <p className="text-xs text-gray-500">
                          Closing a visit as "referred to a funder" notifies the cooperative to open
                          its funding matches. Every closed visit counts as support attempted if the
                          cooperative later applies to be dissolved.
                        </p>
                      </div>
                    </Card>
                  );
                })
              )}

              {closedVisits.length > 0 && (
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Completed visits</h3>
                  <div className="space-y-3">
                    {closedVisits.map((v) => (
                      <div key={v.id} className="rounded-xl border border-gray-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900">{v.cooperative_name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatDate(v.visited_at)} · {v.assigned_to_name ?? "unassigned"}
                            </p>
                          </div>
                          {v.outcome && (
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                              {OUTCOME_LABELS[v.outcome] ?? v.outcome}
                            </span>
                          )}
                        </div>
                        {v.findings && <p className="mt-2 text-sm text-gray-700">{v.findings}</p>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            /* District standings */
            <Card className="p-6">
              <div className="space-y-3">
                {rows.map((r) => {
                  const open = expanded === r.id;
                  const signals = r.signals ?? {};
                  return (
                    <div key={r.id} className="rounded-xl border border-gray-200">
                      <button
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-gray-900">{r.cooperative_name}</p>
                              <BandBadge band={r.band} />
                              {signals.dormant && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                                  <TrendingDown className="w-3 h-3" /> Dormant
                                </span>
                              )}
                              {signals.flaggedOnSilenceAlone && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                  <Info className="w-3 h-3" /> Flagged on missing records
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {r.cooperative_type} · {r.cooperative_sector} · {r.member_count} members
                            </p>
                            <div className="mt-2 max-w-md">
                              <ScoreBar value={num(r.composite_score)} band={r.band} />
                            </div>
                          </div>
                          <div className="flex gap-6 text-right">
                            <div>
                              <p className="text-xs text-gray-500">Functionality</p>
                              <p className="font-semibold text-gray-900">
                                {num(r.functionality_score).toFixed(0)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Engagement</p>
                              <p className="font-semibold text-gray-900">
                                {num(r.engagement_score).toFixed(0)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Overall</p>
                              <p className="text-lg font-semibold text-gray-900">
                                {num(r.composite_score).toFixed(0)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </button>

                      {open && (
                        <div className="border-t border-gray-200 px-5 py-4 space-y-4">
                          {signals.components && (
                            <div className="grid gap-3 sm:grid-cols-4">
                              {Object.entries(signals.components).map(([k, v]) => (
                                <div key={k} className="rounded-lg bg-gray-50 px-3 py-2">
                                  <p className="text-xs capitalize text-gray-500">
                                    {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                                  </p>
                                  <p className="font-semibold text-gray-900">{Number(v).toFixed(0)}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {signals.engagementDetail && (
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
                              <span className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-gray-500" />
                                {signals.engagementDetail.contributorsLastQuarter} of{" "}
                                {signals.engagementDetail.membersOnRegister} contributed last quarter
                              </span>
                              <span className="flex items-center gap-1.5">
                                <HeartPulse className="w-3.5 h-3.5 text-gray-500" />
                                {signals.engagementDetail.attendeesLastQuarter} attended something
                              </span>
                            </div>
                          )}

                          {r.reasons && r.reasons.length > 0 && (
                            <div>
                              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                                Why it scored this way
                              </p>
                              <ul className="space-y-1.5">
                                {r.reasons.map((reason, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                                    {reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.recommended_actions && r.recommended_actions.length > 0 && (
                            <div>
                              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                                Recommended action
                              </p>
                              <ul className="space-y-1.5">
                                {r.recommended_actions.map((a, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2D6A4F]" />
                                    {a}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {signals.evidenceQuality != null && (
                            <p className="text-xs text-gray-500 border-t border-gray-200 pt-3">
                              Evidence quality {Math.round(signals.evidenceQuality * 100)}% — how
                              much of this band rests on records that exist, rather than on their
                              absence. A cooperative flagged mainly on silence may simply not be
                              using the system; verify on the visit before drawing a conclusion.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {rows.length === 0 && visits.length === 0 && !canRun && (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <Inbox className="w-5 h-5 text-gray-400 mt-0.5" />
            <p className="text-sm text-gray-600">
              Nothing to show yet. The district office runs this audit monthly.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
