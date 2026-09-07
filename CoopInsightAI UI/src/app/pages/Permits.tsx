import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import {
  BadgeCheck,
  Clock,
  ShieldAlert,
  FileSearch,
  Inbox,
  AlertTriangle,
  CalendarClock,
  ScrollText,
  CheckCircle2,
  XCircle,
} from "lucide-react";

/**
 * Operating permits.
 *
 * A cooperative sees its own licence and how ready it looks for conversion; the
 * RCA sees the conversion queue and works the maturity audits from here.
 */

interface Permit {
  id: string;
  cooperative_id: string;
  cooperative_name: string;
  cooperative_type: string;
  registration_number: string;
  permit_number: string;
  permit_type: "temporary" | "permanent";
  term_years: number;
  issued_on: string;
  expires_on: string;
  status: "active" | "expired" | "superseded" | "revoked";
  term_rule: string | null;
  basis: string | null;
  days_until_expiry?: number;
  expired?: boolean;
  open_audit?: { id: string; reference: string; status: string } | null;
}

interface Assessment {
  score: number;
  passMark: number;
  recommended: string;
  met: string[];
  unmet: string[];
  failedMandatory: string[];
  notes: string[];
  model: string;
  confidence: number;
}

interface Audit {
  id: string;
  reference: string;
  audit_type: string;
  cooperative_name: string;
  status: string;
  due_on: string;
  days_until_due?: number;
  findings: string | null;
  recommendation: string | null;
  outcome_note: string | null;
  score: string | null;
  ai_assessment: { facts?: Record<string, unknown>; assessment?: Assessment } | null;
  permit_number: string | null;
  opened_by_name: string | null;
  concluded_by_name: string | null;
  concluded_at: string | null;
}

interface Terms {
  temporaryYears: number;
  standardPermanentYears: number;
  extendedPermanentYears: number;
  auditLeadDays: number;
}

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const PERMIT_STYLES: Record<string, { label: string; badge: string; Icon: typeof BadgeCheck }> = {
  permanent: { label: "Permanent permit", badge: "bg-green-100 text-green-800", Icon: BadgeCheck },
  temporary: { label: "Temporary permit", badge: "bg-amber-100 text-amber-800", Icon: Clock },
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-red-100 text-red-700",
  revoked: "bg-red-100 text-red-700",
  superseded: "bg-gray-100 text-gray-600",
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  issue_permanent: "Issue the permanent permit",
  extend_temporary: "Extend the temporary permit for another year",
  revoke: "Revoke the permit and suspend the cooperative",
  deferred: "Defer — decide later, permit unchanged",
};

function PermitCard({ permit }: { permit: Permit }) {
  const style = PERMIT_STYLES[permit.permit_type];
  const { Icon } = style;
  const days = permit.days_until_expiry ?? 0;

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-gray-700" />
            <p className="font-semibold text-gray-900">{permit.permit_number}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
              {style.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[permit.status]}`}>
              {permit.status}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {permit.cooperative_name} · {permit.term_years}-year term
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-gray-500">Runs to</p>
          <p className="font-medium text-gray-900">{formatDate(permit.expires_on)}</p>
        </div>
      </div>

      {permit.status === "active" && (
        <p
          className={`mt-3 text-sm ${
            days < 0 ? "text-red-700" : days <= 60 ? "text-amber-700" : "text-gray-600"
          }`}
        >
          {days < 0
            ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.`
            : `${days} day${days === 1 ? "" : "s"} remaining.`}
        </p>
      )}

      {permit.basis && <p className="mt-3 text-xs text-gray-500">{permit.basis}</p>}
    </div>
  );
}

