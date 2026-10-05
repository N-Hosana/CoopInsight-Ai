import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Megaphone,
  ShieldAlert,
  XCircle,
} from "lucide-react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTING A PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The one escalation an ordinary member can start on their own account.
 *
 * A member cannot file a dissolution or a change of certificate — those commit
 * the whole cooperative and belong to the president. But the member is usually
 * the first person to notice that the savings do not add up or that no election
 * has been held in three years, and before this they could only raise it with
 * the very office they might be complaining about.
 *
 * The report climbs the same sector → district → RCA chain as every other
 * request, so it lands with people who already supervise the cooperative and
 * have the power to act.
 */

interface IssueCategory {
  id: string;
  label: string;
  description: string;
  defaultSeverity: string;
}

interface IssueRules {
  categories: IssueCategory[];
  severities: string[];
  responseDays: Record<string, number>;
  minDetailLength: number;
}

interface ProcessStage {
  key: string;
  order: number;
  title: string;
  description: string;
  actor: string;
  state: string;
  completedAt?: string | null;
  detail?: string;
  blockedReason?: string;
}

interface IssueReport {
  id: string;
  reference: string;
  cooperative_name: string | null;
  sector: string;
  issue_category: string;
  issue_detail: string;
  issue_severity: "low" | "medium" | "high" | "urgent";
  issue_confidential: boolean;
  issue_resolution: string | null;
  status: string;
  current_stage: string;
  submitted_by: string;
  submitted_by_name: string;
  created_at: string;
  response_due_at: string;
  reviews: Array<{ stage: string; decision: string; note: string | null; reviewerName: string; reviewedAt: string }>;
  process?: {
    stages: ProcessStage[];
    percentComplete: number;
    nextAction: string | null;
  };
}

const SEVERITY_STYLES: Record<string, { label: string; chip: string }> = {
  urgent: { label: "Urgent", chip: "bg-red-100 text-red-700" },
  high: { label: "High", chip: "bg-orange-100 text-orange-800" },
  medium: { label: "Medium", chip: "bg-amber-100 text-amber-800" },
  low: { label: "Low", chip: "bg-gray-100 text-gray-700" },
};

const STATUS_STYLES: Record<string, { label: string; chip: string; Icon: typeof Clock }> = {
  pending_sector: { label: "With the sector officer", chip: "bg-amber-100 text-amber-800", Icon: Clock },
  pending_district: { label: "With the district officer", chip: "bg-amber-100 text-amber-800", Icon: Clock },
  pending_rca: { label: "With the RCA", chip: "bg-amber-100 text-amber-800", Icon: Clock },
  approved: { label: "Upheld", chip: "bg-green-100 text-green-800", Icon: CheckCircle2 },
  rejected: { label: "Not upheld", chip: "bg-gray-100 text-gray-700", Icon: XCircle },
  withdrawn: { label: "Withdrawn", chip: "bg-gray-100 text-gray-700", Icon: XCircle },
};

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const daysUntil = (v: string) => Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000);

