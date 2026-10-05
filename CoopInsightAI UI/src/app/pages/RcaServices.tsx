import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import {
  FileSignature,
  ListChecks,
  CheckCircle2,
  XCircle,
  Scale,
  ShieldCheck,
  Gavel,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { CooperativeRequests } from "./CooperativeRequests";
import { IssueReportsPanel } from "./IssueReports";
import { Membership } from "./Membership";
import { useSearchParams } from "react-router";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING A COOPERATIVE ASKS THE RCA FOR, IN ONE PLACE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There used to be two pages. "Cooperative Requests" held formation and
 * dissolution; "RCA Services" held the four certificate services. Nothing on
 * either page said which one held the form you needed, and a president looking
 * to dissolve their cooperative had no reason to prefer one name over the
 * other.
 *
 * They are the same errand — asking the agency for something, and watching it
 * climb sector → district → RCA — so they are now one page, tabbed:
 *
 *   Formation & dissolution   starting a cooperative, or closing one
 *   Report an issue           a member raising a problem with their own
 *   Certificate changes       objective, activities, name, replacement
 *   Independent auditors      who may audit a cooperative, and when
 *
 * The tab strip is filtered by role — see the note on TABS below. A member sees
 * the first two; the last two are the president's.
 *
 * The certificate-change form below drives all four of its services from the
 * backend catalogue rather than restating the rules, so the screen cannot drift
 * away from `services/serviceRequests.ts`.
 */

interface Requirement {
  id: string;
  label: string;
  requirement: string;
  kind: "assembly" | "document" | "data" | "payment" | "declaration";
  mandatory: boolean;
  weight: number;
}

interface ServiceSpec {
  id: string;
  label: string;
  summary: string;
  lawReference: string;
  filedBy: string;
  attendanceFraction: number | null;
  majorityFraction: number | null;
  minutesMustBeNotarized: boolean;
  requiresCertificateReturn: boolean;
  feeRwf: number | null;
  submittedVia: string;
  requirements: Requirement[];
}

interface Catalogue {
  services: ServiceSpec[];
  newServices: string[];
  passMark: number;
  attendanceFraction: number;
  majorityFraction: number;
  certificateFeeRwf: number;
  liquidator: { qualifications: string[]; duties: string[]; notificationDays: number };
  auditor: {
    disqualifications: Array<{ id: string; label: string; detail: string }>;
    scope: string[];
    conduct: { duties: string[]; liableFor: string[] };
    otherRoutes: string[];
  };
  whoMayFile: Record<string, string>;
  viewerIsOversight: boolean;
}

interface Assessment {
  score: number;
  passMark: number;
  eligible: boolean;
  results: Array<{ id: string; label: string; mandatory: boolean; passed: boolean; finding: string }>;
  failedMandatory: string[];
  missingDocuments: string[];
  recommendations: string[];
  model: string;
}

const money = (v: number | null | undefined) =>
  v == null ? "—" : `RWF ${Number(v).toLocaleString()}`;

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function RequirementList({ spec }: { spec: ServiceSpec }) {
  const groups = useMemo(() => {
    const byKind: Record<string, Requirement[]> = {};
    for (const r of spec.requirements) (byKind[r.kind] ??= []).push(r);
    return byKind;
  }, [spec]);

  const labels: Record<string, string> = {
    assembly: "The General Assembly",
    document: "Documents to attach",
    data: "Information to give",
    payment: "Payment",
    declaration: "Declarations",
  };

  return (
    <div className="space-y-5">
      {Object.entries(groups).map(([kind, items]) => (
        <div key={kind}>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            {labels[kind] ?? kind}
          </p>
          <div className="space-y-2">
            {items.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.label}</p>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      r.mandatory ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {r.mandatory ? "Required" : "Optional"}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">{r.requirement}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssessmentPanel({ assessment }: { assessment: Assessment }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        assessment.eligible ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className={`text-sm font-semibold ${
            assessment.eligible ? "text-green-900" : "text-amber-900"
          }`}
        >
          {assessment.eligible
            ? "Meets the published requirements"
            : `${assessment.failedMandatory.length} mandatory requirement(s) outstanding`}
        </p>
        <p className="text-xs text-gray-600">
          {Math.round(assessment.score * 100)}% · pass mark {Math.round(assessment.passMark * 100)}%
        </p>
      </div>

      <div className="mt-3 space-y-1.5">
        {assessment.results.map((r) => (
          <div key={r.id} className="flex items-start gap-2 text-sm">
            {r.passed ? (
              <CheckCircle2 className="w-4 h-4 text-[#2D6A4F] mt-0.5 shrink-0" />
            ) : (
              <XCircle
                className={`w-4 h-4 mt-0.5 shrink-0 ${r.mandatory ? "text-red-500" : "text-gray-400"}`}
              />
            )}
            <span className="text-gray-800">
              <span className="font-medium">{r.label}</span>
              <span className="text-gray-600"> — {r.finding}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">{assessment.model}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type TabKey = "membership" | "lifecycle" | "issues" | "apply" | "auditors";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT EACH ROLE MAY ACTUALLY DO HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An ordinary member does not file a dissolution or a change of certificate.
 * Those alter the cooperative's legal personality and commit every member to
 * the consequences, so the law puts them in the president's hands and the
 * backend refuses them from anyone else (`assertPresident`).
 *
 * Showing a member those tabs anyway would be the same mistake the sidebar was
 * making with Security & Audit: a door that opens onto a 403. So the tab strip
 * is filtered by role, and what is left for a member is the two things they
 * genuinely can start on their own account:
 *
 *   • apply to FORM a cooperative — they are not yet anybody's member, so no
 *     office could file it for them;
 *   • REPORT AN ISSUE about the cooperative they belong to.
 *
 * Both climb the same sector → district → RCA chain as everything else.
 */
const TABS: Array<{ key: TabKey; label: string; hint: string; roles: string[] }> = [
  {
    key: "membership",
    label: "Leaving the cooperative",
    hint:
      "A member asks to be released. The general assembly decides this one — the cooperative's " +
      "own members vote, and the RCA is only told afterwards.",
    roles: ["member", "manager", "cooperative", "admin", "generalManager"],
  },
  {
    key: "lifecycle",
    label: "Formation & dissolution",
    hint: "Start a cooperative, or close one. Both climb sector → district → RCA.",
    roles: ["member", "manager", "cooperative", "admin", "generalManager", "government"],
  },
  {
    key: "issues",
    label: "Report an issue",
    hint: "Raise a problem with your cooperative outside its own committee.",
    roles: ["member", "manager", "cooperative", "admin", "generalManager", "government"],
  },
  {
    key: "apply",
    label: "Certificate changes",
    hint: "Change the objective or name, add activities, or replace a lost certificate.",
    // Filed by the president; a member cannot commit the cooperative to these.
    roles: ["manager", "cooperative", "admin", "generalManager", "government"],
  },
  {
    key: "auditors",
    label: "Independent auditors",
    hint: "Who may audit a cooperative, and what disqualifies them.",
    roles: ["manager", "cooperative", "admin", "generalManager", "government"],
  },
];

export function RcaServices() {
  const { user } = useAuth();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  // ?tab= keeps the older links working — notifications already in people's
  // inboxes point at /membership, which now redirects here with ?tab=membership.
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>((searchParams.get("tab") as TabKey) || "lifecycle");

  const selectTab = (key: TabKey) => {
    setTab(key);
    setSearchParams(key === "lifecycle" ? {} : { tab: key }, { replace: true });
  };

  // Only the tabs this account can actually use. A member gets two.
  const visibleTabs = useMemo(
    () => TABS.filter((t) => t.roles.includes(user?.role ?? "")),
    [user?.role]
  );

  // If the active tab is not one of theirs — on first render, or if the role
  // changed — fall back to the first tab they do have rather than rendering
  // a panel they are not allowed to see.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, tab]);

  const [form, setForm] = useState<Record<string, string | boolean>>({
    reason: "",
    assemblyHeldOn: "",
    membersPresent: "",
    votesFor: "",
    votesAgainst: "",
    votesAbstain: "",
    minutesNotarized: false,
    certificateReturned: false,
    feePaidRwf: "",
    rraClearance: false,
    creditorsNotified: false,
    cmisReference: "",
    shareCapital: "",
    shareValue: "",
    proposedName: "",
    proposedObjective: "",
    addedActivities: "",
    valueChainJustification: "",
    lossCircumstances: "",
  });

  useEffect(() => {
    api
      .get<{ data: Catalogue }>("/service-requests/catalogue")
      .then((r) => {
        setCatalogue(r.data);
        setSelected(r.data.newServices[0] ?? "");
      })
      .catch((e) => setError(e?.message ?? "Could not load the RCA service catalogue."))
      .finally(() => setLoading(false));
  }, []);

  const spec = useMemo(
    () => catalogue?.services.find((s) => s.id === selected) ?? null,
    [catalogue, selected]
  );

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!spec) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        reason: form.reason,
        assemblyHeldOn: form.assemblyHeldOn || undefined,
        membersPresent: form.membersPresent ? Number(form.membersPresent) : undefined,
        votesFor: form.votesFor ? Number(form.votesFor) : undefined,
        votesAgainst: form.votesAgainst ? Number(form.votesAgainst) : undefined,
        votesAbstain: form.votesAbstain ? Number(form.votesAbstain) : undefined,
        minutesNotarized: form.minutesNotarized === true,
        certificateReturned: form.certificateReturned === true,
        feePaidRwf: form.feePaidRwf ? Number(form.feePaidRwf) : undefined,
        rraClearance: form.rraClearance === true,
        creditorsNotified: form.creditorsNotified === true,
        cmisReference: form.cmisReference || undefined,
        shareCapital: form.shareCapital ? Number(form.shareCapital) : undefined,
        shareValue: form.shareValue ? Number(form.shareValue) : undefined,
        proposedName: form.proposedName || undefined,
        proposedObjective: form.proposedObjective || undefined,
        addedActivities: String(form.addedActivities || "")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        valueChainJustification: form.valueChainJustification || undefined,
        lossCircumstances: form.lossCircumstances || undefined,
      };
      const res = await api.post<{ message: string; assessment: Assessment }>(
        `/service-requests/${spec.id}`,
        payload
      );
      setMessage(res.message);
      setAssessment(res.assessment);
    } catch (e: any) {
      setError(e?.message ?? "Could not file the request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading the RCA service catalogue…</p>;
  if (!catalogue) return <p className="text-red-600">{error}</p>;

  const needsAssembly = spec?.attendanceFraction != null;
  const activeTab = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <FileSignature className="w-5 h-5 text-gray-700" />
          <h1 className="text-2xl font-semibold text-gray-900">Services &amp; requests</h1>
        </div>
        <p className="text-gray-600 mt-1 max-w-3xl">
          Every formal request a cooperative or its members can make. Most climb the same chain —
          the sector cooperative officer, then the district office, then the RCA, which has the
          final say. Leaving the cooperative is the exception: that one is decided by the general
          assembly of the members themselves, and the RCA is only notified afterwards.
        </p>
        <p className="text-gray-600 mt-2 max-w-3xl text-sm">
          {user?.role === "member" ? (
            <>
              As a member you can <strong>apply to form a cooperative</strong> or{" "}
              <strong>report a problem</strong> with your own. Closing a cooperative or changing its
              certificate is filed by its president, because those commit every member.
            </>
          ) : (
            <>
              Dissolution and certificate changes are filed by the cooperative's president and
              decided by a General Assembly. Members may apply to form a cooperative, and may
              report an issue about their own.
            </>
          )}
        </p>
      </div>

      <div>
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 p-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab && <p className="mt-2 text-sm text-gray-500">{activeTab.hint}</p>}
      </div>

      {message && tab !== "lifecycle" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && tab !== "lifecycle" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {tab === "membership" ? (
        <Membership embedded />
      ) : tab === "lifecycle" ? (
        <CooperativeRequests />
      ) : tab === "issues" ? (
        <IssueReportsPanel />
      ) : tab === "auditors" ? (
        <AuditorRules catalogue={catalogue} />
      ) : !user?.cooperativeId && !catalogue.viewerIsOversight ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <p className="text-sm text-gray-700">
              Your account is not linked to a cooperative, so there is nothing to file for.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-6">
            <Select
              label="Which service?"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setAssessment(null);
                setMessage("");
              }}
              options={catalogue.services
                .filter((s) => catalogue.newServices.includes(s.id))
                .map((s) => ({ value: s.id, label: s.label }))}
            />

            {spec && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-gray-700">{spec.summary}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
                  <span>Filed by: <strong>{spec.filedBy.replace(/_/g, " ")}</strong></span>
                  <span>Assembly attendance: <strong>{pct(spec.attendanceFraction)}</strong></span>
                  <span>Majority: <strong>{pct(spec.majorityFraction)}</strong></span>
                  <span>Fee: <strong>{money(spec.feeRwf)}</strong></span>
                  <span>Submitted via <strong>{spec.submittedVia}</strong></span>
                </div>
                <p className="text-xs text-gray-500">{spec.lawReference}</p>
              </div>
            )}
          </Card>

          {spec && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ListChecks className="w-4 h-4 text-gray-700" />
                  <h2 className="text-lg font-semibold text-gray-900">What the RCA requires</h2>
                </div>
                <RequirementList spec={spec} />
              </Card>

              <Card className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Your request</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Why the members want this *
                    </label>
                    <textarea
                      rows={3}
                      value={String(form.reason)}
                      onChange={(e) => set("reason", e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                    />
                  </div>

                  {spec.id === "change_name" && (
                    <Input
                      label="Proposed new name *"
                      value={String(form.proposedName)}
                      onChange={(e) => set("proposedName", e.target.value)}
                    />
                  )}
                  {spec.id === "change_objective" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        New objective, cluster and value chain *
                      </label>
                      <textarea
                        rows={2}
                        value={String(form.proposedObjective)}
                        onChange={(e) => set("proposedObjective", e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                      />
                    </div>
                  )}
                  {spec.id === "add_activity" && (
                    <>
                      <Input
                        label="Activities to add (comma separated) *"
                        value={String(form.addedActivities)}
                        onChange={(e) => set("addedActivities", e.target.value)}
                        placeholder="Grain milling, Packaging"
                      />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          How they sit in the same value chain *
                        </label>
                        <textarea
                          rows={2}
                          value={String(form.valueChainJustification)}
                          onChange={(e) => set("valueChainJustification", e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                        />
                      </div>
                    </>
                  )}
                  {spec.id === "duplicate_certificate" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        How the certificate was lost, damaged or stolen *
                      </label>
                      <textarea
                        rows={3}
                        value={String(form.lossCircumstances)}
                        onChange={(e) => set("lossCircumstances", e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                      />
                    </div>
                  )}

                  {needsAssembly && (
                    <>
                      <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        The RCA requires {pct(spec.attendanceFraction)} of eligible members to
                        attend and {pct(spec.majorityFraction)} of those present to vote in favour.
                        Attendance is checked against the register — or the delegate body, for
                        cooperatives above 100 members.
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Assembly held on"
                          type="date"
                          value={String(form.assemblyHeldOn)}
                          onChange={(e) => set("assemblyHeldOn", e.target.value)}
                        />
                        <Input
                          label="Members present *"
                          type="number"
                          value={String(form.membersPresent)}
                          onChange={(e) => set("membersPresent", e.target.value)}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Input
                          label="Votes for *"
                          type="number"
                          value={String(form.votesFor)}
                          onChange={(e) => set("votesFor", e.target.value)}
                        />
                        <Input
                          label="Against"
                          type="number"
                          value={String(form.votesAgainst)}
                          onChange={(e) => set("votesAgainst", e.target.value)}
                        />
                        <Input
                          label="Abstained"
                          type="number"
                          value={String(form.votesAbstain)}
                          onChange={(e) => set("votesAbstain", e.target.value)}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Share capital (RWF)"
                          type="number"
                          value={String(form.shareCapital)}
                          onChange={(e) => set("shareCapital", e.target.value)}
                        />
                        <Input
                          label="Value of one share (RWF)"
                          type="number"
                          value={String(form.shareValue)}
                          onChange={(e) => set("shareValue", e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="CMIS reference *"
                      value={String(form.cmisReference)}
                      onChange={(e) => set("cmisReference", e.target.value)}
                      placeholder="CMIS/2026/…"
                    />
                    {spec.feeRwf != null && (
                      <Input
                        label={`Fee paid (RWF ${spec.feeRwf.toLocaleString()})`}
                        type="number"
                        value={String(form.feePaidRwf)}
                        onChange={(e) => set("feePaidRwf", e.target.value)}
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    {spec.minutesMustBeNotarized && (
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.minutesNotarized === true}
                          onChange={(e) => set("minutesNotarized", e.target.checked)}
                          className="mt-0.5"
                        />
                        The General Assembly minutes are notarized.
                      </label>
                    )}
                    {spec.requiresCertificateReturn && (
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.certificateReturned === true}
                          onChange={(e) => set("certificateReturned", e.target.checked)}
                          className="mt-0.5"
                        />
                        The original legal personality certificate has been returned to the RCA.
                      </label>
                    )}
                    {spec.id === "change_objective" && (
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.rraClearance === true}
                          onChange={(e) => set("rraClearance", e.target.checked)}
                          className="mt-0.5"
                        />
                        An RRA certificate shows no outstanding tax arrears.
                      </label>
                    )}
                    {spec.id === "change_name" && (
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.creditorsNotified === true}
                          onChange={(e) => set("creditorsNotified", e.target.checked)}
                          className="mt-0.5"
                        />
                        The cooperative's creditors were notified of the name change.
                      </label>
                    )}
                  </div>

                  <Button variant="primary" disabled={submitting} onClick={submit}>
                    {submitting ? "Filing…" : `File ${spec.label.toLowerCase()}`}
                  </Button>
                  <p className="text-xs text-gray-500">
                    Filing scores the request against the checklist immediately. Documents are
                    attached afterwards, and the check can be re-run.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {assessment && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Checked against the RCA requirements
              </h2>
              <AssessmentPanel assessment={assessment} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AuditorRules({ catalogue }: { catalogue: Catalogue }) {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-gray-700" />
          <h2 className="text-lg font-semibold text-gray-900">Who may audit a cooperative</h2>
        </div>
        <p className="text-sm text-gray-700">
          An independent auditor is appointed by the General Assembly, and only from the list of
          auditors approved by the RCA. Six circumstances disqualify a person outright — the system
          refuses the engagement rather than discovering the conflict after the report.
        </p>

        <div className="mt-4 space-y-2">
          {catalogue.auditor.disqualifications.map((d) => (
            <div key={d.id} className="rounded-lg border border-gray-200 px-3 py-2">
              <p className="text-sm font-medium text-gray-900">{d.label}</p>
              {d.detail && <p className="text-xs text-gray-600 mt-0.5">{d.detail}</p>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="w-4 h-4 text-gray-700" />
            <h3 className="font-semibold text-gray-900">What the audit covers</h3>
          </div>
          <ul className="space-y-1.5 text-sm text-gray-700">
            {catalogue.auditor.scope.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
          <div className="mt-4 border-t border-gray-200 pt-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              Other routes to an audit
            </p>
            <ul className="space-y-1.5 text-sm text-gray-700">
              {catalogue.auditor.otherRoutes.map((s, i) => (
                <li key={i}>· {s}</li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Gavel className="w-4 h-4 text-gray-700" />
            <h3 className="font-semibold text-gray-900">Conduct and liability</h3>
          </div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">The auditor must</p>
          <ul className="space-y-1.5 text-sm text-gray-700">
            {catalogue.auditor.conduct.duties.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
          <p className="text-xs uppercase tracking-wide text-gray-500 mt-4 mb-2">
            And is liable for loss caused by
          </p>
          <ul className="space-y-1.5 text-sm text-gray-700">
            {catalogue.auditor.conduct.liableFor.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Inbox className="w-4 h-4 text-gray-700" />
          <h3 className="font-semibold text-gray-900">The liquidator</h3>
        </div>
        <p className="text-sm text-gray-700">
          A dissolution appoints someone to collect and distribute the assets. They must be a{" "}
          {catalogue.liquidator.qualifications.map((q) => q.replace(/_/g, " ")).join(", ")}. The RCA
          must be told of the decision within {catalogue.liquidator.notificationDays} days.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            The {catalogue.liquidator.duties.length} duties of the liquidator
          </summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm text-gray-700">
            {catalogue.liquidator.duties.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ol>
        </details>
      </Card>
    </div>
  );
}
