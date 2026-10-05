import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import {
  UserMinus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Undo2,
  Inbox,
  ShieldQuestion,
  Calculator,
  Wallet,
  Users,
  Gavel,
  CalendarPlus,
  Award,
  Archive,
  BadgeCheck,
  Banknote,
  Circle,
  Copy,
  Printer,
  SkipForward,
} from "lucide-react";

/**
 * One of the seven steps of leaving a cooperative, as the server computes it.
 *
 * The backend owns this list (services/exitProcess.ts) and every response that
 * carries a request carries its process, so what this page shows a member is
 * exactly what the server will insist on. Nothing here is inferred from the
 * status string.
 */
interface ProcessStep {
  key: string;
  order: number;
  title: string;
  description: string;
  actor: "member" | "manager" | "assembly" | "system";
  state: "done" | "current" | "blocked" | "pending" | "skipped";
  completedAt?: string | null;
  blockedReason?: string;
  detail?: string;
}

interface ExitProcess {
  steps: ProcessStep[];
  currentStepKey: string | null;
  percentComplete: number;
  nextAction: string | null;
}

/** The settlement the cooperative actually paid, once it has recorded one. */
interface RecordedSettlement {
  id: string;
  own_savings: string;
  share_capital: string;
  special_levies: string;
  share_of_net_worth: string;
  outstanding_loans: string;
  other_deductions: string;
  other_deductions_note: string | null;
  gross_entitlement: string;
  net_payable: string;
  balance_owed_by_member: string;
  settlement_method: string;
  payment_reference: string | null;
  amount_paid: string;
  settled_on: string;
  notes: string | null;
  acknowledged_by_member: boolean;
  acknowledged_at: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

/** The certificate of past membership, issued when the release is recorded. */
interface MembershipCertificate {
  id: string;
  certificate_number: string;
  verification_code: string;
  issued_at: string;
  issued_by_name: string | null;
  statement: string;
  months_of_membership: number | null;
  joined_on: string | null;
  left_on: string | null;
  roles_held: string | null;
  total_contributions: string | null;
  settlement_amount: string | null;
  cooperative_name: string;
  registration_number: string | null;
  member_name: string;
  membership_number: string | null;
  revoked_at?: string | null;
}

interface ExitRequest {
  id: string;
  cooperative_id: string;
  cooperative_name: string;
  member_id: string | null;
  membership_number: string | null;
  member_savings: string | null;
  requested_by: string;
  requester_name: string;
  requester_email: string;
  reason_category: string;
  reason_detail: string;
  preferred_exit_date: string | null;
  savings_instruction: string;
  contact_phone: string | null;
  status:
    | "pending"
    | "under_review"
    | "meeting_scheduled"
    | "meeting_held"
    | "approved"
    | "rejected"
    | "withdrawn";
  meetings: AssemblyMeeting[];
  settlement: RecordedSettlement | null;
  certificate: MembershipCertificate | null;
  member_archived_at: string | null;
  process: ExitProcess;
  response_due_at: string;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

/** The general assembly convened to decide one removal request. */
interface AssemblyMeeting {
  id: string;
  scheduledFor: string;
  location: string | null;
  agenda: string;
  status: "scheduled" | "held" | "cancelled";
  membersEligible: number | null;
  membersPresent: number | null;
  quorumRequired: number | null;
  quorumMet: boolean | null;
  assemblyKind: "ordinary" | "extraordinary";
  callNumber: number;
  eligibleBasis: "members" | "delegates";
  secondCallDueBy: string | null;
  referredToAgencyAt: string | null;
  reportDueLocalAt: string | null;
  reportDueAgencyAt: string | null;
  reportedLocalAt: string | null;
  reportedAgencyAt: string | null;
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  resolution: "approve_exit" | "reject_exit" | "deferred" | null;
  resolutionNote: string | null;
  cancellationReason: string | null;
  convenedByName: string | null;
  heldAt: string | null;
  createdAt: string;
}

/**
 * The assembly rules as published by the RCA, served by /membership/policy.
 * An extraordinary assembly is convened for a removal request because it cannot
 * wait for the March or October ordinary sitting.
 */
interface MeetingRules {
  kind: "ordinary" | "extraordinary";
  matter: string;
  noticeDays: number;
  quorumFirstCall: number;
  quorumSecondCall: number;
  secondCallWindow: { amount: number; unit: string };
  majorityRequired: number;
  reserved: boolean;
  reportDeadlines: { sectorAndDistrictWorkingDays: number; nationalAgencyDays: number };
  delegateThreshold: number;
  ordinaryMonths: number[];
  source: string;
  explanation?: string;
}

interface MemberRecord {
  id: string;
  membership_number: string;
  total_savings: string;
  full_name: string;
}

const REASON_LABELS: Record<string, string> = {
  relocation: "I am relocating",
  financial_hardship: "Financial hardship",
  joining_another_cooperative: "Joining another cooperative",
  dissatisfied_with_management: "Dissatisfied with how the cooperative is run",
  health: "Health reasons",
  retirement: "Retirement",
  business_closed: "My business has closed",
  other: "Other reason",
};

const SAVINGS_LABELS: Record<string, string> = {
  refund_mobile_money: "Refund my savings by mobile money",
  refund_bank_transfer: "Refund my savings by bank transfer",
  refund_cash: "Refund my savings in cash at the office",
  donate_to_cooperative: "Leave my savings to the cooperative",
  no_savings_held: "I hold no savings with the cooperative",
};

const RESOLUTION_LABELS: Record<string, string> = {
  approve_exit: "Release the member",
  reject_exit: "Refuse the request",
  deferred: "Deferred to another assembly",
};

const STATUS_STYLES: Record<string, { label: string; badge: string; Icon: typeof Clock }> = {
  pending: { label: "Awaiting response", badge: "bg-amber-100 text-amber-800", Icon: Clock },
  under_review: { label: "Under review", badge: "bg-blue-100 text-blue-800", Icon: ShieldQuestion },
  meeting_scheduled: { label: "Assembly called", badge: "bg-indigo-100 text-indigo-800", Icon: Users },
  meeting_held: { label: "Assembly has voted", badge: "bg-purple-100 text-purple-800", Icon: Gavel },
  approved: { label: "Approved", badge: "bg-green-100 text-green-800", Icon: CheckCircle2 },
  rejected: { label: "Not approved", badge: "bg-red-100 text-red-700", Icon: XCircle },
  withdrawn: { label: "Withdrawn by you", badge: "bg-gray-100 text-gray-700", Icon: Undo2 },
  reversed: { label: "Exit reversed", badge: "bg-slate-100 text-slate-700", Icon: Undo2 },
};

/** Statuses in which a request is still live and being worked. */
const OPEN_STATUSES = ["pending", "under_review", "meeting_scheduled", "meeting_held"];

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Whole days from now until the deadline; negative once it has passed. */
const daysUntil = (value: string) =>
  Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);

const money = (v: number | string | null | undefined) =>
  v == null ? "—" : `RWF ${Number(v).toLocaleString()}`;

const SETTLEMENT_METHOD_LABELS: Record<string, string> = {
  mobile_money: "Paid by mobile money",
  bank_transfer: "Paid by bank transfer",
  cash: "Paid in cash against a signed receipt",
  donated_to_cooperative: "Left to the cooperative at the member's request",
  offset_against_loan: "Set off against the outstanding loan",
  nothing_due: "Nothing was due either way",
};

const STEP_ACTOR_LABELS: Record<string, string> = {
  member: "The member",
  manager: "The cooperative office",
  assembly: "The general assembly",
  system: "Automatic",
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROCESS, DRAWN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The complaint this answers is that nobody could tell what happens when a
 * member asks to leave. A status badge reading "meeting_held" tells a member
 * nothing about whether their money is coming, or when they get proof they were
 * ever a member.
 *
 * So the seven steps are drawn out, in order, with who moves each one and what
 * has actually happened. The list comes from the server, which is also what
 * enforces it, so this cannot show a step as done that the server would refuse
 * to build on.
 */
function ProcessTracker({ process, compact }: { process: ExitProcess; compact?: boolean }) {
  if (!process?.steps?.length) return null;

  const stateStyles: Record<string, { ring: string; text: string; Icon: typeof Circle }> = {
    done: { ring: "bg-green-600 border-green-600 text-white", text: "text-gray-900", Icon: CheckCircle2 },
    current: { ring: "bg-white border-[#2D6A4F] text-[#2D6A4F]", text: "text-gray-900 font-medium", Icon: Circle },
    blocked: { ring: "bg-white border-red-500 text-red-600", text: "text-gray-900 font-medium", Icon: AlertTriangle },
    pending: { ring: "bg-white border-gray-300 text-gray-400", text: "text-gray-500", Icon: Circle },
    skipped: { ring: "bg-gray-100 border-gray-200 text-gray-400", text: "text-gray-400", Icon: SkipForward },
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">How leaving works, and where this request is</p>
        <span className="text-xs font-semibold text-gray-600">{process.percentComplete}% complete</span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-[#2D6A4F] transition-all"
          style={{ width: `${process.percentComplete}%` }}
        />
      </div>

      <ol className="space-y-0">
        {process.steps.map((step, index) => {
          const style = stateStyles[step.state] ?? stateStyles.pending;
          const Icon = style.Icon;
          const last = index === process.steps.length - 1;
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${style.ring}`}
                >
                  {step.state === "done" ? (
                    <Icon className="h-4 w-4" />
                  ) : step.state === "blocked" ? (
                    <Icon className="h-3.5 w-3.5" />
                  ) : (
                    step.order
                  )}
                </span>
                {!last && (
                  <span
                    className={`w-0.5 flex-1 ${step.state === "done" ? "bg-green-600" : "bg-gray-200"}`}
                    style={{ minHeight: compact ? 12 : 20 }}
                  />
                )}
              </div>
              <div className={`pb-4 ${last ? "pb-0" : ""}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className={`text-sm ${style.text}`}>{step.title}</p>
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">
                    {STEP_ACTOR_LABELS[step.actor] ?? step.actor}
                  </span>
                  {step.completedAt && (
                    <span className="text-[11px] text-gray-400">{formatDate(step.completedAt)}</span>
                  )}
                </div>
                {!compact && <p className="mt-0.5 text-xs text-gray-600">{step.description}</p>}
                {step.detail && <p className="mt-0.5 text-xs text-gray-500">{step.detail}</p>}
                {step.blockedReason && (
                  <p className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                    {step.blockedReason}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {process.nextAction && (
        <p className="mt-2 rounded-lg border border-[#2D6A4F]/20 bg-[#2D6A4F]/5 px-3 py-2 text-xs text-[#1b4332]">
          <strong>Next:</strong> {process.nextAction}
        </p>
      )}
    </div>
  );
}

/**
 * The settlement as it was actually paid, line by line.
 *
 * Shown to the member as well as to the office. A member handed a single
 * figure has no way to check it; a member shown savings, shares, their share of
 * the cooperative and what was deducted can.
 */
function SettlementRecord({
  settlement,
  onAcknowledge,
  acknowledging,
}: {
  settlement: RecordedSettlement;
  onAcknowledge?: () => void;
  acknowledging?: boolean;
}) {
  const lines: Array<[string, string, boolean]> = [
    ["Savings returned", money(settlement.own_savings), false],
    ["Share capital returned", money(settlement.share_capital), false],
    ["Special levies returned", money(settlement.special_levies), false],
    ["Share of the cooperative's accumulated value", money(settlement.share_of_net_worth), false],
    ["Less: outstanding loans", money(settlement.outstanding_loans), true],
  ];
  if (Number(settlement.other_deductions) > 0) {
    lines.push(["Less: other deductions", money(settlement.other_deductions), true]);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-gray-700" />
          <p className="text-sm font-medium text-gray-900">Settlement of the member's assets</p>
        </div>
        <span className="text-xs text-gray-500">Settled {formatDate(settlement.settled_on)}</span>
      </div>

      <dl className="space-y-1 text-sm">
        {lines.map(([label, value, deduction]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-600">{label}</dt>
            <dd className={deduction ? "font-medium text-red-600" : "font-medium text-gray-900"}>
              {deduction ? `(${value})` : value}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
          <dt className="font-medium text-gray-900">Net payable</dt>
          <dd className="font-semibold text-gray-900">{money(settlement.net_payable)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-600">Actually paid</dt>
          <dd className="font-semibold text-[#2D6A4F]">{money(settlement.amount_paid)}</dd>
        </div>
        {Number(settlement.balance_owed_by_member) > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-red-700">Still owed by the member</dt>
            <dd className="font-semibold text-red-700">
              {money(settlement.balance_owed_by_member)}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs text-gray-600">
        {SETTLEMENT_METHOD_LABELS[settlement.settlement_method] ?? settlement.settlement_method}
        {settlement.payment_reference ? ` · reference ${settlement.payment_reference}` : ""}
        {settlement.recorded_by_name ? ` · recorded by ${settlement.recorded_by_name}` : ""}
      </p>
      {settlement.other_deductions_note && (
        <p className="mt-1 text-xs text-gray-600">
          Other deductions: {settlement.other_deductions_note}
        </p>
      )}
      {settlement.notes && <p className="mt-1 text-xs text-gray-600">Note: {settlement.notes}</p>}

      {settlement.acknowledged_by_member ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Receipt confirmed by the member on {formatDate(settlement.acknowledged_at)}
        </p>
      ) : onAcknowledge ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            Did you receive this? Confirming it closes the settlement on the record. If the amount is
            wrong, do not confirm — raise it with the cooperative first.
          </p>
          <Button
            size="sm"
            className="mt-2"
            disabled={acknowledging}
            onClick={onAcknowledge}
          >
            {acknowledging ? "Confirming…" : "Confirm I received this"}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-700">Awaiting the member's confirmation of receipt.</p>
      )}
    </div>
  );
}

/**
 * The certificate of past membership.
 *
 * Deliberately printable. The reason a departing member needs this at all is to
 * hand it to somebody else — a bank, another cooperative — so a version that
 * only exists inside this app would not do the job. `window.print()` on a
 * print-styled block is enough; there is no server-side PDF and pretending
 * otherwise would be worse than this.
 */
function CertificateCard({ certificate }: { certificate: MembershipCertificate }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(certificate.verification_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some browsers; the code is on screen
      // anyway, so failing silently is better than an alert about it.
    }
  };

  return (
    <div className="rounded-xl border-2 border-[#2D6A4F]/30 bg-white p-6 print:border-black">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-2">
          <Award className="h-6 w-6 text-[#2D6A4F]" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#2D6A4F]">
              Certificate of membership
            </p>
            <p className="text-xs text-gray-500">{certificate.cooperative_name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-gray-900">
            {certificate.certificate_number}
          </p>
          <p className="text-xs text-gray-500">Issued {formatDate(certificate.issued_at)}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-gray-800">{certificate.statement}</p>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-gray-500">Member</dt>
          <dd className="font-medium text-gray-900">{certificate.member_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Membership number</dt>
          <dd className="font-medium text-gray-900">{certificate.membership_number ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Member from / to</dt>
          <dd className="font-medium text-gray-900">
            {formatDate(certificate.joined_on)} — {formatDate(certificate.left_on)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Length of membership</dt>
          <dd className="font-medium text-gray-900">
            {certificate.months_of_membership != null
              ? `${certificate.months_of_membership} months`
              : "—"}
          </dd>
        </div>
        {certificate.roles_held && (
          <div>
            <dt className="text-xs text-gray-500">Office held</dt>
            <dd className="font-medium text-gray-900">{certificate.roles_held}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-gray-500">Total contributed</dt>
          <dd className="font-medium text-gray-900">{money(certificate.total_contributions)}</dd>
        </div>
        {certificate.registration_number && (
          <div>
            <dt className="text-xs text-gray-500">Cooperative registration</dt>
            <dd className="font-medium text-gray-900">{certificate.registration_number}</dd>
          </div>
        )}
        {certificate.settlement_amount != null && (
          <div>
            <dt className="text-xs text-gray-500">Settlement paid on exit</dt>
            <dd className="font-medium text-gray-900">{money(certificate.settlement_amount)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
        <div>
          <p className="text-xs text-gray-500">Verification code</p>
          <button
            type="button"
            onClick={copyCode}
            title="Copy — anyone can check this code against the register"
            className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-gray-900 hover:text-[#2D6A4F]"
          >
            {certificate.verification_code}
            <Copy className="h-3.5 w-3.5" />
            {copied && <span className="text-xs font-sans text-green-700">copied</span>}
          </button>
          {certificate.issued_by_name && (
            <p className="mt-1 text-xs text-gray-500">Issued by {certificate.issued_by_name}</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()} className="print:hidden">
          <span className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Print or save as PDF
          </span>
        </Button>
      </div>
    </div>
  );
}

interface Settlement {
  member: { id: string; fullName: string; membershipNumber: string; membershipDate: string };
  cooperative: { id: string; name: string; memberCount: number; totalMemberSavings: number; shareCapital: number };
  ownFunds: { savings: number; shareCapital: number; specialLevies: number; total: number };
  shareOfCooperative: {
    distributableNetWorth: number;
    sharePercentage: number;
    amount: number;
    basis: string;
    estimated: boolean;
  };
  deductions: { outstandingLoans: number; total: number };
  grossEntitlement: number;
  netPayable: number;
  balanceOwedToCooperative: number;
  /**
   * The calculation read top to bottom. Negative amounts are deductions. The
   * order matters — a member told "RWF 0" is entitled to see which line
   * produced it — so the server sends the sequence rather than letting each
   * screen invent its own.
   */
  lines: Array<{ label: string; amount: number; note: string }>;
  warnings: string[];
  disclaimer: string;
  calculatedAt: string;
}

/**
 * What the settlement form is opened with: what has already been recorded (if
 * anything), the live calculation, and what the member asked for when they filed.
 */
interface SettlementPreview {
  recorded: RecordedSettlement | null;
  calculated: Settlement | null;
  memberInstruction: string;
  suggestedMethod: string;
  contactPhone: string | null;
  methods: string[];
  methodLabels: Record<string, string>;
  canRecord: boolean;
  notOnRegister: boolean;
}

/**
 * "What do I walk away with?" — own funds, plus a share of what the cooperative
 * itself is worth, less anything still owed.
 */
function SettlementCalculator() {
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  const calculate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: Settlement }>("/membership/settlement");
      setSettlement(res.data);
      setShown(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not calculate your settlement.");
      setShown(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-gray-700" />
            <h3 className="text-lg font-semibold text-gray-900">What you would leave with</h3>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Your savings and share capital, plus your share of what the cooperative is worth, less anything you still owe.
          </p>
        </div>
        <Button variant="outline" onClick={calculate} disabled={loading}>
          {loading ? "Calculating…" : shown ? "Recalculate" : "Calculate my settlement"}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {settlement && (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl bg-[#2D6A4F] px-5 py-4 text-white">
            <p className="text-xs uppercase tracking-wide opacity-80">Estimated net payable to you</p>
            <p className="text-3xl font-semibold mt-1">{money(settlement.netPayable)}</p>
            {settlement.balanceOwedToCooperative > 0 && (
              <p className="text-sm mt-2 text-red-100">
                You would still owe {money(settlement.balanceOwedToCooperative)} to the cooperative.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-2.5 text-gray-600">Your savings balance</td>
                  <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.savings)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">Share capital you paid in</td>
                  <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.shareCapital)}</td>
                </tr>
                {settlement.ownFunds.specialLevies > 0 && (
                  <tr>
                    <td className="py-2.5 text-gray-600">Special levies paid</td>
                    <td className="py-2.5 text-right font-medium text-gray-900">{money(settlement.ownFunds.specialLevies)}</td>
                  </tr>
                )}
                <tr className="bg-gray-50">
                  <td className="py-2.5 pl-2 font-medium text-gray-900">Your own funds</td>
                  <td className="py-2.5 pr-2 text-right font-semibold text-gray-900">{money(settlement.ownFunds.total)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">
                    Your share of the cooperative's value
                    <span className="block text-xs text-gray-500">
                      {settlement.shareOfCooperative.sharePercentage}% of {money(settlement.shareOfCooperative.distributableNetWorth)} distributable
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-medium text-gray-900">
                    {money(settlement.shareOfCooperative.amount)}
                  </td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="py-2.5 pl-2 font-medium text-gray-900">Gross entitlement</td>
                  <td className="py-2.5 pr-2 text-right font-semibold text-gray-900">{money(settlement.grossEntitlement)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-gray-600">Less outstanding loans</td>
                  <td className="py-2.5 text-right font-medium text-red-600">
                    {settlement.deductions.outstandingLoans > 0 ? `− ${money(settlement.deductions.outstandingLoans)}` : "—"}
                  </td>
                </tr>
                <tr className="border-t-2 border-gray-300">
                  <td className="py-3 font-semibold text-gray-900">Net payable</td>
                  <td className="py-3 text-right text-lg font-semibold text-[#2D6A4F]">{money(settlement.netPayable)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-gray-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <Wallet className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <p className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">How the cooperative's value was measured: </span>
                {settlement.shareOfCooperative.basis}
              </p>
            </div>
          </div>

          {settlement.warnings.length > 0 && (
            <ul className="space-y-2">
              {settlement.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-gray-500 border-t border-gray-200 pt-3">{settlement.disclaimer}</p>
        </div>
      )}
    </Card>
  );
}

/**
 * The general assembly on one request, as both the member and the reviewer see
 * it: when it sits, whether it was competent, and how the vote went.
 */
function MeetingPanel({ meeting }: { meeting: AssemblyMeeting }) {
  const cast =
    (meeting.votesFor ?? 0) + (meeting.votesAgainst ?? 0) + (meeting.votesAbstain ?? 0);

  return (
    <div
      className={`rounded-xl border px-4 py-4 ${
        meeting.status === "cancelled"
          ? "border-gray-200 bg-gray-50"
          : meeting.status === "held"
            ? "border-purple-200 bg-purple-50"
            : "border-indigo-200 bg-indigo-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="w-4 h-4 text-gray-700" />
          <p className="font-medium text-gray-900">
            {meeting.status === "held"
              ? "General assembly — held"
              : meeting.status === "cancelled"
                ? "General assembly — cancelled"
                : "General assembly called"}
            <span className="ml-2 text-xs font-normal text-gray-600">
              {meeting.assemblyKind === "extraordinary" ? "Extraordinary" : "Ordinary"} ·{" "}
              {meeting.callNumber === 2 ? "second call" : "first call"}
            </span>
          </p>
        </div>
        <p className="text-sm text-gray-600">
          {formatDate(meeting.scheduledFor)}
          {meeting.location && ` · ${meeting.location}`}
        </p>
      </div>

      {meeting.status === "cancelled" ? (
        <p className="mt-2 text-sm text-gray-700">{meeting.cancellationReason}</p>
      ) : meeting.status === "scheduled" ? (
        <>
          <p className="mt-2 text-sm text-gray-700">
            {meeting.quorumRequired} of {meeting.membersEligible} members must attend for the vote
            to stand.
            {meeting.convenedByName && ` Convened by ${meeting.convenedByName}.`}
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Agenda</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-700">
              {meeting.agenda}
            </pre>
          </details>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-700">
              <span className="font-medium text-gray-900">{meeting.membersPresent}</span> of{" "}
              {meeting.membersEligible} {meeting.eligibleBasis ?? "members"} attended
            </span>
            <span className={meeting.quorumMet ? "text-[#2D6A4F]" : "text-red-700"}>
              {meeting.quorumMet
                ? `Quorum met (${meeting.quorumRequired} required)`
                : `Quorum not met (${meeting.quorumRequired} required)`}
            </span>
          </div>

          {cast > 0 && (
            <div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="bg-[#2D6A4F]"
                  style={{ width: `${((meeting.votesFor ?? 0) / cast) * 100}%` }}
                />
                <div
                  className="bg-red-500"
                  style={{ width: `${((meeting.votesAgainst ?? 0) / cast) * 100}%` }}
                />
                <div
                  className="bg-gray-400"
                  style={{ width: `${((meeting.votesAbstain ?? 0) / cast) * 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-sm text-gray-700">
                {meeting.votesFor} for · {meeting.votesAgainst} against · {meeting.votesAbstain}{" "}
                abstained
              </p>
            </div>
          )}

          {meeting.resolution && (
            <p className="text-sm">
              <span className="font-medium text-gray-900">Resolution: </span>
              {RESOLUTION_LABELS[meeting.resolution] ?? meeting.resolution}
            </p>
          )}
          {meeting.resolutionNote && (
            <p className="rounded-lg bg-white px-3 py-2 text-sm text-gray-700">
              {meeting.resolutionNote}
            </p>
          )}

          {/* A failed first call entitles the cooperative to a second on a
              lower threshold; a failed second goes to the RCA instead. */}
          {meeting.secondCallDueBy && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Quorum was not reached. A second call must sit by{" "}
              <span className="font-medium">{formatDate(meeting.secondCallDueBy)}</span>, and needs
              only half of those entitled to attend.
            </p>
          )}
          {meeting.referredToAgencyAt && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Two calls failed to reach quorum, so under the RCA rules the matter has gone to the
              National Agency for direction.
            </p>
          )}

          {/* The two statutory reporting deadlines the brochure attaches to
              every meeting held. */}
          {(meeting.reportDueLocalAt || meeting.reportDueAgencyAt) && (
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
              <p className="font-medium text-gray-800 mb-1">Minutes must be filed</p>
              <p>
                Sector and District administrations by{" "}
                <span className="font-medium text-gray-900">
                  {formatDate(meeting.reportDueLocalAt)}
                </span>
                {meeting.reportedLocalAt ? " — filed." : " — outstanding."}
              </p>
              <p>
                RCA by{" "}
                <span className="font-medium text-gray-900">
                  {formatDate(meeting.reportDueAgencyAt)}
                </span>
                {meeting.reportedAgencyAt ? " — filed." : " — outstanding."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const { Icon } = style;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
      <Icon className="w-3.5 h-3.5" />
      {style.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Member view — file a request, then track it
// ─────────────────────────────────────────────────────────────────────────────

function MemberView({ responseWindowDays }: { responseWindowDays: number }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [memberRecord, setMemberRecord] = useState<MemberRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [acknowledging, setAcknowledging] = useState(false);
  // Certificates outlive membership: a departed member keeps their login
  // precisely so this list keeps working after they are off the register.
  const [certificates, setCertificates] = useState<MembershipCertificate[]>([]);

  const [form, setForm] = useState({
    reasonCategory: "",
    reasonDetail: "",
    preferredExitDate: "",
    savingsInstruction: "refund_mobile_money",
    contactPhone: user?.phone ?? "",
    acknowledgedTerms: false,
  });

  const fetchRequests = async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Certificates are fetched even when the member has no open request:
      // the whole point of one is that it is still there years later.
      api
        .get<{ data: MembershipCertificate[] }>("/membership/certificates")
        .then((r) => setCertificates(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCertificates([]));

      const data = await api.get<{ data: ExitRequest[]; memberRecord: MemberRecord | null }>(
        "/membership/exit-requests/mine"
      );
      setRequests(data.data ?? []);
      setMemberRecord(data.memberRecord ?? null);
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load your membership requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const openRequest = useMemo(
    () => requests.find((r) => OPEN_STATUSES.includes(r.status)) ?? null,
    [requests]
  );
  const history = useMemo(() => requests.filter((r) => r.id !== openRequest?.id), [requests, openRequest]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!form.reasonCategory) return setFormError("Choose the reason that best describes your situation.");
    if (form.reasonDetail.trim().length < 20)
      return setFormError("Please explain your reason in at least 20 characters.");
    if (!form.acknowledgedTerms)
      return setFormError("Please confirm you understand what happens when you leave the cooperative.");

    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>("/membership/exit-requests", {
        reasonCategory: form.reasonCategory,
        reasonDetail: form.reasonDetail.trim(),
        preferredExitDate: form.preferredExitDate || undefined,
        savingsInstruction: form.savingsInstruction,
        contactPhone: form.contactPhone || undefined,
        acknowledgedTerms: form.acknowledgedTerms,
      });
      setSuccessMessage(res.message);
      setShowForm(false);
      setForm({
        reasonCategory: "",
        reasonDetail: "",
        preferredExitDate: "",
        savingsInstruction: "refund_mobile_money",
        contactPhone: user?.phone ?? "",
        acknowledgedTerms: false,
      });
      await fetchRequests();
    } catch (err: any) {
      setFormError(err?.message ?? "Could not submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    setLoadError("");
    try {
      await api.patch(`/membership/exit-requests/${id}/withdraw`, {});
      setSuccessMessage("Your request has been withdrawn. You remain a member.");
      await fetchRequests();
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not withdraw the request.");
    }
  };

  /**
   * The member confirms they actually received what the cooperative says it
   * paid. This is the only point in the whole procedure where the member has
   * the last word, which is exactly why it exists.
   */
  const handleAcknowledge = async (id: string) => {
    setLoadError("");
    setAcknowledging(true);
    try {
      const res = await api.patch<{ message: string }>(
        `/membership/exit-requests/${id}/settlement/acknowledge`,
        {}
      );
      setSuccessMessage(res.message);
      await fetchRequests();
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not confirm receipt.");
    } finally {
      setAcknowledging(false);
    }
  };

  if (loading) {
    return <p className="text-gray-500">Loading your membership status…</p>;
  }

  if (!user?.cooperativeId) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <p className="font-medium text-gray-900">You are not currently linked to a cooperative</p>
            <p className="text-sm text-gray-600 mt-1">
              There is no membership to withdraw from. If this looks wrong, contact your cooperative manager.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {successMessage}
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
      )}

      {/* Membership summary */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Your cooperative</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{user.cooperativeName}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-gray-600">
              {memberRecord?.membership_number && (
                <span>
                  Membership no. <span className="font-medium text-gray-900">{memberRecord.membership_number}</span>
                </span>
              )}
              {memberRecord?.total_savings != null && (
                <span>
                  Savings held{" "}
                  <span className="font-medium text-gray-900">
                    RWF {Number(memberRecord.total_savings).toLocaleString()}
                  </span>
                </span>
              )}
            </div>
          </div>

          {!openRequest && !showForm && (
            <Button variant="danger" onClick={() => { setShowForm(true); setSuccessMessage(""); }}>
              <span className="flex items-center gap-2">
                <UserMinus className="w-4 h-4" />
                Request removal from cooperative
              </span>
            </Button>
          )}
        </div>

        {!memberRecord && (
          <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
            We could not match your account to an entry in the member register. You can still file a request — the
            manager will match it manually.
          </p>
        )}
      </Card>

      {/* What you would walk away with */}
      <SettlementCalculator />

      {/* Open request tracker */}
      {openRequest && (
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Your removal request</h3>
              <p className="text-sm text-gray-500 mt-0.5">Submitted {formatDate(openRequest.created_at)}</p>
            </div>
            <StatusBadge status={openRequest.status} />
          </div>

          {(() => {
            const remaining = daysUntil(openRequest.response_due_at);
            const overdue = remaining < 0;
            return (
              <div
                className={`mt-5 rounded-xl border px-4 py-3 ${
                  overdue ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock className={`w-4 h-4 ${overdue ? "text-red-600" : "text-blue-600"}`} />
                  <p className={`text-sm font-medium ${overdue ? "text-red-800" : "text-blue-900"}`}>
                    {overdue
                      ? `Response overdue by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"}`
                      : `Response due in ${remaining} day${remaining === 1 ? "" : "s"}`}
                  </p>
                </div>
                <p className={`text-xs mt-1 ${overdue ? "text-red-700" : "text-blue-800"}`}>
                  {user.cooperativeName} committed to respond by {formatDate(openRequest.response_due_at)}.
                  {overdue && " You may escalate this to your sector cooperative officer."}
                </p>
              </div>
            );
          })()}

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-gray-500">Reason</dt>
              <dd className="font-medium text-gray-900">
                {REASON_LABELS[openRequest.reason_category] ?? openRequest.reason_category}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Preferred exit date</dt>
              <dd className="font-medium text-gray-900">{formatDate(openRequest.preferred_exit_date)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">What you told the cooperative</dt>
              <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{openRequest.reason_detail}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Savings instruction</dt>
              <dd className="font-medium text-gray-900">
                {SAVINGS_LABELS[openRequest.savings_instruction] ?? openRequest.savings_instruction}
              </dd>
            </div>
          </dl>

          {/*
            The seven steps, and where this request has got to. This replaces
            the guessing a member previously had to do from a status badge.
          */}
          <div className="mt-6 border-t border-gray-200 pt-5">
            <ProcessTracker process={openRequest.process} />
          </div>

          {openRequest.meetings?.length > 0 && (
            <div className="mt-5 space-y-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                The general assembly deciding your request
              </p>
              {openRequest.meetings.map((m) => (
                <MeetingPanel key={m.id} meeting={m} />
              ))}
            </div>
          )}

          {openRequest.settlement && (
            <div className="mt-5">
              <SettlementRecord
                settlement={openRequest.settlement}
                acknowledging={acknowledging}
                onAcknowledge={() => handleAcknowledge(openRequest.id)}
              />
            </div>
          )}

          {openRequest.status === "pending" && (
            <p className="mt-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
              Your request has not yet been put to a general assembly. Members — not the office —
              decide whether one of their own is released, so the cooperative must call an assembly
              before it can answer you.
            </p>
          )}

          <div className="mt-6 border-t border-gray-200 pt-4">
            <Button variant="outline" onClick={() => handleWithdraw(openRequest.id)}>
              <span className="flex items-center gap-2">
                <Undo2 className="w-4 h-4" />
                Withdraw this request
              </span>
            </Button>
            <p className="text-xs text-gray-500 mt-2">
              Withdrawing also cancels any assembly called to decide it.
            </p>
          </div>
        </Card>
      )}

      {/* The form */}
      {showForm && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900">Request removal from {user.cooperativeName}</h3>
          <p className="text-sm text-gray-600 mt-1">
            Tell the cooperative why you want to leave. Your reasons are read out to a general assembly of the
            members, who vote on whether to release you — the office cannot decide it alone. The cooperative has{" "}
            {responseWindowDays} days to answer, and you will be notified here and in your notifications at every
            step.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Select
              label="Reason for leaving *"
              value={form.reasonCategory}
              onChange={(e) => setForm({ ...form, reasonCategory: e.target.value })}
              options={[
                { value: "", label: "Select a reason…" },
                ...Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Explain in your own words *
              </label>
              <textarea
                rows={5}
                value={form.reasonDetail}
                onChange={(e) => setForm({ ...form, reasonDetail: e.target.value })}
                placeholder="Describe your situation so the cooperative leadership can consider your request properly."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {form.reasonDetail.trim().length}/20 characters minimum
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Preferred exit date"
                type="date"
                value={form.preferredExitDate}
                onChange={(e) => setForm({ ...form, preferredExitDate: e.target.value })}
              />
              <Input
                label="Phone to reach you on"
                type="tel"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="+250 7xx xxx xxx"
              />
            </div>

            <Select
              label="What should happen to your savings?"
              value={form.savingsInstruction}
              onChange={(e) => setForm({ ...form, savingsInstruction: e.target.value })}
              options={Object.entries(SAVINGS_LABELS).map(([value, label]) => ({ value, label }))}
            />

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.acknowledgedTerms}
                onChange={(e) => setForm({ ...form, acknowledgedTerms: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#2D6A4F] focus:ring-[#2D6A4F]"
              />
              <span className="text-sm text-gray-700">
                I understand that if this request is approved I will be removed from the member register, lose access to
                cooperative activities and services, and any outstanding obligations must be settled before my savings
                are released. *
              </span>
            </label>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="submit" variant="danger" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setFormError(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/*
        ── Proof of membership ───────────────────────────────────────────────
        A member released by the assembly is entitled to written proof that they
        belonged to the cooperative, for how long, and what they held. Without
        it they have nothing to show a bank or another cooperative. It is issued
        automatically when the release is recorded, so it cannot be forgotten or
        quietly withheld, and it lands here.
      */}
      {certificates.length > 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Your certificate of membership</h3>
            <p className="text-sm text-gray-600">
              Proof that you were a member of this cooperative. Print it or save it as a PDF; anyone
              can check the verification code against the register.
            </p>
          </div>
          {certificates.map((certificate) => (
            <CertificateCard key={certificate.id} certificate={certificate} />
          ))}
        </div>
      )}

      {/* Past requests */}
      {history.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Previous requests</h3>
          <div className="space-y-4">
            {history.map((r) => (
              <div key={r.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {REASON_LABELS[r.reason_category] ?? r.reason_category}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Submitted {formatDate(r.created_at)}
                      {r.decided_at && ` · Answered ${formatDate(r.decided_at)}`}
                      {r.decided_by_name && ` by ${r.decided_by_name}`}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.decision_note && (
                  <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{r.decision_note}</p>
                )}
                {r.member_archived_at && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                    <Archive className="h-3.5 w-3.5" />
                    Your register entry was archived on {formatDate(r.member_archived_at)}. Your
                    history with the cooperative is kept, not deleted.
                  </p>
                )}
                {r.settlement && (
                  <div className="mt-3">
                    <SettlementRecord
                      settlement={r.settlement}
                      acknowledging={acknowledging}
                      onAcknowledge={
                        r.settlement.acknowledged_by_member
                          ? undefined
                          : () => handleAcknowledge(r.id)
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** A member who left properly, kept on the record rather than deleted. */
interface ArchivedMember {
  id: string;
  full_name: string;
  membership_number: string | null;
  national_id: string | null;
  phone: string | null;
  membership_date: string | null;
  archived_at: string;
  archive_reason: string | null;
  total_contributions: string | null;
  cooperative_name: string;
  reason_category: string | null;
  decided_at: string | null;
  amount_paid: string | null;
  settlement_method: string | null;
  acknowledged_by_member: boolean | null;
  certificate_number: string | null;
  verification_code: string | null;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARCHIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A member who leaves is archived, not deleted. The difference matters:
 *
 *   • they stop counting towards the register, quorum and engagement figures,
 *     so the cooperative is not measured against people who have gone;
 *   • their history, their contributions and the settlement they were paid stay
 *     readable, so the cooperative can still answer for them years later;
 *   • the certificate issued to them is on the record next to their name, so a
 *     verification enquiry can be answered.
 *
 * Deleting the row would have destroyed all three.
 */
function ArchivePanel() {
  const [archive, setArchive] = useState<ArchivedMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: ArchivedMember[] }>("/membership/archive");
      setArchive(Array.isArray(res.data) ? res.data : []);
      setShown(true);
    } catch {
      setArchive([]);
      setShown(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <Archive className="mt-0.5 h-5 w-5 text-gray-700" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Archived members</h3>
            <p className="text-sm text-gray-600">
              Members released by a general assembly. They no longer count towards the register or
              quorum, but their history, their settlement and their certificate stay on the record.
            </p>
          </div>
        </div>
        {!shown && (
          <Button variant="outline" disabled={loading} onClick={load}>
            {loading ? "Loading…" : "Show the archive"}
          </Button>
        )}
      </div>

      {shown && archive.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">
          Nobody has been archived yet. Members appear here once their removal is approved.
        </p>
      )}

      {archive.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-3 py-2 font-medium text-gray-700">Member</th>
                <th className="px-3 py-2 font-medium text-gray-700">Member from</th>
                <th className="px-3 py-2 font-medium text-gray-700">Archived</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Contributed</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Settled</th>
                <th className="px-3 py-2 font-medium text-gray-700">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {archive.map((m) => (
                <tr key={m.id} className="border-b border-gray-200">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{m.full_name}</p>
                    <p className="text-xs text-gray-500">
                      {m.membership_number ?? "no membership number"}
                      {m.reason_category && ` · ${REASON_LABELS[m.reason_category] ?? m.reason_category}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(m.membership_date)}</td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(m.archived_at)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {money(m.total_contributions)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-gray-900">{money(m.amount_paid)}</span>
                    {m.amount_paid != null && (
                      <p
                        className={`text-xs ${
                          m.acknowledged_by_member ? "text-green-700" : "text-amber-700"
                        }`}
                      >
                        {m.acknowledged_by_member ? "receipt confirmed" : "unconfirmed"}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.certificate_number ? (
                      <>
                        <p className="font-mono text-xs text-gray-900">{m.certificate_number}</p>
                        <p className="font-mono text-[11px] text-gray-400">{m.verification_code}</p>
                      </>
                    ) : (
                      <span className="text-xs text-amber-700">not issued</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer view — the manager/admin queue
// ─────────────────────────────────────────────────────────────────────────────

function ReviewerView() {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [rules, setRules] = useState<MeetingRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Convening an assembly, and minuting what it resolved.
  const [conveningFor, setConveningFor] = useState<string | null>(null);
  const [convene, setConvene] = useState({ scheduledFor: "", location: "", agenda: "" });
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [vote, setVote] = useState({
    membersPresent: "",
    votesFor: "",
    votesAgainst: "",
    votesAbstain: "",
    resolution: "",
    resolutionNote: "",
  });

  // Settling the member's assets — step 5, the one the process used to skip.
  const [settlingFor, setSettlingFor] = useState<string | null>(null);
  const [settlementPreview, setSettlementPreview] = useState<SettlementPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [settleForm, setSettleForm] = useState({
    settlementMethod: "",
    paymentReference: "",
    amountPaid: "",
    settledOn: "",
    otherDeductions: "",
    otherDeductionsNote: "",
    notes: "",
  });

  /**
   * Turns an error from any request-scoped action into something a person can
   * act on.
   *
   * A 404 here means the row is gone — seeded over, withdrawn in another tab,
   * or decided by a colleague while this page sat open. Reporting the server's
   * bare "Request not found" leaves the manager staring at a card that is no
   * longer real and a button that will never work. Refreshing the queue makes
   * the stale card disappear, which is the actual fix.
   */
  const reportActionError = async (err: any, fallback: string) => {
    if (err?.status === 404) {
      setError(
        "That request no longer exists — it may have been withdrawn, already decided, or removed " +
          "when the database was reseeded. The list has been refreshed."
      );
      setSettlingFor(null);
      setSettlementPreview(null);
      setConveningFor(null);
      setRecordingFor(null);
      await fetchRequests();
      return;
    }
    setError(err?.message ?? fallback);
  };

  const fetchRequests = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ data: ExitRequest[]; meetingRules: MeetingRules }>(
        "/membership/exit-requests"
      );
      setRequests(data.data ?? []);
      setRules(data.meetingRules ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load removal requests.");
    } finally {
      setLoading(false);
    }
  };

  const callAssembly = async (requestId: string) => {
    if (!convene.scheduledFor) return setError("Choose when the assembly will sit.");
    if (!convene.location.trim()) return setError("Say where the assembly will sit.");
    setBusyId(requestId);
    setError("");
    try {
      const res = await api.post<{ message: string }>(
        `/membership/exit-requests/${requestId}/meeting`,
        {
          scheduledFor: new Date(convene.scheduledFor).toISOString(),
          location: convene.location.trim(),
          agenda: convene.agenda.trim() || undefined,
        }
      );
      setMessage(res.message);
      setConveningFor(null);
      setConvene({ scheduledFor: "", location: "", agenda: "" });
      await fetchRequests();
    } catch (err: any) {
      await reportActionError(err, "Could not call the assembly.");
    } finally {
      setBusyId(null);
    }
  };

  const recordOutcome = async (requestId: string, meetingId: string) => {
    if (!vote.resolution) return setError("What did the assembly resolve?");
    setBusyId(requestId);
    setError("");
    try {
      const res = await api.patch<{ message: string }>(
        `/membership/exit-requests/${requestId}/meeting/${meetingId}`,
        {
          membersPresent: Number(vote.membersPresent || 0),
          votesFor: Number(vote.votesFor || 0),
          votesAgainst: Number(vote.votesAgainst || 0),
          votesAbstain: Number(vote.votesAbstain || 0),
          resolution: vote.resolution,
          resolutionNote: vote.resolutionNote.trim() || undefined,
        }
      );
      setMessage(res.message);
      setRecordingFor(null);
      setVote({
        membersPresent: "",
        votesFor: "",
        votesAgainst: "",
        votesAbstain: "",
        resolution: "",
        resolutionNote: "",
      });
      await fetchRequests();
    } catch (err: any) {
      await reportActionError(err, "Could not record the meeting.");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Opens the settlement form, pre-filled with the figures the server computes.
   *
   * The manager is NOT asked to type in the member's savings and shares — the
   * system already holds them, and retyping them is how a member ends up paid
   * the wrong amount. What the manager supplies is how it was paid and the
   * reference, which are the only facts the system cannot know.
   */
  const openSettlement = async (requestId: string) => {
    setError("");
    setSettlingFor(requestId);
    setSettlementPreview(null);
    setPreviewLoading(true);
    try {
      const res = await api.get<{ data: SettlementPreview }>(
        `/membership/exit-requests/${requestId}/settlement`
      );
      setSettlementPreview(res.data);
      setSettleForm({
        settlementMethod: res.data.suggestedMethod ?? "mobile_money",
        paymentReference: "",
        amountPaid:
          res.data.calculated?.netPayable != null ? String(res.data.calculated.netPayable) : "",
        settledOn: new Date().toISOString().slice(0, 10),
        otherDeductions: "",
        otherDeductionsNote: "",
        notes: "",
      });
    } catch (err: any) {
      setSettlingFor(null);
      await reportActionError(err, "Could not price this member's settlement.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const recordSettlement = async (requestId: string) => {
    if (!settleForm.settlementMethod) return setError("How was the settlement paid?");
    setBusyId(requestId);
    setError("");
    try {
      const res = await api.post<{ message: string }>(
        `/membership/exit-requests/${requestId}/settlement`,
        {
          settlementMethod: settleForm.settlementMethod,
          paymentReference: settleForm.paymentReference.trim() || undefined,
          amountPaid: settleForm.amountPaid === "" ? undefined : Number(settleForm.amountPaid),
          settledOn: settleForm.settledOn || undefined,
          otherDeductions:
            settleForm.otherDeductions === "" ? undefined : Number(settleForm.otherDeductions),
          otherDeductionsNote: settleForm.otherDeductionsNote.trim() || undefined,
          notes: settleForm.notes.trim() || undefined,
        }
      );
      setMessage(res.message);
      setSettlingFor(null);
      setSettlementPreview(null);
      await fetchRequests();
    } catch (err: any) {
      await reportActionError(err, "Could not record the settlement.");
    } finally {
      setBusyId(null);
    }
  };

  const cancelAssembly = async (requestId: string, meetingId: string) => {
    const reason = window.prompt(
      "Why is the assembly being cancelled? The members were already notified."
    );
    if (!reason?.trim()) return;
    setBusyId(requestId);
    try {
      const res = await api.patch<{ message: string }>(
        `/membership/exit-requests/${requestId}/meeting/${meetingId}/cancel`,
        { reason: reason.trim() }
      );
      setMessage(res.message);
      await fetchRequests();
    } catch (err: any) {
      setError(err?.message ?? "Could not cancel the assembly.");
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const decide = async (id: string, decision: "under_review" | "approved" | "rejected") => {
    setError("");
    setMessage("");
    if (decision === "rejected" && !notes[id]?.trim()) {
      setError("Add a note explaining the decision before rejecting a request.");
      return;
    }
    setBusyId(id);
    try {
      const res = await api.patch<{ message: string }>(`/membership/exit-requests/${id}/decision`, {
        decision,
        note: notes[id]?.trim() || undefined,
      });
      setMessage(res.message);
      setNotes({ ...notes, [id]: "" });
      await fetchRequests();
    } catch (err: any) {
      await reportActionError(err, "Could not record the decision.");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Undo an approved exit recorded in error. Reinstates the member, re-attaches
   * their login and revokes the certificate; the request keeps the history.
   */
  const reverse = async (id: string) => {
    setError("");
    setMessage("");
    const reason = notes[id]?.trim() ?? "";
    if (reason.length < 10) {
      setError("Write why the exit is being reversed (at least 10 characters) in the box under the request.");
      return;
    }
    setBusyId(id);
    try {
      const res = await api.patch<{ message: string }>(`/membership/exit-requests/${id}/reverse`, { reason });
      setMessage(res.message);
      setNotes({ ...notes, [id]: "" });
      setReversing(null);
      await fetchRequests();
    } catch (err: any) {
      await reportActionError(err, "Could not reverse the exit.");
    } finally {
      setBusyId(null);
    }
  };
  const [reversing, setReversing] = useState<string | null>(null);

  const open = requests.filter((r) => OPEN_STATUSES.includes(r.status));
  const closed = requests.filter((r) => !OPEN_STATUSES.includes(r.status));

  if (loading) return <p className="text-gray-500">Loading removal requests…</p>;

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {open.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No requests awaiting a response</p>
          <p className="text-sm text-gray-500 mt-1">Members who ask to leave will appear here.</p>
        </Card>
      ) : (
        open.map((r) => {
          const remaining = daysUntil(r.response_due_at);
          const overdue = remaining < 0;
          return (
            <Card key={r.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{r.requester_name}</p>
                  <p className="text-sm text-gray-500">
                    {r.cooperative_name}
                    {r.membership_number && ` · ${r.membership_number}`}
                    {` · submitted ${formatDate(r.created_at)}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={r.status} />
                  <span className={`text-xs font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                    {overdue
                      ? `Overdue by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"}`
                      : `Due in ${remaining} day${remaining === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>

              <dl className="mt-5 grid gap-4 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-gray-500">Reason</dt>
                  <dd className="font-medium text-gray-900">
                    {REASON_LABELS[r.reason_category] ?? r.reason_category}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Preferred exit date</dt>
                  <dd className="font-medium text-gray-900">{formatDate(r.preferred_exit_date)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Savings held</dt>
                  <dd className="font-medium text-gray-900">
                    {r.member_savings != null ? `RWF ${Number(r.member_savings).toLocaleString()}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Savings instruction</dt>
                  <dd className="font-medium text-gray-900">
                    {SAVINGS_LABELS[r.savings_instruction] ?? r.savings_instruction}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">Member's explanation</dt>
                  <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{r.reason_detail}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-gray-500">Contact</dt>
                  <dd className="text-gray-900">
                    {r.contact_phone ?? "—"} · {r.requester_email}
                  </dd>
                </div>
              </dl>

              {/*
                Where this request has got to, and what has to happen next.
                The same seven steps the member sees, so the office and the
                member are never looking at different versions of the process.
              */}
              <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <ProcessTracker process={r.process} compact />
              </div>

              {/* ── The assembly ─────────────────────────────────────────── */}
              {(() => {
                const meetings = r.meetings ?? [];
                const scheduled = meetings.find((m) => m.status === "scheduled") ?? null;
                const held = meetings.find(
                  (m) => m.status === "held" && m.resolution && m.resolution !== "deferred"
                );
                const releaseResolved = held?.resolution === "approve_exit";
                const settled = r.settlement;

                return (
                  <div className="mt-5 border-t border-gray-200 pt-4 space-y-4">
                    {meetings.length > 0 && (
                      <div className="space-y-3">
                        {meetings.map((m) => (
                          <MeetingPanel key={m.id} meeting={m} />
                        ))}
                      </div>
                    )}

                    {/* Step 1 — call the assembly */}
                    {!scheduled && !held && (
                      <div>
                        {conveningFor !== r.id ? (
                          <>
                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                              Members decide whether one of their own is released. Call a general
                              assembly before you can answer this request.
                            </div>
                            <Button
                              variant="primary"
                              className="mt-3"
                              onClick={() => setConveningFor(r.id)}
                            >
                              <span className="flex items-center gap-2">
                                <CalendarPlus className="w-4 h-4" />
                                Call a general assembly
                              </span>
                            </Button>
                          </>
                        ) : (
                          <div className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Input
                                label="When it will sit *"
                                type="datetime-local"
                                value={convene.scheduledFor}
                                onChange={(e) =>
                                  setConvene({ ...convene, scheduledFor: e.target.value })
                                }
                              />
                              <Input
                                label="Where *"
                                value={convene.location}
                                onChange={(e) =>
                                  setConvene({ ...convene, location: e.target.value })
                                }
                                placeholder="e.g. Cooperative office, Remera"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Agenda (leave blank for the standard agenda)
                              </label>
                              <textarea
                                rows={3}
                                value={convene.agenda}
                                onChange={(e) => setConvene({ ...convene, agenda: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                              />
                            </div>
                            <p className="text-xs text-gray-500">
                              This is convened as an <strong>extraordinary</strong> assembly,
                              because a removal request cannot wait for the March or October
                              ordinary sitting. The RCA requires at least{" "}
                              {rules?.noticeDays ?? 3} days' notice, and{" "}
                              {Math.round((rules?.quorumFirstCall ?? 0.75) * 100)}% of those
                              entitled to sit must attend for the first call to be competent. The
                              meeting is added to the activities calendar and every member is
                              notified.
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <Button
                                variant="primary"
                                disabled={busyId === r.id}
                                onClick={() => callAssembly(r.id)}
                              >
                                {busyId === r.id ? "Calling…" : "Call the assembly"}
                              </Button>
                              <Button variant="outline" onClick={() => setConveningFor(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Step 2 — minute what it resolved */}
                    {scheduled && (
                      <div>
                        {recordingFor !== r.id ? (
                          <div className="flex flex-wrap gap-3">
                            <Button variant="primary" onClick={() => setRecordingFor(r.id)}>
                              <span className="flex items-center gap-2">
                                <Gavel className="w-4 h-4" />
                                Record what the assembly resolved
                              </span>
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busyId === r.id}
                              onClick={() => cancelAssembly(r.id, scheduled.id)}
                            >
                              Cancel the assembly
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-4">
                              <Input
                                label="Members present *"
                                type="number"
                                min={0}
                                value={vote.membersPresent}
                                onChange={(e) =>
                                  setVote({ ...vote, membersPresent: e.target.value })
                                }
                              />
                              <Input
                                label="Votes for *"
                                type="number"
                                min={0}
                                value={vote.votesFor}
                                onChange={(e) => setVote({ ...vote, votesFor: e.target.value })}
                              />
                              <Input
                                label="Votes against *"
                                type="number"
                                min={0}
                                value={vote.votesAgainst}
                                onChange={(e) => setVote({ ...vote, votesAgainst: e.target.value })}
                              />
                              <Input
                                label="Abstained *"
                                type="number"
                                min={0}
                                value={vote.votesAbstain}
                                onChange={(e) => setVote({ ...vote, votesAbstain: e.target.value })}
                              />
                            </div>
                            <Select
                              label="What did the assembly resolve? *"
                              value={vote.resolution}
                              onChange={(e) => setVote({ ...vote, resolution: e.target.value })}
                              options={[
                                { value: "", label: "Select the resolution…" },
                                ...Object.entries(RESOLUTION_LABELS).map(([value, label]) => ({
                                  value,
                                  label,
                                })),
                              ]}
                            />
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Minute the assembly's reasoning{" "}
                                {vote.resolution && vote.resolution !== "deferred" ? "*" : ""}
                              </label>
                              <textarea
                                rows={3}
                                value={vote.resolutionNote}
                                onChange={(e) =>
                                  setVote({ ...vote, resolutionNote: e.target.value })
                                }
                                placeholder="Why the members decided as they did. The member is entitled to know."
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                              />
                            </div>
                            <p className="text-xs text-gray-500">
                              Quorum is {scheduled.quorumRequired} of {scheduled.membersEligible}{" "}
                              {scheduled.eligibleBasis ?? "members"} (
                              {scheduled.callNumber === 2 ? "second" : "first"} call). Without it
                              the assembly can only defer
                              {scheduled.callNumber === 1
                                ? `, and a second call within ${rules?.secondCallWindow?.amount ?? 3} ${
                                    rules?.secondCallWindow?.unit ?? "working days"
                                  } needs only ${Math.round((rules?.quorumSecondCall ?? 0.5) * 100)}%`
                                : ", and as this is the second call the matter would go to the RCA"}
                              . Releasing a member is ordinary business, so it carries on more than{" "}
                              {Math.round((rules?.majorityRequired ?? 0.5) * 100)}% of the votes
                              cast.
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <Button
                                variant="primary"
                                disabled={busyId === r.id}
                                onClick={() => recordOutcome(r.id, scheduled.id)}
                              >
                                {busyId === r.id ? "Recording…" : "Record the resolution"}
                              </Button>
                              <Button variant="outline" onClick={() => setRecordingFor(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                      ── Step 5: resolve the member's assets ────────────────
                      This step did not exist. A manager could approve a
                      removal while the cooperative still held the member's
                      savings, and nothing in the system would ever say so.
                      The release button below is now unreachable until this
                      has been recorded, and there is no override for it.
                    */}
                    {releaseResolved && !settled && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                        {settlingFor !== r.id ? (
                          <>
                            <div className="flex items-start gap-2">
                              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                              <div>
                                <p className="text-sm font-medium text-amber-900">
                                  Settle the member's savings, shares and loans
                                </p>
                                <p className="mt-0.5 text-xs text-amber-800">
                                  The assembly has released {r.requester_name}. Before they can come
                                  off the register the cooperative has to return their savings,
                                  share capital and levies, add their share of what the cooperative
                                  has accumulated, and deduct anything they still owe. Nothing can
                                  be recorded as approved until this is done.
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="primary"
                              className="mt-3"
                              onClick={() => openSettlement(r.id)}
                            >
                              <span className="flex items-center gap-2">
                                <Banknote className="h-4 w-4" />
                                Settle and record the payment
                              </span>
                            </Button>
                          </>
                        ) : previewLoading ? (
                          <p className="text-sm text-amber-900">Computing what is owed…</p>
                        ) : (
                          <div className="space-y-4">
                            {/*
                              The computed position, read-only. These figures come
                              from the same code that shows the member their own
                              estimate, so the two cannot disagree.
                            */}
                            {settlementPreview?.calculated && (
                              <div className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  Computed from the cooperative's records
                                </p>
                                <dl className="space-y-1">
                                  {settlementPreview.calculated.lines.map((line) => (
                                    <div
                                      key={line.label}
                                      className="flex items-baseline justify-between gap-3"
                                      title={line.note}
                                    >
                                      <dt className="text-gray-600">{line.label}</dt>
                                      <dd
                                        className={
                                          line.amount < 0
                                            ? "font-medium text-red-600"
                                            : "font-medium text-gray-900"
                                        }
                                      >
                                        {money(Math.abs(line.amount))}
                                      </dd>
                                    </div>
                                  ))}
                                  <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-1.5">
                                    <dt className="font-medium text-gray-900">Net payable</dt>
                                    <dd className="font-semibold text-[#2D6A4F]">
                                      {money(settlementPreview.calculated.netPayable)}
                                    </dd>
                                  </div>
                                  {settlementPreview.calculated.balanceOwedToCooperative > 0 && (
                                    <div className="flex items-baseline justify-between gap-3">
                                      <dt className="text-red-700">Owed by the member</dt>
                                      <dd className="font-semibold text-red-700">
                                        {money(
                                          settlementPreview.calculated.balanceOwedToCooperative
                                        )}
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                                {settlementPreview.calculated.warnings.length > 0 && (
                                  <ul className="mt-3 space-y-1 border-t border-gray-200 pt-2">
                                    {settlementPreview.calculated.warnings.map((w) => (
                                      <li key={w} className="text-xs text-amber-800">
                                        • {w}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            {settlementPreview?.notOnRegister && (
                              <p className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900">
                                This account has no entry in the member register, so there is no
                                savings or share position to compute. Record the settlement as
                                &ldquo;Nothing was due either way&rdquo;, or correct the register first.
                              </p>
                            )}

                            <div className="grid gap-4 sm:grid-cols-2">
                              <Select
                                label="How was it settled? *"
                                value={String(settleForm.settlementMethod)}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, settlementMethod: e.target.value })
                                }
                                options={(settlementPreview?.methods ?? []).map((m) => ({
                                  value: m,
                                  label: SETTLEMENT_METHOD_LABELS[m] ?? m,
                                }))}
                              />
                              <Input
                                label="Amount actually paid (RWF)"
                                type="number"
                                min={0}
                                value={settleForm.amountPaid}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, amountPaid: e.target.value })
                                }
                              />
                              <Input
                                label="Payment reference"
                                value={settleForm.paymentReference}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, paymentReference: e.target.value })
                                }
                                placeholder="Mobile money or bank transaction reference"
                              />
                              <Input
                                label="Date settled"
                                type="date"
                                value={settleForm.settledOn}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, settledOn: e.target.value })
                                }
                              />
                              <Input
                                label="Other deductions (RWF)"
                                type="number"
                                min={0}
                                value={settleForm.otherDeductions}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, otherDeductions: e.target.value })
                                }
                              />
                              <Input
                                label="Why the other deduction?"
                                value={settleForm.otherDeductionsNote}
                                onChange={(e) =>
                                  setSettleForm({
                                    ...settleForm,
                                    otherDeductionsNote: e.target.value,
                                  })
                                }
                                placeholder="Required if you deduct anything beyond loans"
                              />
                            </div>

                            <div>
                              <label className="mb-1 block text-sm font-medium text-gray-700">
                                Notes
                              </label>
                              <textarea
                                rows={2}
                                value={settleForm.notes}
                                onChange={(e) =>
                                  setSettleForm({ ...settleForm, notes: e.target.value })
                                }
                                placeholder="Required if you pay less than the amount due — say why, so the member and the auditor can both read it."
                                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                              />
                            </div>

                            <p className="text-xs text-gray-600">
                              The member asked for{" "}
                              <strong>
                                {SAVINGS_LABELS[r.savings_instruction] ?? r.savings_instruction}
                              </strong>
                              {r.contact_phone ? ` · reachable on ${r.contact_phone}` : ""}. Once
                              recorded, they are notified with the figures and asked to confirm
                              receipt on their own portal.
                            </p>

                            <div className="flex flex-wrap gap-3">
                              <Button
                                variant="primary"
                                disabled={busyId === r.id}
                                onClick={() => recordSettlement(r.id)}
                              >
                                {busyId === r.id ? "Recording…" : "Record the settlement"}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSettlingFor(null);
                                  setSettlementPreview(null);
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {settled && <SettlementRecord settlement={settled} />}

                    {/* Step 6 — record the decision the assembly reached */}
                    {held && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Note to the member (required to reject)
                        </label>
                        <textarea
                          rows={2}
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                          placeholder="Communicate the assembly's decision and what happens next."
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
                        />
                        <div className="flex flex-wrap gap-3 mt-3">
                          {held.resolution === "approve_exit" ? (
                            <Button
                              variant="primary"
                              disabled={busyId === r.id || !settled}
                              onClick={() => decide(r.id, "approved")}
                              title={
                                settled
                                  ? undefined
                                  : "Settle the member's savings, shares and loans first."
                              }
                            >
                              Release the member &amp; issue the certificate
                            </Button>
                          ) : (
                            <Button
                              variant="danger"
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, "rejected")}
                            >
                              Record the refusal
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          The assembly resolved to{" "}
                          {RESOLUTION_LABELS[held.resolution!]?.toLowerCase()}, so that is the only
                          decision that can be recorded.{" "}
                          {held.resolution === "approve_exit" &&
                            (settled
                              ? "Recording it issues the member's certificate of past membership, " +
                                "archives their register entry, and unlinks their login from the " +
                                "cooperative."
                              : "You cannot record it until the settlement above is done — a " +
                                "member must not leave the register while the cooperative still " +
                                "holds their money.")}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          );
        })
      )}

      {closed.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Answered requests</h3>
          <div className="space-y-3">
            {closed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
                <div>
                  <p className="font-medium text-gray-900">{r.requester_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.cooperative_name} · {REASON_LABELS[r.reason_category] ?? r.reason_category}
                    {r.decided_at && ` · answered ${formatDate(r.decided_at)}`}
                    {r.decided_by_name && ` by ${r.decided_by_name}`}
                  </p>
                  {r.decision_note && <p className="text-sm text-gray-700 mt-2">{r.decision_note}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {r.settlement && (
                      <span className="inline-flex items-center gap-1">
                        <Banknote className="h-3.5 w-3.5" />
                        {money(r.settlement.amount_paid)} settled
                        {r.settlement.acknowledged_by_member
                          ? " · receipt confirmed"
                          : " · awaiting the member's confirmation"}
                      </span>
                    )}
                    {r.certificate && (
                      <span className="inline-flex items-center gap-1">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Certificate {r.certificate.certificate_number}
                      </span>
                    )}
                    {r.member_archived_at && (
                      <span className="inline-flex items-center gap-1">
                        <Archive className="h-3.5 w-3.5" />
                        Archived {formatDate(r.member_archived_at)}
                      </span>
                    )}
                  </div>
                  {r.status === "approved" && reversing === r.id && (
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <textarea
                        rows={2}
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                        placeholder="Why is this exit being reversed? e.g. approved in error — the member never asked to leave."
                        className="w-96 max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                      <Button variant="danger" disabled={busyId === r.id} onClick={() => reverse(r.id)}>
                        {busyId === r.id ? "Reversing…" : "Reverse the exit"}
                      </Button>
                      <Button variant="outline" onClick={() => setReversing(null)}>Cancel</Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === "approved" && reversing !== r.id && (
                    <button onClick={() => setReversing(r.id)} className="text-xs text-gray-600 underline hover:text-red-700">
                      Approved in error? Reverse it
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ArchivePanel />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leaving a cooperative.
 *
 * `embedded` is set when this is rendered as a tab of Services & requests,
 * which owns the page heading. Without it the tab would carry two titles.
 */
export function Membership({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const isReviewer = ["manager", "admin", "generalManager", "cooperative"].includes(user?.role ?? "");
  const [responseWindowDays, setResponseWindowDays] = useState(14);

  useEffect(() => {
    api
      .get<{ data: { responseWindowDays: number } }>("/membership/policy")
      .then((res) => setResponseWindowDays(res.data.responseWindowDays))
      .catch(() => {
        /* fall back to the default window */
      });
  }, []);

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Leaving a cooperative</h1>
          <p className="text-gray-600 mt-1">
            {isReviewer
              ? `Removal requests filed by your members. Each one goes to a general assembly, which votes on whether to release the member, and must be answered within ${responseWindowDays} days.`
              : `Ask to be removed from your cooperative. A general assembly of the members decides your request, and the cooperative has ${responseWindowDays} days to answer.`}
          </p>
        </div>
      )}

      {isReviewer ? <ReviewerView /> : <MemberView responseWindowDays={responseWindowDays} />}
    </div>
  );
}