export function IssueReportsPanel() {
  const { user } = useAuth();
  const [rules, setRules] = useState<IssueRules | null>(null);
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [cooperatives, setCooperatives] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const isOversight = ["admin", "generalManager", "government"].includes(user?.role ?? "");

  const [form, setForm] = useState({
    category: "",
    detail: "",
    severity: "",
    confidential: false,
    cooperativeId: "",
    contactPhone: user?.phone ?? "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [criteria, list] = await Promise.all([
        api.get<{ data: { issues: IssueRules } }>("/cooperative-requests/criteria"),
        api.get<{ data: IssueReport[] }>("/cooperative-requests?type=issue_report"),
      ]);
      setRules(criteria.data?.issues ?? null);
      setReports(Array.isArray(list.data) ? list.data : []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load reported issues.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // An officer is not attached to a cooperative, so they have to say which
    // one a report concerns. Members never see this list.
    if (isOversight) {
      api
        .get<{ data: Array<{ id: string; name: string }> }>("/cooperatives?limit=100")
        .then((r) => setCooperatives(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCooperatives([]));
    }
  }, []);

  const selectedCategory = useMemo(
    () => rules?.categories.find((c) => c.id === form.category) ?? null,
    [rules, form.category]
  );

  // The severity that will actually apply. A reporter may raise it above the
  // category's default but not lower it, and the form says so rather than
  // letting the server silently overrule them.
  const effectiveSeverity = useMemo(() => {
    if (!selectedCategory) return null;
    const order = rules?.severities ?? ["low", "medium", "high", "urgent"];
    const fallback = selectedCategory.defaultSeverity;
    if (!form.severity) return fallback;
    return order.indexOf(form.severity) > order.indexOf(fallback) ? form.severity : fallback;
  }, [selectedCategory, form.severity, rules]);

  const submit = async () => {
    setError("");
    setMessage("");
    if (!form.category) return setError("Choose what kind of problem this is.");
    if (form.detail.trim().length < (rules?.minDetailLength ?? 30)) {
      return setError(
        `Describe what happened in at least ${rules?.minDetailLength ?? 30} characters.`
      );
    }
    if (isOversight && !form.cooperativeId) {
      return setError("Name the cooperative this report concerns.");
    }

    setBusy(true);
    try {
      const res = await api.post<{ message: string }>("/cooperative-requests/issue", {
        category: form.category,
        detail: form.detail.trim(),
        severity: form.severity || undefined,
        confidential: form.confidential,
        cooperativeId: isOversight ? form.cooperativeId : undefined,
        contactPhone: form.contactPhone || undefined,
      });
      setMessage(res.message);
      setShowForm(false);
      setForm({
        category: "",
        detail: "",
        severity: "",
        confidential: false,
        cooperativeId: "",
        contactPhone: user?.phone ?? "",
      });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not file the report.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: "approved" | "rejected" | "returned") => {
    setError("");
    setMessage("");
    if (decision !== "approved" && !notes[id]?.trim()) {
      return setError("Say why before returning or dismissing a report — the member is told.");
    }
    setBusy(true);
    try {
      const res = await api.patch<{ message: string }>(`/cooperative-requests/${id}/decision`, {
        decision,
        note: notes[id]?.trim() || undefined,
      });
      setMessage(res.message);
      setNotes({ ...notes, [id]: "" });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading reported issues…</p>;

  const mine = reports.filter((r) => r.submitted_by === user?.id);
  const toReview = reports.filter((r) => r.submitted_by !== user?.id);

  return (
    <div className="space-y-6">
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

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Megaphone className="mt-0.5 h-5 w-5 text-[#2D6A4F]" />
            <div className="max-w-2xl">
              <h3 className="text-lg font-semibold text-gray-900">Report a problem</h3>
              <p className="mt-1 text-sm text-gray-600">
                If something is wrong with how your cooperative is being run, this is how you raise
                it with somebody outside it. Your report goes to the sector cooperative officer
                first, then the district office, then the RCA — the same people who supervise the
                cooperative and can act on it.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                You do not need the committee's permission, and you do not need to be an
                office-bearer.
              </p>
            </div>
          </div>
          {!showForm && (
            <Button onClick={() => { setShowForm(true); setError(""); setMessage(""); }}>
              <span className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                Report an issue
              </span>
            </Button>
          )}
        </div>

        {showForm && rules && (
          <div className="mt-6 space-y-5 border-t border-gray-200 pt-5">
            {isOversight && (
              <Select
                label="Which cooperative? *"
                value={form.cooperativeId}
                onChange={(e) => setForm({ ...form, cooperativeId: e.target.value })}
                options={[
                  { value: "", label: "Select a cooperative…" },
                  ...cooperatives.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            )}

            <Select
              label="What kind of problem is it? *"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, severity: "" })}
              options={[
                { value: "", label: "Select…" },
                ...rules.categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
            {selectedCategory && (
              <p className="-mt-3 text-xs text-gray-500">{selectedCategory.description}</p>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                What happened? *
              </label>
              <textarea
                rows={5}
                value={form.detail}
                onChange={(e) => setForm({ ...form, detail: e.target.value })}
                placeholder="Dates, amounts, names of meetings that did or did not happen — anything that lets an officer act on this without coming back to ask what you meant."
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              />
              <p className="mt-1 text-xs text-gray-500">
                {form.detail.trim().length}/{rules.minDetailLength} characters minimum
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Select
                label="How serious is it?"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                options={[
                  { value: "", label: selectedCategory ? `Default for this kind (${selectedCategory.defaultSeverity})` : "Select a category first" },
                  ...rules.severities.map((s) => ({
                    value: s,
                    label: `${SEVERITY_STYLES[s]?.label ?? s} — answered within ${rules.responseDays[s]} days`,
                  })),
                ]}
              />
              <Input
                label="Phone to reach you on"
                type="tel"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="+250 7xx xxx xxx"
              />
            </div>

            {effectiveSeverity && (
              <p className="-mt-2 text-xs text-gray-500">
                This will be treated as <strong>{SEVERITY_STYLES[effectiveSeverity]?.label}</strong>{" "}
                and answered within {rules.responseDays[effectiveSeverity]} days.
                {form.severity && form.severity !== effectiveSeverity && (
                  <>
                    {" "}
                    You chose a lower level, but the RCA sets a floor for this kind of problem, so
                    it stays at {SEVERITY_STYLES[effectiveSeverity]?.label.toLowerCase()}.
                  </>
                )}
              </p>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                type="checkbox"
                checked={form.confidential}
                onChange={(e) => setForm({ ...form, confidential: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2D6A4F] focus:ring-[#2D6A4F]"
              />
              <span className="text-sm text-gray-700">
                <strong>Do not give my name to the cooperative.</strong> The officers reviewing this
                will still see who filed it — a report nobody can follow up is worth little — but it
                will not be passed back to the committee you are reporting.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={submit}>
                {busy ? "Filing…" : "File the report"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setError(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {mine.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">Issues you reported</h3>
          {mine.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              expanded={expanded === r.id}
              onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
            />
          ))}
        </div>
      )}

      {isOversight && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">
            Issues awaiting you
            {toReview.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {toReview.filter((r) => r.status.startsWith("pending")).length}
              </span>
            )}
          </h3>
          {toReview.length === 0 ? (
            <Card className="p-10 text-center">
              <Inbox className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-3 font-medium text-gray-900">Nothing reported in your scope</p>
              <p className="mt-1 text-sm text-gray-500">
                Issues raised by members of cooperatives you supervise appear here.
              </p>
            </Card>
          ) : (
            toReview.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                actions={
                  r.status.startsWith("pending") ? (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Your finding (required to dismiss or return)
                      </label>
                      <textarea
                        rows={2}
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                        placeholder="What you found, and what happens next. The member is told."
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                      />
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button size="sm" disabled={busy} onClick={() => decide(r.id, "approved")}>
                          Uphold &amp; escalate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => decide(r.id, "returned")}
                        >
                          Ask for more detail
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => decide(r.id, "rejected")}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ) : null
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  expanded,
  onToggle,
  actions,
}: {
  report: IssueReport;
  expanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}) {
  const severity = SEVERITY_STYLES[report.issue_severity] ?? SEVERITY_STYLES.medium;
  const status = STATUS_STYLES[report.status] ?? STATUS_STYLES.pending_sector;
  const { Icon } = status;
  const remaining = daysUntil(report.response_due_at);
  const overdue = remaining < 0 && report.status.startsWith("pending");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{report.reference}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severity.chip}`}>
              {severity.label}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${status.chip}`}
            >
              <Icon className="h-3 w-3" />
              {status.label}
            </span>
            {report.issue_confidential && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                Name withheld from the cooperative
              </span>
            )}
          </div>
          <p className="mt-1 font-semibold text-gray-900">
            {report.cooperative_name ?? "Unknown cooperative"}
          </p>
          <p className="text-sm text-gray-500">
            {report.sector} sector · reported {formatDate(report.created_at)}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
            {report.status.startsWith("pending")
              ? overdue
                ? `Overdue by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"}`
                : `Due in ${remaining} day${remaining === 1 ? "" : "s"}`
              : "Closed"}
          </p>
          <button onClick={onToggle} className="mt-1 text-sm font-medium text-[#2D6A4F] hover:underline">
            {expanded ? "Hide" : "View"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-gray-200 pt-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">What was reported</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{report.issue_detail}</p>
          </div>

          {report.process?.stages && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                Where it has got to
              </p>
              <ol className="space-y-2">
                {report.process.stages.map((st) => (
                  <li key={st.key} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        st.state === "done"
                          ? "border-green-600 bg-green-600 text-white"
                          : st.state === "current"
                            ? "border-[#2D6A4F] text-[#2D6A4F]"
                            : st.state === "failed"
                              ? "border-red-500 bg-red-500 text-white"
                              : "border-gray-300 text-gray-400"
                      }`}
                    >
                      {st.state === "done" ? "✓" : st.order}
                    </span>
                    <span className={st.state === "pending" ? "text-gray-500" : "text-gray-900"}>
                      {st.title}
                      {st.detail && <span className="block text-xs text-gray-500">{st.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {report.process.nextAction && (
                <p className="mt-2 rounded-lg border border-[#2D6A4F]/20 bg-[#2D6A4F]/5 px-3 py-2 text-xs text-[#1b4332]">
                  <strong>Next:</strong> {report.process.nextAction}
                </p>
              )}
            </div>
          )}

          {report.reviews?.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">What officers said</p>
              <ul className="space-y-2">
                {report.reviews.map((v, i) => (
                  <li key={i} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">{v.reviewerName}</span>{" "}
                    <span className="text-gray-500">
                      ({v.stage}) — {v.decision} on {formatDate(v.reviewedAt)}
                    </span>
                    {v.note && <p className="mt-1 text-gray-700">{v.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.issue_resolution && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
                RCA ruling
              </p>
              <p className="mt-1 text-sm text-green-900">{report.issue_resolution}</p>
            </div>
          )}

          {report.status === "pending_sector" && (
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              This is with the sector cooperative officer. If they do not answer within the window,
              it can be escalated to the district office.
            </p>
          )}

          {actions}
        </div>
      )}
    </Card>
  );
}
