import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ClipboardCheck,
  Megaphone,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Users,
  Hourglass,
  Trash2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RCA AUDITS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Audits      requests and announced audits — each with every stage it passes
 *               through, whose turn it is, and the buttons for the viewer's turn
 *   Announce    the RCA officer schedules an audit nobody asked for
 *   Programme   the routine: monthly sector visits, trimester district visits,
 *               trimester sensitization sessions, and the committees that run them
 *
 * The server decides what each viewer may do (`allowedActions`) and where they
 * stand (`viewerPosition`); this page draws it and never re-derives the chain.
 */

interface ScopeItem { id: string; label: string; detail: string; custom?: boolean }
interface Stage {
  key: string; order: number; title: string; description: string; actor: string;
  state: "done" | "current" | "pending" | "failed" | "skipped" | "blocked";
  completedAt?: string | null; completedBy?: string | null; detail?: string;
}
interface AuditAction { id: string; step: string; action: string; note: string | null; actedAt: string; actorName: string | null }
interface Finding { scopeId: string; label: string; result: string; note: string | null }
interface Audit {
  id: string; reference: string; origin: "requested" | "rca_initiated"; audit_kind: "general" | "financial";
  kindLabel: string; cooperative_id: string; cooperative_name: string; sector: string; district: string;
  requested_by: string; requested_by_name: string; requester_level: string;
  reason_category: string; reasons: string; preferred_date: string | null;
  status: string; statusLabel: string; current_step: string; step_due_at: string | null;
  scheduled_start: string | null; scheduled_end: string | null; scope: ScopeItem[];
  audit_team: string | null; rca_instructions: string | null; approved_by_name: string | null;
  reschedule_proposed_date: string | null; waitlist_until: string | null;
  activity_id: string | null; members_reached: number | null;
  findings: Finding[] | null; overall_rating: string | null; summary: string | null;
  recommendations: string[] | null; follow_up_by: string | null;
  actions: AuditAction[];
  process: { stages: Stage[]; percentComplete: number; overdue: boolean };
  allowedActions: string[];
  viewerPosition: "your_turn" | "upcoming" | "done_your_part" | "watching" | "closed";
  waitingOn: string | null;
}
interface Meta {
  district: string;
  kinds: Array<{ id: string; label: string }>;
  reasonCategories: Array<{ id: string; label: string }>;
  minReasonLength: number;
  minNoticeDays: number;
  stepResponseDays: number;
  scope: Record<string, ScopeItem[]>;
  findingResults: string[];
  overallRatings: string[];
  cadence: Record<string, { label: string; level: string; every: string; description: string }>;
  cooperatives: Array<{ id: string; name: string; sector: string }>;
  sectors: string[];
  viewer: { tier: string | null; sector: string | null; canRequest: boolean; canAnnounce: boolean; canRunProgramme: boolean };
}

const ACTOR_LABEL: Record<string, string> = {
  requester: "Requester",
  cooperative: "Cooperative",
  sector: "Sector officer",
  district: "District officer",
  rca: "RCA officer",
};

const RATING_LABEL: Record<string, string> = {
  satisfactory: "Satisfactory",
  needs_improvement: "Needs improvement",
  unsatisfactory: "Unsatisfactory",
  concern: "Concern",
  non_compliant: "Non-compliant",
  not_checked: "Not checked",
};

const formatDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatDateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
/** A datetime-local value for a date `days` from now at 09:00. */
const localInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const at9 = (date: string | null | undefined, fallbackDays: number) => {
  const d = date ? new Date(`${String(date).slice(0, 10)}T09:00`) : new Date(Date.now() + fallbackDays * 86_400_000);
  if (!date) d.setHours(9, 0, 0, 0);
  return localInput(d);
};
const errorText = (err: any) => err?.message ?? "Something went wrong.";

const textareaClass =
  "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent text-sm";

function StatusBadge({ audit }: { audit: Audit }) {
  const s = audit.status;
  const style =
    s === "completed"
      ? "bg-green-100 text-green-800"
      : ["rejected", "cancelled"].includes(s)
        ? "bg-red-100 text-red-700"
        : s === "withdrawn"
          ? "bg-gray-100 text-gray-700"
          : ["confirmed", "announced", "in_progress"].includes(s)
            ? "bg-blue-100 text-blue-800"
            : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{audit.statusLabel}</span>;
}

/** Where the viewer stands — the line everyone reads first. */
function PositionBanner({ audit }: { audit: Audit }) {
  if (audit.viewerPosition === "closed") return null;
  const styles = {
    your_turn: { box: "border-[#2D6A4F]/30 bg-green-50 text-[#1b4332]", Icon: CheckCircle2, text: "Your turn — this is waiting on you." },
    upcoming: { box: "border-amber-200 bg-amber-50 text-amber-900", Icon: Hourglass, text: `Not your turn yet — waiting on ${audit.waitingOn}. Your part comes after.` },
    done_your_part: { box: "border-gray-200 bg-gray-50 text-gray-700", Icon: CheckCircle2, text: `You have done your part. It is now with ${audit.waitingOn}.` },
    watching: { box: "border-gray-200 bg-gray-50 text-gray-700", Icon: Clock, text: `With ${audit.waitingOn}.` },
  }[audit.viewerPosition];
  const { Icon } = styles;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${styles.box}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{styles.text}</span>
      {audit.process.overdue && (
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-3 w-3" /> Overdue
        </span>
      )}
    </div>
  );
}