/** The 0–100 readiness dial an officer and a cooperative both read. */
function ScoreBar({ score, passMark }: { score: number; passMark: number }) {
  const pct = Math.round(score * 100);
  const pass = score >= passMark;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className={`text-3xl font-semibold ${pass ? "text-[#2D6A4F]" : "text-amber-700"}`}>{pct}%</p>
        <p className="text-xs text-gray-500">pass mark {Math.round(passMark * 100)}%</p>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
        <div
          className={`h-2 rounded-full ${pass ? "bg-[#2D6A4F]" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function AssessmentPanel({ assessment }: { assessment: Assessment }) {
  return (
    <div className="space-y-4">
      <ScoreBar score={assessment.score} passMark={assessment.passMark} />

      <div className="rounded-lg bg-gray-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">Automated recommendation</p>
        <p className="text-sm font-medium text-gray-900 mt-0.5">
          {RECOMMENDATION_LABELS[assessment.recommended] ?? assessment.recommended}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {assessment.model} · confidence {Math.round(assessment.confidence * 100)}%. An officer
          decides; this is a starting position, not the decision.
        </p>
      </div>

      {assessment.failedMandatory.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">Mandatory criteria not met</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
            {assessment.failedMandatory.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Met</p>
          <ul className="space-y-1.5">
            {assessment.met.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm text-gray-800">
                <CheckCircle2 className="w-4 h-4 text-[#2D6A4F] mt-0.5 shrink-0" />
                {m}
              </li>
            ))}
            {assessment.met.length === 0 && <li className="text-sm text-gray-500">None.</li>}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Not met</p>
          <ul className="space-y-1.5">
            {assessment.unmet.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm text-gray-800">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                {m}
              </li>
            ))}
            {assessment.unmet.length === 0 && <li className="text-sm text-gray-500">None.</li>}
          </ul>
        </div>
      </div>

      {assessment.notes.length > 0 && (
        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">What the records show</p>
          <ul className="space-y-1 text-sm text-gray-700">
            {assessment.notes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The cooperative's own view
// ─────────────────────────────────────────────────────────────────────────────

function CooperativeView({ cooperativeId }: { cooperativeId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: any }>(`/permits/cooperative/${cooperativeId}`);
      setData(res.data);
    } catch (err: any) {
      setError(err?.message ?? "Could not load your operating permit.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [cooperativeId]);

  const requestAudit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ message: string }>(
        `/permits/${data.current.id}/request-audit`,
        {}
      );
      setMessage(res.message);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading your operating permit…</p>;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { current, history, readiness, permanentTermIfConverted, terms } = data;

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!current ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">No operating permit is on record</p>
              <p className="text-sm text-gray-600 mt-1">
                Every registered cooperative should hold one. Contact your sector cooperative
                officer — this needs correcting before it affects your eligibility for funding.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Your licence to operate</h3>
          <PermitCard permit={current} />

          {current.permit_type === "temporary" && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-sm text-blue-900">
                This is a temporary permit. Before it expires the RCA audits the cooperative; a
                pass converts it to a permanent permit of{" "}
                <span className="font-semibold">{permanentTermIfConverted.years} years</span>.
              </p>
              <p className="text-xs text-blue-800 mt-1">{permanentTermIfConverted.basis}</p>
            </div>
          )}
        </Card>
      )}

      {readiness && (
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-gray-700" />
                <h3 className="text-lg font-semibold text-gray-900">Are you ready for conversion?</h3>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Scored against the same criteria the RCA officer will use, on the records you have
                filed so far.
              </p>
            </div>
            <Button variant="outline" onClick={requestAudit} disabled={busy}>
              {busy ? "Sending…" : "Ask the RCA to audit us"}
            </Button>
          </div>
          <div className="mt-5">
            <AssessmentPanel assessment={readiness.assessment} />
          </div>
        </Card>
      )}

      {history.length > 1 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Permit history</h3>
          <div className="space-y-3">
            {history.map((p: Permit) => (
              <PermitCard key={p.id} permit={p} />
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-gray-500">
        A new cooperative holds a temporary permit for {terms.temporaryYears} year. Converted
        permits run {terms.standardPermanentYears} years, or {terms.extendedPermanentYears} for
        industrial and rice-growing cooperatives.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The RCA's conversion queue
// ─────────────────────────────────────────────────────────────────────────────

function RcaView() {
  const [due, setDue] = useState<Permit[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { recommendation: string; findings: string }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [dueRes, auditRes, policyRes] = await Promise.all([
        api.get<{ data: Permit[] }>("/permits/due"),
        api.get<{ data: Audit[] }>("/permits/audits?type=permit_maturity"),
        api.get<{ data: { terms: Terms } }>("/permits/policy"),
      ]);
      setDue(dueRes.data ?? []);
      setAudits(auditRes.data ?? []);
      setTerms(policyRes.data.terms);
    } catch (err: any) {
      setError(err?.message ?? "Could not load the permit queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openMaturityAudit = async (permitId: string) => {
    setBusyId(permitId);
    setError("");
    try {
      const res = await api.post<{ message: string }>(`/permits/${permitId}/audit`, {});
      setMessage(res.message);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not open the audit.");
    } finally {
      setBusyId(null);
    }
  };

  const conclude = async (auditId: string) => {
    const form = forms[auditId];
    if (!form?.recommendation) return setError("Choose an outcome before concluding the audit.");
    if (!form?.findings || form.findings.trim().length < 20)
      return setError("Record what the audit found, in at least 20 characters.");

    setBusyId(auditId);
    setError("");
    try {
      const res = await api.patch<{ message: string }>(`/permits/audits/${auditId}`, {
        recommendation: form.recommendation,
        findings: form.findings.trim(),
      });
      setMessage(res.message);
      setOpenAudit(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not conclude the audit.");
    } finally {
      setBusyId(null);
    }
  };

  const openAudits = useMemo(
    () => audits.filter((a) => ["scheduled", "in_progress"].includes(a.status)),
    [audits]
  );
  const closedAudits = useMemo(
    () => audits.filter((a) => !["scheduled", "in_progress"].includes(a.status)),
    [audits]
  );

  if (loading) return <p className="text-gray-500">Loading the permit queue…</p>;

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Conversion queue */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-gray-700" />
          <h3 className="text-lg font-semibold text-gray-900">Temporary permits falling due</h3>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Expiring within {terms?.auditLeadDays ?? 60} days. A cooperative whose permit is allowed
          to lapse has to register again from the beginning.
        </p>

        {due.length === 0 ? (
          <div className="mt-6 text-center py-8">
            <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-medium text-gray-900 mt-3">Nothing falling due</p>
            <p className="text-sm text-gray-500 mt-1">
              No temporary permit expires in the next {terms?.auditLeadDays ?? 60} days.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {due.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{p.cooperative_name}</p>
                    <p className="text-sm text-gray-600">
                      {p.permit_number} · {p.cooperative_type} · registered {p.registration_number}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        p.expired ? "text-red-700" : "text-amber-700"
                      }`}
                    >
                      {p.expired
                        ? `Expired ${Math.abs(p.days_until_expiry ?? 0)} days ago`
                        : `${p.days_until_expiry} days left`}
                    </p>
                    <p className="text-xs text-gray-500">expires {formatDate(p.expires_on)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  {p.open_audit ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                      <FileSearch className="w-3.5 h-3.5" />
                      Audit {p.open_audit.reference} open
                    </span>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyId === p.id}
                      onClick={() => openMaturityAudit(p.id)}
                    >
                      {busyId === p.id ? "Opening…" : "Open maturity audit"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Audits in progress */}
      {openAudits.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Audits in progress</h3>
          <p className="text-sm text-gray-600 mb-5">
            The assessment below was computed from the cooperative's own records when the audit
            opened. Confirm it on the ground, then record the outcome.
          </p>

          <div className="space-y-4">
            {openAudits.map((a) => {
              const assessment = a.ai_assessment?.assessment;
              const expanded = openAudit === a.id;
              return (
                <div key={a.id} className="rounded-xl border border-gray-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{a.cooperative_name}</p>
                      <p className="text-sm text-gray-600">
                        {a.reference} · permit {a.permit_number} · opened by {a.opened_by_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`text-sm font-medium ${
                          (a.days_until_due ?? 0) < 0 ? "text-red-700" : "text-gray-600"
                        }`}
                      >
                        {(a.days_until_due ?? 0) < 0
                          ? `Overdue by ${Math.abs(a.days_until_due ?? 0)} days`
                          : `Due in ${a.days_until_due} days`}
                      </span>
                    </div>
                  </div>

                  {assessment && (
                    <div className="mt-4">
                      <AssessmentPanel assessment={assessment} />
                    </div>
                  )}

                  <div className="mt-5 border-t border-gray-200 pt-4">
                    {!expanded ? (
                      <Button variant="primary" size="sm" onClick={() => setOpenAudit(a.id)}>
                        Record the outcome
                      </Button>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Outcome *
                          </label>
                          <div className="space-y-2">
                            {["issue_permanent", "extend_temporary", "revoke", "deferred"].map((r) => (
                              <label key={r} className="flex items-start gap-3 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`rec-${a.id}`}
                                  checked={forms[a.id]?.recommendation === r}
                                  onChange={() =>
                                    setForms({
                                      ...forms,
                                      [a.id]: { ...(forms[a.id] ?? { findings: "" }), recommendation: r },
                                    })
                                  }
                                  className="mt-1"
                                />
                                <span className="text-sm text-gray-800">
                                  {RECOMMENDATION_LABELS[r]}
                                  {assessment?.recommended === r && (
                                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                                      suggested
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Findings * (shown to the cooperative)
                          </label>
                          <textarea
                            rows={3}
                            value={forms[a.id]?.findings ?? ""}
                            onChange={(e) =>
                              setForms({
                                ...forms,
                                [a.id]: {
                                  ...(forms[a.id] ?? { recommendation: "" }),
                                  findings: e.target.value,
                                },
                              })
                            }
                            placeholder="What the audit established, and what the cooperative must do about it."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
                          />
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <Button
                            variant="primary"
                            disabled={busyId === a.id}
                            onClick={() => conclude(a.id)}
                          >
                            {busyId === a.id ? "Recording…" : "Conclude audit"}
                          </Button>
                          <Button variant="outline" onClick={() => setOpenAudit(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Concluded */}
      {closedAudits.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <ScrollText className="w-4 h-4 text-gray-700" />
            <h3 className="text-lg font-semibold text-gray-900">Concluded audits</h3>
          </div>
          <div className="space-y-3">
            {closedAudits.map((a) => (
              <div key={a.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{a.cooperative_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {a.reference} · {formatDate(a.concluded_at)}
                      {a.concluded_by_name && ` by ${a.concluded_by_name}`}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      a.status === "passed"
                        ? "bg-green-100 text-green-800"
                        : a.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {a.recommendation
                      ? RECOMMENDATION_LABELS[a.recommendation] ?? a.recommendation
                      : a.status}
                  </span>
                </div>
                {a.findings && <p className="mt-2 text-sm text-gray-700">{a.findings}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Permits() {
  const { user } = useAuth();
  const isOversight = ["admin", "generalManager", "government"].includes(user?.role ?? "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Operating permits</h1>
        <p className="text-gray-600 mt-1">
          {isOversight
            ? "Temporary permits falling due for conversion, and the maturity audits that decide them."
            : "Your cooperative's licence to operate, and how ready it looks for a permanent permit."}
        </p>
      </div>

      {isOversight ? (
        <RcaView />
      ) : user?.cooperativeId ? (
        <CooperativeView cooperativeId={user.cooperativeId} />
      ) : (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">You are not linked to a cooperative</p>
              <p className="text-sm text-gray-600 mt-1">
                There is no operating permit to show.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