function ProcessTrail({ stages, percent }: { stages: Stage[]; percent: number }) {
  const styles: Record<string, { ring: string; label: string }> = {
    done: { ring: "bg-green-600 border-green-600 text-white", label: "text-gray-900" },
    current: { ring: "bg-white border-[#2D6A4F] text-[#2D6A4F]", label: "text-gray-900 font-medium" },
    blocked: { ring: "bg-white border-red-500 text-red-600", label: "text-gray-900 font-medium" },
    failed: { ring: "bg-red-600 border-red-600 text-white", label: "text-red-700 font-medium" },
    pending: { ring: "bg-white border-gray-300 text-gray-400", label: "text-gray-500" },
    skipped: { ring: "bg-gray-100 border-gray-200 text-gray-400", label: "text-gray-400" },
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Every stage of this audit</p>
        <span className="text-xs font-semibold text-gray-600">{percent}% complete</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-[#2D6A4F]" style={{ width: `${percent}%` }} />
      </div>
      <ol>
        {stages.map((stage, i) => {
          const style = styles[stage.state] ?? styles.pending;
          const last = i === stages.length - 1;
          return (
            <li key={stage.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold ${style.ring}`}>
                  {stage.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : stage.state === "failed" ? <XCircle className="h-3.5 w-3.5" /> : stage.order}
                </span>
                {!last && <span className={`w-0.5 flex-1 ${stage.state === "done" ? "bg-green-600" : "bg-gray-200"}`} style={{ minHeight: 14 }} />}
              </div>
              <div className={last ? "" : "pb-4"}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className={`text-sm ${style.label}`}>{stage.title}</p>
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">{ACTOR_LABEL[stage.actor] ?? stage.actor}</span>
                  {stage.completedAt && (
                    <span className="text-[11px] text-gray-400">
                      {formatDate(stage.completedAt)}
                      {stage.completedBy ? ` · ${stage.completedBy}` : ""}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{stage.description}</p>
                {stage.detail && <p className="mt-0.5 text-xs text-gray-500">{stage.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Acting on an audit ──────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  forward: "Approve and forward",
  return: "Return for more information",
  reject: "Reject",
  waitlist: "Put on waiting list",
  approve: "Approve and schedule",
  relay: "Pass the approval on",
  confirm: "Confirm the audit",
  request_reschedule: "Ask for another date",
  resubmit: "Resubmit",
  withdraw: "Withdraw request",
  acknowledge: "Acknowledge",
  convene: "Put on calendar & tell members",
  start: "Mark audit as started",
  complete: "Record findings",
  cancel: "Cancel audit",
};
/** Actions that need nothing more than an optional note. */
const SIMPLE = ["forward", "relay", "confirm", "acknowledge", "start", "withdraw"];
const NOTE_REQUIRED = ["return", "reject", "waitlist", "cancel"];
const DANGER = ["reject", "cancel", "withdraw"];

function ActionPanel({ audit, meta, onDone }: { audit: Audit; meta: Meta; onDone: (message: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Record<string, any>>({});
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const begin = (action: string) => {
    setOpen(action);
    setError("");
    setNote("");
    const catalogue = meta.scope[audit.audit_kind] ?? [];
    if (action === "approve") {
      setForm({
        scheduledStart: at9(audit.reschedule_proposed_date ?? audit.preferred_date, 14),
        scheduledEnd: "",
        scopeIds: audit.scope?.length ? audit.scope.filter((s) => !s.custom).map((s) => s.id) : catalogue.map((s) => s.id),
        customScope: (audit.scope ?? []).filter((s) => s.custom).map((s) => s.label).join("\n"),
        auditTeam: audit.audit_team ?? "",
        instructions: audit.rca_instructions ?? "",
      });
    } else if (action === "complete") {
      setForm({
        findings: Object.fromEntries((audit.scope ?? []).map((s) => [s.id, { result: "satisfactory", note: "" }])),
        overallRating: "satisfactory",
        summary: "",
        recommendations: "",
        followUpBy: "",
      });
    } else if (action === "resubmit") {
      setForm({ reasons: audit.reasons, preferredDate: audit.preferred_date?.slice(0, 10) ?? "" });
    } else if (action === "convene") {
      setForm({ location: "", scheduledFor: audit.scheduled_start ? localInput(new Date(audit.scheduled_start)) : "", message: "" });
    } else {
      setForm({});
    }
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, any> = { action: open, note };
      if (open === "approve") {
        Object.assign(body, {
          scheduledStart: form.scheduledStart,
          scheduledEnd: form.scheduledEnd || undefined,
          scopeIds: form.scopeIds,
          customScope: String(form.customScope ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean),
          auditTeam: form.auditTeam,
          instructions: form.instructions,
        });
      } else if (open === "complete") {
        Object.assign(body, {
          findings: Object.entries(form.findings).map(([scopeId, f]: [string, any]) => ({ scopeId, result: f.result, note: f.note })),
          overallRating: form.overallRating,
          summary: form.summary,
          recommendations: String(form.recommendations).split("\n").map((s: string) => s.trim()).filter(Boolean),
          followUpBy: form.followUpBy || undefined,
        });
      } else if (open === "waitlist") {
        body.revisitOn = form.revisitOn || undefined;
      } else {
        Object.assign(body, form);
      }
      const res = await api.post(`/rca-audits/${audit.id}/actions`, body);
      setOpen(null);
      onDone(res.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!audit.allowedActions.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {audit.allowedActions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={DANGER.includes(a) ? "outline" : open === a ? "secondary" : "primary"}
            className={DANGER.includes(a) ? "text-red-700" : ""}
            onClick={() => (open === a ? setOpen(null) : begin(a))}
          >
            {ACTION_LABEL[a] ?? a}
          </Button>
        ))}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          {open === "approve" && (
            <>
              {audit.reschedule_proposed_date && (
                <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The requester proposed {formatDate(audit.reschedule_proposed_date)}.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Audit starts" type="datetime-local" value={form.scheduledStart} onChange={(e) => set("scheduledStart", e.target.value)} />
                <Input label="Audit ends (optional)" type="datetime-local" value={form.scheduledEnd} onChange={(e) => set("scheduledEnd", e.target.value)} />
              </div>
              <ScopePicker items={meta.scope[audit.audit_kind] ?? []} selected={form.scopeIds ?? []} onChange={(ids) => set("scopeIds", ids)} />
              <label className="block text-sm font-medium text-gray-700">
                Anything else to check (one per line)
                <textarea className={`${textareaClass} mt-1`} rows={2} value={form.customScope} onChange={(e) => set("customScope", e.target.value)} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Audit team" value={form.auditTeam} onChange={(e) => set("auditTeam", e.target.value)} />
                <Input label="Instructions to the cooperative" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
              </div>
            </>
          )}

          {open === "complete" && (
            <>
              <div className="space-y-2">
                {(audit.scope ?? []).map((s) => (
                  <div key={s.id} className="grid gap-2 rounded border border-gray-100 p-2 md:grid-cols-[1fr_180px_1fr] md:items-center">
                    <p className="text-sm text-gray-800">{s.label}</p>
                    <select
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      value={form.findings?.[s.id]?.result}
                      onChange={(e) => set("findings", { ...form.findings, [s.id]: { ...form.findings[s.id], result: e.target.value } })}
                    >
                      {meta.findingResults.map((r) => <option key={r} value={r}>{RATING_LABEL[r] ?? r}</option>)}
                    </select>
                    <input
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      placeholder="Observation"
                      value={form.findings?.[s.id]?.note}
                      onChange={(e) => set("findings", { ...form.findings, [s.id]: { ...form.findings[s.id], note: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
              <Select
                label="Overall rating"
                value={form.overallRating}
                onChange={(e) => set("overallRating", e.target.value)}
                options={meta.overallRatings.map((r) => ({ value: r, label: RATING_LABEL[r] ?? r }))}
              />
              <label className="block text-sm font-medium text-gray-700">
                Summary of findings
                <textarea className={`${textareaClass} mt-1`} rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Recommendations (one per line)
                <textarea className={`${textareaClass} mt-1`} rows={3} value={form.recommendations} onChange={(e) => set("recommendations", e.target.value)} />
              </label>
              <Input label="Recommendations to be acted on by" type="date" value={form.followUpBy} onChange={(e) => set("followUpBy", e.target.value)} />
            </>
          )}

          {open === "request_reschedule" && (
            <Input label="Date that would suit you" type="date" value={form.proposedDate ?? ""} onChange={(e) => set("proposedDate", e.target.value)} />
          )}
          {open === "waitlist" && (
            <Input label="Revisit on (optional)" type="date" value={form.revisitOn ?? ""} onChange={(e) => set("revisitOn", e.target.value)} />
          )}
          {open === "resubmit" && (
            <>
              <label className="block text-sm font-medium text-gray-700">
                Reasons
                <textarea className={`${textareaClass} mt-1`} rows={4} value={form.reasons} onChange={(e) => set("reasons", e.target.value)} />
              </label>
              <Input label="Suggested date" type="date" value={form.preferredDate} onChange={(e) => set("preferredDate", e.target.value)} />
            </>
          )}
          {open === "convene" && (
            <>
              <p className="text-xs text-gray-600">
                This puts the audit on the cooperative's calendar, registers every member for it, and sends every member the notice
                with the checklist.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Where the auditors will be received" value={form.location} onChange={(e) => set("location", e.target.value)} />
                <Input label="Date and time" type="datetime-local" value={form.scheduledFor} onChange={(e) => set("scheduledFor", e.target.value)} />
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Message to members (optional)
                <textarea className={`${textareaClass} mt-1`} rows={2} value={form.message} onChange={(e) => set("message", e.target.value)} />
              </label>
            </>
          )}

          {(SIMPLE.includes(open) || NOTE_REQUIRED.includes(open) || ["request_reschedule", "approve", "complete", "resubmit"].includes(open)) && (
            <label className="block text-sm font-medium text-gray-700">
              {NOTE_REQUIRED.includes(open) || open === "request_reschedule" ? "Reason (required)" : "Note (optional)"}
              <textarea className={`${textareaClass} mt-1`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant={DANGER.includes(open) ? "danger" : "primary"} disabled={busy} onClick={submit}>
              {busy ? "Saving…" : ACTION_LABEL[open]}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(null)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopePicker({ items, selected, onChange }: { items: ScopeItem[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-700">What the audit will check</p>
      <div className="grid gap-1.5 md:grid-cols-2">
        {items.map((s) => (
          <label key={s.id} className="flex cursor-pointer gap-2 rounded border border-gray-100 p-2 text-sm hover:bg-gray-50">
            <input type="checkbox" className="mt-0.5" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
            <span>
              <span className="font-medium text-gray-900">{s.label}</span>
              <span className="block text-xs text-gray-500">{s.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AuditCard({ audit, meta, onChanged }: { audit: Audit; meta: Meta; onChanged: (message: string) => void }) {
  const [expanded, setExpanded] = useState(audit.viewerPosition === "your_turn");
  const reason = meta.reasonCategories.find((r) => r.id === audit.reason_category)?.label ?? audit.reason_category;
  const lastReturn = [...audit.actions].reverse().find((a) => ["return", "waitlist", "request_reschedule"].includes(a.action));

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{audit.reference}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${audit.audit_kind === "financial" ? "bg-purple-100 text-purple-800" : "bg-sky-100 text-sky-800"}`}>
              {audit.kindLabel}
            </span>
            {audit.origin === "rca_initiated" && (
              <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium text-white">Announced by the RCA</span>
            )}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-gray-900">{audit.cooperative_name}</h3>
          <p className="text-sm text-gray-600">
            {audit.sector} sector · {audit.district} district ·{" "}
            {audit.origin === "requested" ? `requested by ${audit.requested_by_name}` : `announced by ${audit.requested_by_name}`}
          </p>
        </div>
        <StatusBadge audit={audit} />
      </div>

      <div className="mt-3 space-y-3">
        <PositionBanner audit={audit} />

        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Why</p>
            <p className="text-gray-800">{reason}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">{audit.scheduled_start ? "Scheduled" : "Suggested date"}</p>
            <p className="text-gray-800">
              {audit.scheduled_start ? formatDateTime(audit.scheduled_start) : formatDate(audit.preferred_date)}
              {audit.scheduled_end ? ` → ${formatDateTime(audit.scheduled_end)}` : ""}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Progress</p>
            <p className="text-gray-800">{audit.process.percentComplete}% complete</p>
          </div>
        </div>

        {lastReturn?.note && ["returned", "waitlisted", "reschedule_requested"].includes(audit.status) && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>{lastReturn.actorName}:</strong> {lastReturn.note}
          </p>
        )}

        <ActionPanel audit={audit} meta={meta} onDone={onChanged} />

        <button className="flex items-center gap-1 text-sm font-medium text-[#2D6A4F]" onClick={() => setExpanded((e) => !e)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Hide details" : "Details, stages and history"}
        </button>

        {expanded && (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Reasons given</p>
              <p className="whitespace-pre-line text-sm text-gray-800">{audit.reasons}</p>
            </div>

            {audit.scope?.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  What will be checked{audit.audit_team ? ` · team: ${audit.audit_team}` : ""}
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                  {audit.scope.map((s) => <li key={s.id}>{s.label}</li>)}
                </ul>
                {audit.rca_instructions && <p className="mt-1 text-sm text-gray-600">Instructions: {audit.rca_instructions}</p>}
              </div>
            )}

            {audit.activity_id && (
              <p className="text-sm text-gray-700">
                On the cooperative's calendar —{" "}
                <Link className="text-[#2D6A4F] underline" to={`/activities/${audit.activity_id}`}>open the activity</Link>
                {audit.members_reached != null ? ` · notice sent to ${audit.members_reached} member account(s)` : ""}
              </p>
            )}

            {audit.status === "completed" && (
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-900">
                  Findings — {RATING_LABEL[audit.overall_rating ?? ""] ?? audit.overall_rating}
                </p>
                <p className="mt-1 text-sm text-gray-700">{audit.summary}</p>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {(audit.findings ?? []).map((f) => (
                      <tr key={f.scopeId} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-800">{f.label}</td>
                        <td className={`py-1.5 pr-3 font-medium ${f.result === "satisfactory" ? "text-green-700" : f.result === "not_checked" ? "text-gray-400" : "text-red-700"}`}>
                          {RATING_LABEL[f.result] ?? f.result}
                        </td>
                        <td className="py-1.5 text-gray-600">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(audit.recommendations ?? []).length > 0 && (
                  <>
                    <p className="mt-3 text-sm font-medium text-gray-900">
                      Recommendations{audit.follow_up_by ? ` — to be acted on by ${formatDate(audit.follow_up_by)}` : ""}
                    </p>
                    <ul className="list-disc pl-5 text-sm text-gray-700">
                      {audit.recommendations!.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </>
                )}
              </div>
            )}

            <ProcessTrail stages={audit.process.stages} percent={audit.process.percentComplete} />

            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">History</p>
              <ul className="space-y-1 text-sm">
                {audit.actions.map((a) => (
                  <li key={a.id} className="text-gray-700">
                    <span className="text-gray-400">{formatDateTime(a.actedAt)}</span> · <strong>{a.actorName ?? "—"}</strong>{" "}
                    {(ACTION_LABEL[a.action] ?? a.action).toLowerCase()}
                    {a.note ? ` — “${a.note}”` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Requesting ──────────────────────────────────────────────────────────────

function CooperativePicker({
  meta, sector, setSector, cooperativeId, setCooperativeId,
}: {
  meta: Meta; sector: string; setSector: (s: string) => void; cooperativeId: string; setCooperativeId: (id: string) => void;
}) {
  const inSector = meta.cooperatives.filter((c) => !sector || c.sector === sector);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Select label="District" value={meta.district} disabled options={[{ value: meta.district, label: meta.district }]} />
      <Select
        label="Sector"
        value={sector}
        onChange={(e) => { setSector(e.target.value); setCooperativeId(""); }}
        options={[...(meta.sectors.length > 1 ? [{ value: "", label: "All sectors" }] : []), ...meta.sectors.map((s) => ({ value: s, label: s }))]}
      />
      <Select
        label="Cooperative"
        value={cooperativeId}
        onChange={(e) => setCooperativeId(e.target.value)}
        options={[{ value: "", label: "Choose…" }, ...inSector.map((c) => ({ value: c.id, label: c.name }))]}
      />
    </div>
  );
}

function RequestForm({ meta, onDone, onCancel }: { meta: Meta; onDone: (m: string) => void; onCancel: () => void }) {
  const ownCoop = meta.viewer.tier === "cooperative" ? meta.cooperatives[0] : null;
  const [auditKind, setAuditKind] = useState("general");
  const [sector, setSector] = useState(meta.viewer.sector ?? (meta.sectors.length === 1 ? meta.sectors[0] : ""));
  const [cooperativeId, setCooperativeId] = useState(ownCoop?.id ?? "");
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasons, setReasons] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/rca-audits", { auditKind, cooperativeId, reasonCategory, reasons, preferredDate });
      onDone(res.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const chainText =
    meta.viewer.tier === "cooperative" || meta.viewer.tier === "admin"
      ? "It goes to the sector officer, then the district officer, then the RCA officer — and the approval comes back down the same way to you."
      : meta.viewer.tier === "sector"
        ? "It goes to the district officer, then the RCA officer, and the approval comes back via the district to you."
        : "It goes straight to the RCA officer, who sends the decision back to you.";

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Request an audit</h2>
        <p className="text-sm text-gray-600">{chainText}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {meta.kinds.map((k) => (
          <label key={k.id} className={`cursor-pointer rounded-lg border p-3 ${auditKind === k.id ? "border-[#2D6A4F] bg-green-50" : "border-gray-200"}`}>
            <input type="radio" className="mr-2" checked={auditKind === k.id} onChange={() => setAuditKind(k.id)} />
            <span className="font-medium text-gray-900">{k.label}</span>
            <span className="block pl-5 text-xs text-gray-500">
              {(meta.scope[k.id] ?? []).slice(0, 4).map((s) => s.label).join(", ")}…
            </span>
          </label>
        ))}
      </div>

      {ownCoop ? (
        <p className="text-sm text-gray-700">
          Cooperative: <strong>{ownCoop.name}</strong> · {ownCoop.sector} sector · {meta.district} district
        </p>
      ) : (
        <CooperativePicker meta={meta} sector={sector} setSector={setSector} cooperativeId={cooperativeId} setCooperativeId={setCooperativeId} />
      )}

      <Select
        label="Main reason"
        value={reasonCategory}
        onChange={(e) => setReasonCategory(e.target.value)}
        options={[{ value: "", label: "Choose…" }, ...meta.reasonCategories.map((r) => ({ value: r.id, label: r.label }))]}
      />
      <label className="block text-sm font-medium text-gray-700">
        Explain the reasons — what has happened, and what you want the auditors to look at
        <textarea className={`${textareaClass} mt-1`} rows={4} value={reasons} onChange={(e) => setReasons(e.target.value)} />
        <span className={`text-xs ${reasons.trim().length < meta.minReasonLength ? "text-gray-400" : "text-green-700"}`}>
          {reasons.trim().length} / at least {meta.minReasonLength} characters
        </span>
      </label>
      <Input label="When would you like the audit held?" type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send request"}</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function AnnounceForm({ meta, onDone }: { meta: Meta; onDone: (m: string) => void }) {
  const [auditKind, setAuditKind] = useState("general");
  const [sector, setSector] = useState("");
  const [cooperativeIds, setCooperativeIds] = useState<string[]>([]);
  const [reasonCategory, setReasonCategory] = useState("routine_check");
  const [reasons, setReasons] = useState("");
  const [scheduledStart, setScheduledStart] = useState(at9(null, 14));
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [scopeIds, setScopeIds] = useState<string[]>((meta.scope.general ?? []).map((s) => s.id));
  const [customScope, setCustomScope] = useState("");
  const [auditTeam, setAuditTeam] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inSector = meta.cooperatives.filter((c) => !sector || c.sector === sector);
  const allChosen = inSector.length > 0 && inSector.every((c) => cooperativeIds.includes(c.id));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/rca-audits/announce", {
        auditKind, cooperativeIds, reasonCategory, reasons, scheduledStart, scheduledEnd: scheduledEnd || undefined,
        scopeIds, customScope: customScope.split("\n").map((s) => s.trim()).filter(Boolean), auditTeam, instructions,
      });
      const skipped = res.data?.skipped ?? [];
      onDone(res.message + (skipped.length ? ` Skipped: ${skipped.map((s: any) => `${s.cooperative} (${s.reason})`).join("; ")}` : ""));
      setCooperativeIds([]);
      setReasons("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Announce an audit</h2>
        <p className="text-sm text-gray-600">
          No request is needed. Each cooperative chosen gets its own audit and its own notice; its manager acknowledges it and
          tells the members. The sector and district officers are informed.
        </p>
      </div>

      <div className="flex gap-2">
        {meta.kinds.map((k) => (
          <Button
            key={k.id}
            size="sm"
            variant={auditKind === k.id ? "primary" : "outline"}
            onClick={() => { setAuditKind(k.id); setScopeIds((meta.scope[k.id] ?? []).map((s) => s.id)); }}
          >
            {k.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Select label="District" value={meta.district} disabled options={[{ value: meta.district, label: meta.district }]} />
        <Select
          label="Sector"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          options={[{ value: "", label: "All sectors" }, ...meta.sectors.map((s) => ({ value: s, label: s }))]}
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Cooperatives ({cooperativeIds.length} chosen)</p>
          <button
            className="text-xs font-medium text-[#2D6A4F]"
            onClick={() =>
              setCooperativeIds(allChosen
                ? cooperativeIds.filter((id) => !inSector.some((c) => c.id === id))
                : Array.from(new Set([...cooperativeIds, ...inSector.map((c) => c.id)])))
            }
          >
            {allChosen ? "Clear these" : "Choose all shown"}
          </button>
        </div>
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded border border-gray-200 p-2 md:grid-cols-2">
          {inSector.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cooperativeIds.includes(c.id)}
                onChange={() => setCooperativeIds((ids) => (ids.includes(c.id) ? ids.filter((i) => i !== c.id) : [...ids, c.id]))}
              />
              {c.name} <span className="text-xs text-gray-400">{c.sector}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Reason"
          value={reasonCategory}
          onChange={(e) => setReasonCategory(e.target.value)}
          options={meta.reasonCategories.map((r) => ({ value: r.id, label: r.label }))}
        />
        <Input label="Audit team" value={auditTeam} onChange={(e) => setAuditTeam(e.target.value)} />
      </div>
      <label className="block text-sm font-medium text-gray-700">
        Why this audit is being held
        <textarea className={`${textareaClass} mt-1`} rows={2} value={reasons} onChange={(e) => setReasons(e.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Audit starts" type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
        <Input label="Audit ends (optional)" type="datetime-local" value={scheduledEnd} onChange={(e) => setScheduledEnd(e.target.value)} />
      </div>
      <p className="text-xs text-gray-500">The cooperative must have at least {meta.minNoticeDays} days' notice.</p>
      <ScopePicker items={meta.scope[auditKind] ?? []} selected={scopeIds} onChange={setScopeIds} />
      <label className="block text-sm font-medium text-gray-700">
        Anything else to check (one per line)
        <textarea className={`${textareaClass} mt-1`} rows={2} value={customScope} onChange={(e) => setCustomScope(e.target.value)} />
      </label>
      <Input label="Instructions to the cooperatives" value={instructions} onChange={(e) => setInstructions(e.target.value)} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button disabled={busy || !cooperativeIds.length} onClick={submit}>
        {busy ? "Announcing…" : `Announce to ${cooperativeIds.length} cooperative(s)`}
      </Button>
    </Card>
  );
}

// ─── The general audit programme ─────────────────────────────────────────────

interface Standing {
  roundType: string; label: string; every: string; sector: string | null;
  period: { label: string; name: string; start: string; end: string };
  state: "held" | "scheduled" | "due";
  rounds: Array<{ id: string; reference: string; status: string; scheduled_for: string }>;
  previousPeriod: { label: string; name: string; held: boolean };
  cooperatives?: number;
}
interface Round {
  id: string; reference: string; round_type: string; typeLabel: string; sector: string | null;
  period_label: string; scheduled_for: string; location: string; agenda: string; status: string;
  minutes: string | null; leaders_attended: number | null; held_on: string | null; cancel_reason: string | null;
  committee_name: string | null; created_by_name: string | null; canManage: boolean;
  cooperatives: Array<{ cooperativeId: string; name: string; sector: string; attended: boolean | null; rating: string | null; observations: string | null }>;
}
interface Committee {
  id: string; level: "sector" | "district"; sector: string | null; name: string; canManage: boolean;
  members: Array<{ id: string; name: string; position: string | null; organisation: string | null; phone: string | null }>;
}

function StandingCard({ s, canSchedule, onSchedule }: { s: Standing; canSchedule: boolean; onSchedule: () => void }) {
  const badge = {
    held: "bg-green-100 text-green-800",
    scheduled: "bg-blue-100 text-blue-800",
    due: "bg-amber-100 text-amber-800",
  }[s.state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
      <div>
        <p className="font-medium text-gray-900">
          {s.sector ? `${s.sector} sector` : s.label}
          {s.cooperatives != null && <span className="text-xs font-normal text-gray-500"> · {s.cooperatives} cooperatives</span>}
        </p>
        <p className="text-xs text-gray-500">
          {s.period.name} · every {s.every}
          {s.rounds[0] ? ` · ${formatDateTime(s.rounds[0].scheduled_for)}` : ""}
        </p>
        {!s.previousPeriod.held && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
            <AlertTriangle className="h-3 w-3" /> None held in {s.previousPeriod.name}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
          {s.state === "held" ? "Held" : s.state === "scheduled" ? "Scheduled" : "Due"}
        </span>
        {canSchedule && s.state === "due" && <Button size="sm" onClick={onSchedule}>Schedule</Button>}
      </div>
    </div>
  );
}

function ScheduleRoundForm({
  meta, preset, onDone, onCancel,
}: { meta: Meta; preset: { roundType: string; sector: string | null }; onDone: (m: string) => void; onCancel: () => void }) {
  const [roundType, setRoundType] = useState(preset.roundType);
  const [sector, setSector] = useState(preset.sector ?? meta.viewer.sector ?? "");
  const [scheduledFor, setScheduledFor] = useState(at9(null, 7));
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSector = meta.cadence[roundType]?.level === "sector";
  const allowedTypes = Object.entries(meta.cadence).filter(([, c]) => meta.viewer.tier !== "sector" || c.level === "sector");
  const coops = meta.cooperatives.filter((c) => !isSector || c.sector === sector);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/rca-audits/rounds", { roundType, sector: isSector ? sector : undefined, scheduledFor, location, agenda });
      onDone(res.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-semibold text-gray-900">Schedule a sitting</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Type"
          value={roundType}
          onChange={(e) => setRoundType(e.target.value)}
          options={allowedTypes.map(([id, c]) => ({ value: id, label: `${c.label} (every ${c.every})` }))}
        />
        {isSector && (
          <Select
            label="Sector"
            value={sector}
            disabled={meta.viewer.tier === "sector"}
            onChange={(e) => setSector(e.target.value)}
            options={[{ value: "", label: "Choose…" }, ...meta.sectors.map((s) => ({ value: s, label: s }))]}
          />
        )}
      </div>
      <p className="text-xs text-gray-600">{meta.cadence[roundType]?.description}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Date and time" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <label className="block text-sm font-medium text-gray-700">
        Agenda / focus
        <textarea className={`${textareaClass} mt-1`} rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
      </label>
      <p className="text-xs text-gray-500">
        It goes on the calendar of {coops.length} cooperative(s) and their managers are notified.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={submit}>{busy ? "Scheduling…" : "Schedule"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function RoundCard({ round, meta, onChanged }: { round: Round; meta: Meta; onChanged: (m: string) => void }) {
  const [mode, setMode] = useState<"record" | "cancel" | null>(null);
  const [heldOn, setHeldOn] = useState(round.scheduled_for.slice(0, 10));
  const [minutes, setMinutes] = useState("");
  const [leaders, setLeaders] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, { attended: boolean; rating: string; observations: string }>>(
    Object.fromEntries(round.cooperatives.map((c) => [c.cooperativeId, { attended: true, rating: "", observations: "" }]))
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const save = async () => {
    setError("");
    try {
      const res =
        mode === "record"
          ? await api.patch(`/rca-audits/rounds/${round.id}/record`, {
              heldOn, minutes, leadersAttended: leaders ? Number(leaders) : undefined,
              outcomes: Object.entries(outcomes).map(([cooperativeId, o]) => ({ cooperativeId, ...o, rating: o.rating || undefined })),
            })
          : await api.patch(`/rca-audits/rounds/${round.id}/cancel`, { reason });
      setMode(null);
      onChanged(res.message);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const statusStyle =
    round.status === "held" ? "bg-green-100 text-green-800" : round.status === "cancelled" ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-800";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-gray-500">{round.reference}</p>
          <p className="font-medium text-gray-900">
            {round.typeLabel}
            {round.sector ? ` — ${round.sector}` : ""} · {formatDateTime(round.scheduled_for)}
          </p>
          <p className="text-sm text-gray-600">
            {round.location} · {round.cooperatives.length} cooperative(s){round.committee_name ? ` · ${round.committee_name}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusStyle}`}>{round.status}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{round.agenda}</p>
      {round.status === "held" && round.minutes && (
        <p className="mt-2 rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <strong>Held {formatDate(round.held_on)}:</strong> {round.minutes}
          {round.leaders_attended != null ? ` (${round.leaders_attended} leaders attended)` : ""}
        </p>
      )}
      {round.status === "cancelled" && round.cancel_reason && <p className="mt-2 text-sm text-gray-500">Cancelled: {round.cancel_reason}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <button className="text-sm font-medium text-[#2D6A4F]" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide cooperatives" : "Cooperatives covered"}
        </button>
        {round.canManage && round.status === "scheduled" && (
          <>
            <Button size="sm" onClick={() => setMode(mode === "record" ? null : "record")}>Record as held</Button>
            <Button size="sm" variant="outline" className="text-red-700" onClick={() => setMode(mode === "cancel" ? null : "cancel")}>Cancel</Button>
          </>
        )}
      </div>

      {expanded && (
        <ul className="mt-2 space-y-1 text-sm">
          {round.cooperatives.map((c) => (
            <li key={c.cooperativeId} className="text-gray-700">
              {c.name} <span className="text-xs text-gray-400">{c.sector}</span>
              {c.rating && <span className="ml-2 text-xs font-medium">{RATING_LABEL[c.rating]}</span>}
              {c.attended === false && <span className="ml-2 text-xs text-red-700">absent</span>}
              {c.observations && <span className="block pl-3 text-xs text-gray-500">{c.observations}</span>}
            </li>
          ))}
        </ul>
      )}

      {mode === "record" && (
        <div className="mt-3 space-y-3 rounded-lg border border-gray-200 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Held on" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
            {round.round_type === "sensitization" && (
              <Input label="Leaders who attended" type="number" value={leaders} onChange={(e) => setLeaders(e.target.value)} />
            )}
          </div>
          <label className="block text-sm font-medium text-gray-700">
            {round.round_type === "sensitization" ? "What was covered and what leaders were told" : "What was found"}
            <textarea className={`${textareaClass} mt-1`} rows={3} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <div className="space-y-1.5">
            {round.cooperatives.map((c) => {
              const o = outcomes[c.cooperativeId];
              const update = (patch: Partial<typeof o>) => setOutcomes((all) => ({ ...all, [c.cooperativeId]: { ...o, ...patch } }));
              return (
                <div key={c.cooperativeId} className="grid gap-2 md:grid-cols-[1fr_auto_170px_1fr] md:items-center">
                  <span className="text-sm text-gray-800">{c.name}</span>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={o.attended} onChange={(e) => update({ attended: e.target.checked })} />
                    {round.round_type === "sensitization" ? "Represented" : "Visited"}
                  </label>
                  <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={o.rating} onChange={(e) => update({ rating: e.target.value })}>
                    <option value="">No rating</option>
                    {meta.overallRatings.map((r) => <option key={r} value={r}>{RATING_LABEL[r]}</option>)}
                  </select>
                  <input
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                    placeholder="Observations"
                    value={o.observations}
                    onChange={(e) => update({ observations: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button size="sm" onClick={save}>Save record</Button>
        </div>
      )}
      {mode === "cancel" && (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3">
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button size="sm" variant="danger" onClick={save}>Cancel sitting</Button>
        </div>
      )}
    </Card>
  );
}

function CommitteeCard({ committee, onChanged }: { committee: Committee; onChanged: (m: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", position: "", organisation: "", phone: "" });
  const [error, setError] = useState("");

  const add = async () => {
    setError("");
    try {
      const res = await api.post(`/rca-audits/committees/${committee.id}/members`, form);
      setForm({ name: "", position: "", organisation: "", phone: "" });
      setAdding(false);
      onChanged(res.message);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const remove = async (memberId: string) => {
    try {
      const res = await api.delete(`/rca-audits/committees/${committee.id}/members/${memberId}`);
      onChanged(res.message);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-gray-900">{committee.name}</p>
          <p className="text-xs text-gray-500">{committee.level === "district" ? "District committee" : `${committee.sector} sector committee`}</p>
        </div>
        {committee.canManage && (
          <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <span className="flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Member</span>
          </Button>
        )}
      </div>
      {committee.members.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No members recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {committee.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-gray-700">
              <span>
                <strong>{m.name}</strong>
                {m.position ? ` — ${m.position}` : ""}
                {m.organisation ? `, ${m.organisation}` : ""}
                {m.phone ? ` · ${m.phone}` : ""}
              </span>
              {committee.canManage && (
                <button className="text-gray-400 hover:text-red-600" title="Remove" onClick={() => remove(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <Input label="Organisation / cooperative" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
          <div className="md:col-span-2"><Button size="sm" onClick={add}>Add to committee</Button></div>
        </div>
      )}
    </Card>
  );
}

function ProgrammeTab({ meta, flash }: { meta: Meta; flash: (m: string) => void }) {
  const runsProgramme = meta.viewer.canRunProgramme;
  const [programme, setProgramme] = useState<{ sectorRounds: Standing[]; district: Standing[] } | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [scheduling, setScheduling] = useState<{ roundType: string; sector: string | null } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, c, p] = await Promise.all([
        api.get("/rca-audits/rounds"),
        api.get("/rca-audits/committees"),
        runsProgramme ? api.get("/rca-audits/programme") : Promise.resolve(null),
      ]);
      setRounds(r.data ?? []);
      setCommittees(c.data ?? []);
      if (p) setProgramme(p.data);
    } catch (err) {
      setError(errorText(err));
    }
  }, [runsProgramme]);
  useEffect(() => { load(); }, [load]);

  const changed = (m: string) => { flash(m); setScheduling(null); load(); };

  const createCommittee = async (level: "sector" | "district", sector: string | null) => {
    try {
      const res = await api.post("/rca-audits/committees", { level, sector });
      changed(res.message);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const missingCommittees = runsProgramme
    ? [
        ...(meta.viewer.tier !== "sector" && !committees.some((c) => c.level === "district") ? [{ level: "district" as const, sector: null }] : []),
        ...meta.sectors
          .filter((s) => meta.viewer.tier !== "sector" || s === meta.viewer.sector)
          .filter((s) => !committees.some((c) => c.level === "sector" && c.sector === s))
          .map((s) => ({ level: "sector" as const, sector: s })),
      ]
    : [];

  const upcoming = rounds.filter((r) => r.status === "scheduled");
  const past = rounds.filter((r) => r.status !== "scheduled");

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {runsProgramme && programme && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">The routine</h2>
              <p className="text-sm text-gray-600">
                Sector committees visit their cooperatives every month. The district committee visits every trimester, and every
                trimester all cooperative leaders are called to a sensitization session.
              </p>
            </div>
            <Button size="sm" onClick={() => setScheduling({ roundType: meta.viewer.tier === "sector" ? "sector_general" : "district_general", sector: null })}>
              <span className="flex items-center gap-1"><CalendarClock className="h-4 w-4" /> Schedule a sitting</span>
            </Button>
          </div>
          {programme.district.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">District — this trimester</p>
              {programme.district.map((s) => (
                <StandingCard key={s.roundType} s={s} canSchedule onSchedule={() => setScheduling({ roundType: s.roundType, sector: null })} />
              ))}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sector general audits — this month</p>
            {programme.sectorRounds.map((s) => (
              <StandingCard key={s.sector} s={s} canSchedule onSchedule={() => setScheduling({ roundType: "sector_general", sector: s.sector })} />
            ))}
          </div>
        </Card>
      )}

      {scheduling && <ScheduleRoundForm meta={meta} preset={scheduling} onDone={changed} onCancel={() => setScheduling(null)} />}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          {meta.viewer.tier === "cooperative" ? "Visits and sessions for your cooperative" : "Upcoming sittings"}
        </h2>
        {upcoming.length === 0 && <p className="text-sm text-gray-500">Nothing scheduled.</p>}
        {upcoming.map((r) => <RoundCard key={r.id} round={r} meta={meta} onChanged={changed} />)}
        {past.length > 0 && (
          <>
            <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Held and cancelled</h3>
            {past.map((r) => <RoundCard key={r.id} round={r} meta={meta} onChanged={changed} />)}
          </>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Users className="h-5 w-5" /> Committees</h2>
        {committees.length === 0 && <p className="text-sm text-gray-500">No committee has been set up yet.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {committees.map((c) => <CommitteeCard key={c.id} committee={c} onChanged={changed} />)}
        </div>
        {missingCommittees.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {missingCommittees.map((m) => (
              <Button key={`${m.level}-${m.sector}`} size="sm" variant="outline" onClick={() => createCommittee(m.level, m.sector)}>
                <span className="flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Set up {m.level === "district" ? "the district committee" : `${m.sector} committee`}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

type TabKey = "audits" | "announce" | "programme";

export function RcaAudits() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [summary, setSummary] = useState({ yourTurn: 0, open: 0, scheduled: 0, completed: 0 });
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const tab = (searchParams.get("tab") as TabKey) || "audits";

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([
        api.get("/rca-audits/meta"),
        api.get(`/rca-audits${filter === "all" ? "" : `?status=${filter}`}`),
      ]);
      setMeta(m.data);
      setAudits(a.data ?? []);
      setSummary(a.summary ?? summary);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => {
    setMessage(m);
    setError("");
    window.setTimeout(() => setMessage(""), 6000);
  };
  const changed = (m: string) => { flash(m); setRequesting(false); load(); };

  const tabs = useMemo(() => {
    if (!meta) return [];
    return [
      { key: "audits" as const, label: "Audits", Icon: ClipboardCheck },
      ...(meta.viewer.canAnnounce ? [{ key: "announce" as const, label: "Announce an audit", Icon: Megaphone }] : []),
      { key: "programme" as const, label: meta.viewer.tier === "cooperative" ? "Visits & sessions" : "General audit programme", Icon: CalendarClock },
    ];
  }, [meta]);

  if (loading) return <p className="text-gray-500">Loading audits…</p>;
  if (!meta) return <p className="text-red-600">{error || "Could not load audits."}</p>;
  if (!meta.viewer.tier) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-gray-900">RCA audits</h1>
        <p className="mt-2 text-gray-600">
          Audits are requested by a cooperative's manager or by the sector and district officers. If something in your cooperative
          worries you, report it from Services &amp; requests and it will reach the officers.
        </p>
      </Card>
    );
  }

  const yourTurn = audits.filter((a) => a.viewerPosition === "your_turn");
  const others = audits.filter((a) => a.viewerPosition !== "your_turn");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">RCA audits</h1>
          <p className="mt-1 text-gray-600">
            General and financial audits of cooperatives in {meta.district} district — requested up the chain, announced by the RCA,
            and the routine programme of visits and sensitization sessions.
          </p>
        </div>
        {tab === "audits" && meta.viewer.canRequest && !requesting && (
          <Button onClick={() => setRequesting(true)}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Request an audit</span>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setSearchParams({ tab: key })}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${tab === key ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {message && <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {tab === "audits" && (
        <>
          {requesting && <RequestForm meta={meta} onDone={changed} onCancel={() => setRequesting(false)} />}

          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Waiting on you", value: summary.yourTurn, tone: "text-[#2D6A4F]" },
              { label: "Open", value: summary.open, tone: "text-gray-900" },
              { label: "Scheduled", value: summary.scheduled, tone: "text-blue-700" },
              { label: "Completed", value: summary.completed, tone: "text-gray-900" },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
                <p className={`text-2xl font-semibold ${s.tone}`}>{s.value}</p>
              </Card>
            ))}
          </div>

          <div className="flex gap-2">
            {(["open", "closed", "all"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "primary" : "outline"} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
              </Button>
            ))}
          </div>

          {audits.length === 0 && (
            <Card className="p-6 text-center text-gray-500">
              No audits {filter === "open" ? "open" : filter === "closed" ? "closed" : ""} for you to see.
              {user?.role === "manager" && " Use “Request an audit” if your cooperative needs one."}
            </Card>
          )}

          {yourTurn.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#2D6A4F]">Waiting on you</h2>
              {yourTurn.map((a) => <AuditCard key={a.id} audit={a} meta={meta} onChanged={changed} />)}
            </div>
          )}
          {others.length > 0 && (
            <div className="space-y-3">
              {yourTurn.length > 0 && <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Everything else</h2>}
              {others.map((a) => <AuditCard key={a.id} audit={a} meta={meta} onChanged={changed} />)}
            </div>
          )}
        </>
      )}

      {tab === "announce" && meta.viewer.canAnnounce && <AnnounceForm meta={meta} onDone={(m) => { changed(m); setSearchParams({ tab: "audits" }); }} />}
      {tab === "programme" && <ProgrammeTab meta={meta} flash={flash} />}
    </div>
  );
}
