import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { GASABO_SECTORS, SECTOR_CELLS, COOPERATIVE_TYPES } from "../data/gasaboData";
import {
  Building2,
  Ban,
  CheckCircle2,
  XCircle,
  Clock,
  Undo2,
  Brain,
  Upload,
  ListChecks,
  ArrowRight,
  Inbox,
  AlertTriangle,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

interface Criterion {
  id: string;
  label: string;
  requirement: string;
  kind: "document" | "data";
  mandatory: boolean;
  weight: number;
}

interface CriterionResult extends Criterion {
  passed: boolean;
  finding: string;
}

interface Assessment {
  eligible: boolean;
  score: number;
  confidence: number;
  passMark: number;
  criteria: CriterionResult[];
  failedMandatory: string[];
  missingDocuments: string[];
  recommendations: string[];
  model: string;
  assessedAt: string;
}

interface RequestDocument {
  id: string;
  criterionId: string | null;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
}

interface Review {
  id: string;
  stage: "sector" | "district" | "rca";
  decision: "approved" | "rejected" | "returned";
  note: string | null;
  reviewedAt: string;
  reviewerName: string;
}

interface CoopRequest {
  id: string;
  request_type: "formation" | "dissolution";
  reference: string;
  submitted_by: string;
  submitted_by_name: string;
  submitted_by_email: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  sector: string;
  cell: string | null;
  village: string | null;
  proposed_name: string | null;
  proposed_type: string | null;
  member_count: number | null;
  share_capital: string | null;
  purpose: string | null;
  cooperative_id: string | null;
  cooperative_name: string | null;
  dissolution_reason: string | null;
  votes_for: number | null;
  votes_against: number | null;
  votes_abstain: number | null;
  outstanding_liabilities: string | null;
  asset_disposal_plan: string | null;
  current_stage: "sector" | "district" | "rca" | "closed";
  status: "pending_sector" | "pending_district" | "pending_rca" | "approved" | "rejected" | "withdrawn";
  ai_assessment: Assessment | null;
  response_due_at: string;
  created_at: string;
  documents: RequestDocument[];
  reviews: Review[];
}

const STAGE_ORDER = ["sector", "district", "rca"] as const;

const STAGE_LABEL: Record<string, string> = {
  sector: "Sector Officer",
  district: "District Officer",
  rca: "RCA",
};

const STATUS_STYLES: Record<string, { label: string; badge: string; Icon: typeof Clock }> = {
  pending_sector: { label: "With sector officer", badge: "bg-amber-100 text-amber-800", Icon: Clock },
  pending_district: { label: "With district officer", badge: "bg-amber-100 text-amber-800", Icon: Clock },
  pending_rca: { label: "With RCA", badge: "bg-amber-100 text-amber-800", Icon: Clock },
  approved: { label: "Approved", badge: "bg-green-100 text-green-800", Icon: CheckCircle2 },
  rejected: { label: "Rejected", badge: "bg-red-100 text-red-700", Icon: XCircle },
  withdrawn: { label: "Withdrawn", badge: "bg-gray-100 text-gray-700", Icon: Undo2 },
};

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const daysUntil = (v: string) => Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000);

const money = (v: string | number | null) =>
  v == null ? "—" : `RWF ${Number(v).toLocaleString()}`;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending_sector;
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.badge}`}>
      <Icon className="w-3.5 h-3.5" />
      {s.label}
    </span>
  );
}

/** sector → district → RCA, with the reached stages filled in. */
function StageTrail({ request }: { request: CoopRequest }) {
  const reachedIndex = request.status === "approved"
    ? STAGE_ORDER.length
    : STAGE_ORDER.indexOf(request.current_stage as any);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STAGE_ORDER.map((stage, i) => {
        const review = request.reviews.filter((r) => r.stage === stage).slice(-1)[0];
        const done = review?.decision === "approved" || i < reachedIndex;
        const failed = review?.decision === "rejected";
        const active = !failed && i === reachedIndex && request.status.startsWith("pending");
        return (
          <div key={stage} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                failed
                  ? "bg-red-100 text-red-700"
                  : done
                  ? "bg-green-100 text-green-800"
                  : active
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {failed ? <XCircle className="w-3.5 h-3.5" /> : done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
              {STAGE_LABEL[stage]}
            </span>
            {i < STAGE_ORDER.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-gray-300" />}
          </div>
        );
      })}
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
        <div className="flex items-center gap-2">
          <Brain className={`w-4 h-4 ${assessment.eligible ? "text-green-700" : "text-amber-700"}`} />
          <p className={`text-sm font-semibold ${assessment.eligible ? "text-green-900" : "text-amber-900"}`}>
            {assessment.eligible ? "Predicted eligible" : "Predicted not yet eligible"}
          </p>
        </div>
        <p className="text-xs text-gray-600">
          Score {Math.round(assessment.score * 100)}% · pass mark {Math.round(assessment.passMark * 100)}% ·
          confidence {Math.round(assessment.confidence * 100)}%
        </p>
      </div>

      <div className="mt-3 h-2 w-full rounded-full bg-white/70 overflow-hidden">
        <div
          className={`h-full rounded-full ${assessment.eligible ? "bg-green-600" : "bg-amber-500"}`}
          style={{ width: `${Math.round(assessment.score * 100)}%` }}
        />
      </div>

      <ul className="mt-4 space-y-1.5">
        {assessment.criteria.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-sm">
            {c.passed ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
            ) : (
              <XCircle className={`w-4 h-4 mt-0.5 shrink-0 ${c.mandatory ? "text-red-600" : "text-gray-400"}`} />
            )}
            <span>
              <span className="font-medium text-gray-900">{c.label}</span>
              {c.mandatory && <span className="text-xs text-red-600 ml-1">required</span>}
              <span className="block text-gray-600">{c.finding}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-gray-600 border-t border-black/5 pt-3">
        {assessment.model} · assessed {new Date(assessment.assessedAt).toLocaleString()}. This is a prediction against
        the configured criteria — the decision remains with the officer.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function CooperativeRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CoopRequest[]>([]);
  const [criteria, setCriteria] = useState<{ formation: Criterion[]; dissolution: Criterion[]; thresholds: any } | null>(null);
  const [viewerStage, setViewerStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const [mode, setMode] = useState<"none" | "formation" | "dissolution">("none");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [formation, setFormation] = useState({
    proposedName: "", proposedType: "", sector: "", cell: "", village: "",
    memberCount: "", shareCapital: "", purpose: "",
    contactName: user?.name ?? "", contactPhone: user?.phone ?? "", contactEmail: user?.email ?? "",
  });

  const [dissolution, setDissolution] = useState({
    dissolutionReason: "", votesFor: "", votesAgainst: "", votesAbstain: "",
    outstandingLiabilities: "", assetDisposalPlan: "",
    contactName: user?.name ?? "", contactPhone: user?.phone ?? "",
  });

  const isOfficer = viewerStage !== null;
  const canFileDissolution = ["manager", "cooperative", "admin", "generalManager"].includes(user?.role ?? "");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [list, rules] = await Promise.all([
        api.get<{ data: CoopRequest[]; viewerStage: string | null }>("/cooperative-requests"),
        api.get<{ data: any }>("/cooperative-requests/criteria"),
      ]);
      setRequests(list.data ?? []);
      setViewerStage(list.viewerStage ?? null);
      setCriteria(rules.data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load cooperative requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cellOptions = useMemo(() => {
    const sectorId = GASABO_SECTORS.find((s) => s.name === formation.sector)?.id;
    return sectorId ? SECTOR_CELLS[sectorId] ?? [] : [];
  }, [formation.sector]);

  const submitFormation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!formation.proposedName || !formation.proposedType || !formation.sector) {
      return setFormError("Name, type and sector are required.");
    }
    if (!formation.contactName || !formation.contactPhone) {
      return setFormError("A contact person and telephone number are required.");
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>("/cooperative-requests/formation", {
        ...formation,
        memberCount: formation.memberCount ? Number(formation.memberCount) : undefined,
        shareCapital: formation.shareCapital ? Number(formation.shareCapital) : undefined,
      });
      setMessage(res.message);
      setMode("none");
      setFormation({
        proposedName: "", proposedType: "", sector: "", cell: "", village: "",
        memberCount: "", shareCapital: "", purpose: "",
        contactName: user?.name ?? "", contactPhone: user?.phone ?? "", contactEmail: user?.email ?? "",
      });
      await load();
    } catch (err: any) {
      setFormError(err?.message ?? "Could not submit the application.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDissolution = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (dissolution.dissolutionReason.trim().length < 30) {
      return setFormError("Explain the grounds for dissolution in at least 30 characters.");
    }
    if (dissolution.assetDisposalPlan.trim().length < 30) {
      return setFormError("An asset disposal and settlement plan of at least 30 characters is required.");
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>("/cooperative-requests/dissolution", {
        ...dissolution,
        cooperativeId: user?.cooperativeId,
        votesFor: dissolution.votesFor ? Number(dissolution.votesFor) : undefined,
        votesAgainst: dissolution.votesAgainst ? Number(dissolution.votesAgainst) : undefined,
        votesAbstain: dissolution.votesAbstain ? Number(dissolution.votesAbstain) : undefined,
        outstandingLiabilities: dissolution.outstandingLiabilities ? Number(dissolution.outstandingLiabilities) : undefined,
      });
      setMessage(res.message);
      setMode("none");
      await load();
    } catch (err: any) {
      setFormError(err?.message ?? "Could not submit the dissolution request.");
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (id: string, decision: "approved" | "rejected" | "returned") => {
    setError("");
    setMessage("");
    if (decision !== "approved" && !notes[id]?.trim()) {
      setError("A note is required when rejecting or returning a request.");
      return;
    }
    setBusyId(id);
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
      setBusyId(null);
    }
  };

  const runAssessment = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      await api.post(`/cooperative-requests/${id}/assess`, {});
      setMessage("Eligibility re-assessed against the current criteria.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not run the assessment.");
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (id: string) => {
    setBusyId(id);
    try {
      const res = await api.patch<{ message: string }>(`/cooperative-requests/${id}/withdraw`, {});
      setMessage(res.message);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not withdraw the request.");
    } finally {
      setBusyId(null);
    }
  };

  const uploadDoc = async (requestId: string, criterionId: string, file: File) => {
    const token = localStorage.getItem("coopinsight_access_token");
    const body = new FormData();
    body.append("file", file);
    body.append("criterionId", criterionId);
    body.append("name", file.name);
    try {
      const res = await fetch(`${BASE_URL}/cooperative-requests/${requestId}/documents`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Upload failed");
      await api.post(`/cooperative-requests/${requestId}/assess`, {});
      setMessage("Document attached and eligibility re-assessed.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not attach the document.");
    }
  };

  const open = requests.filter((r) => r.status.startsWith("pending"));
  const closed = requests.filter((r) => !r.status.startsWith("pending"));

  const canActOn = (r: CoopRequest) =>
    isOfficer && r.status.startsWith("pending") &&
    (viewerStage === "any" || viewerStage === r.current_stage) &&
    r.submitted_by !== user?.id;

  if (loading) return <p className="text-gray-500">Loading cooperative requests…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Cooperative Requests</h1>
          <p className="text-gray-600 mt-1">
            {isOfficer
              ? `Applications to form and dissolve cooperatives. You review at ${
                  viewerStage === "any" ? "every" : STAGE_LABEL[viewerStage as string]
                } level. Each request moves sector → district → RCA.`
              : "Apply to start a new cooperative, or request that an existing one be wound up. Requests are reviewed by the sector officer, then the district, then the RCA."}
          </p>
        </div>
        {!isOfficer && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => { setMode("formation"); setFormError(""); }}>
              <span className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Apply to start a cooperative
              </span>
            </Button>
            {canFileDissolution && user?.cooperativeId && (
              <Button variant="danger" onClick={() => { setMode("dissolution"); setFormError(""); }}>
                <span className="flex items-center gap-2">
                  <Ban className="w-4 h-4" />
                  Request dissolution
                </span>
              </Button>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── Published criteria ────────────────────────────────────────────── */}
      {criteria && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <ListChecks className="w-4 h-4 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">What a new cooperative must satisfy</h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Every application is vetted against this list at each level. Minimum{" "}
            {criteria.thresholds.minMembers} founding members, minimum share capital of{" "}
            {money(criteria.thresholds.minShareCapital)}, pass mark{" "}
            {Math.round(criteria.thresholds.passMark * 100)}%.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {criteria.formation.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{c.label}</p>
                  <span
                    className={`text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 ${
                      c.mandatory ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {c.mandatory ? "Required" : "Optional"}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{c.requirement}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Formation form ───────────────────────────────────────────────── */}
      {mode === "formation" && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900">Apply to start a cooperative</h2>
          <p className="text-sm text-gray-600 mt-1">
            This goes to the sector cooperative officer first. You can attach the required documents after submitting.
          </p>
          <form onSubmit={submitFormation} className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Proposed cooperative name *"
                value={formation.proposedName}
                onChange={(e) => setFormation({ ...formation, proposedName: e.target.value })}
              />
              <Select
                label="Type of cooperative *"
                value={formation.proposedType}
                onChange={(e) => setFormation({ ...formation, proposedType: e.target.value })}
                options={[{ value: "", label: "Select a type…" }, ...COOPERATIVE_TYPES.map((t) => ({ value: t, label: t }))]}
              />
              <Select
                label="Sector *"
                value={formation.sector}
                onChange={(e) => setFormation({ ...formation, sector: e.target.value, cell: "" })}
                options={[{ value: "", label: "Select a sector…" }, ...GASABO_SECTORS.map((s) => ({ value: s.name, label: s.name }))]}
              />
              <Select
                label="Cell"
                value={formation.cell}
                onChange={(e) => setFormation({ ...formation, cell: e.target.value })}
                options={[{ value: "", label: "Select a cell…" }, ...cellOptions.map((c) => ({ value: c, label: c }))]}
              />
              <Input
                label={`Number of founding members${criteria ? ` (min ${criteria.thresholds.minMembers})` : ""}`}
                type="number"
                min={0}
                value={formation.memberCount}
                onChange={(e) => setFormation({ ...formation, memberCount: e.target.value })}
              />
              <Input
                label={`Subscribed share capital in RWF${criteria ? ` (min ${criteria.thresholds.minShareCapital.toLocaleString()})` : ""}`}
                type="number"
                min={0}
                value={formation.shareCapital}
                onChange={(e) => setFormation({ ...formation, shareCapital: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                What will the cooperative do?
                {criteria && <span className="text-gray-500 font-normal"> (min {criteria.thresholds.minPurposeLength} characters)</span>}
              </label>
              <textarea
                rows={5}
                value={formation.purpose}
                onChange={(e) => setFormation({ ...formation, purpose: e.target.value })}
                placeholder="Describe the economic activity, who the members are, and how the cooperative will earn and share income."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formation.purpose.trim().length}
                {criteria ? `/${criteria.thresholds.minPurposeLength}` : ""} characters
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Input
                label="Contact person *"
                value={formation.contactName}
                onChange={(e) => setFormation({ ...formation, contactName: e.target.value })}
              />
              <Input
                label="Telephone *"
                value={formation.contactPhone}
                onChange={(e) => setFormation({ ...formation, contactPhone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                value={formation.contactEmail}
                onChange={(e) => setFormation({ ...formation, contactEmail: e.target.value })}
              />
            </div>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit application"}</Button>
              <Button type="button" variant="outline" onClick={() => setMode("none")}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Dissolution form ─────────────────────────────────────────────── */}
      {mode === "dissolution" && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900">Request dissolution of {user?.cooperativeName}</h2>
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-900">
              Dissolution is final once the RCA approves it. The cooperative is removed from the active register and
              every member is unlinked. It must be backed by a general assembly resolution.
            </p>
          </div>

          <form onSubmit={submitDissolution} className="mt-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grounds for dissolution *</label>
              <textarea
                rows={4}
                value={dissolution.dissolutionReason}
                onChange={(e) => setDissolution({ ...dissolution, dissolutionReason: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Input label="Votes in favour" type="number" min={0} value={dissolution.votesFor}
                onChange={(e) => setDissolution({ ...dissolution, votesFor: e.target.value })} />
              <Input label="Votes against" type="number" min={0} value={dissolution.votesAgainst}
                onChange={(e) => setDissolution({ ...dissolution, votesAgainst: e.target.value })} />
              <Input label="Abstentions" type="number" min={0} value={dissolution.votesAbstain}
                onChange={(e) => setDissolution({ ...dissolution, votesAbstain: e.target.value })} />
            </div>

            <Input
              label="Outstanding liabilities (RWF)"
              type="number"
              min={0}
              value={dissolution.outstandingLiabilities}
              onChange={(e) => setDissolution({ ...dissolution, outstandingLiabilities: e.target.value })}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Asset disposal and member settlement plan *
              </label>
              <textarea
                rows={4}
                value={dissolution.assetDisposalPlan}
                onChange={(e) => setDissolution({ ...dissolution, assetDisposalPlan: e.target.value })}
                placeholder="How assets will be realised, creditors settled, and any residue distributed to members."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
              />
            </div>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="danger" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit dissolution request"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode("none")}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── The queue ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {isOfficer ? "Requests awaiting a decision" : "Your requests"}
        </h2>

        {open.length === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-medium text-gray-900 mt-3">Nothing in the queue</p>
            <p className="text-sm text-gray-500 mt-1">
              {isOfficer ? "Requests at your level will appear here." : "You have no open requests."}
            </p>
          </Card>
        ) : (
          open.map((r) => {
            const remaining = daysUntil(r.response_due_at);
            const overdue = remaining < 0;
            const isOpen = expanded === r.id;
            return (
              <Card key={r.id} className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-gray-500">{r.reference}</span>
                      <span
                        className={`text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 ${
                          r.request_type === "formation" ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {r.request_type}
                      </span>
                    </div>
                    <p className="text-lg font-semibold text-gray-900 mt-1">
                      {r.request_type === "formation" ? r.proposed_name : r.cooperative_name}
                    </p>
                    <p className="text-sm text-gray-500">
                      {r.proposed_type ?? "Dissolution"} · {r.sector} sector
                      {r.cell && `, ${r.cell} cell`} · filed {formatDate(r.created_at)} by {r.submitted_by_name}
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

                <div className="mt-4">
                  <StageTrail request={r} />
                </div>

                {r.ai_assessment && (
                  <div className="mt-5">
                    <AssessmentPanel assessment={r.ai_assessment} />
                  </div>
                )}

                <button
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="mt-4 text-sm font-medium text-[#2D6A4F] hover:underline"
                >
                  {isOpen ? "Hide details" : "View full application"}
                </button>

                {isOpen && (
                  <div className="mt-4 border-t border-gray-200 pt-4 space-y-4">
                    <dl className="grid gap-4 sm:grid-cols-2 text-sm">
                      {r.request_type === "formation" ? (
                        <>
                          <div>
                            <dt className="text-gray-500">Founding members</dt>
                            <dd className="font-medium text-gray-900">{r.member_count ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Share capital</dt>
                            <dd className="font-medium text-gray-900">{money(r.share_capital)}</dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-gray-500">Purpose</dt>
                            <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{r.purpose || "—"}</dd>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <dt className="text-gray-500">Assembly vote</dt>
                            <dd className="font-medium text-gray-900">
                              {r.votes_for ?? 0} for · {r.votes_against ?? 0} against · {r.votes_abstain ?? 0} abstained
                            </dd>
                          </div>
                          <div>
                            <dt className="text-gray-500">Outstanding liabilities</dt>
                            <dd className="font-medium text-gray-900">{money(r.outstanding_liabilities)}</dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-gray-500">Grounds</dt>
                            <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{r.dissolution_reason}</dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-gray-500">Asset disposal plan</dt>
                            <dd className="text-gray-900 mt-1 whitespace-pre-wrap">{r.asset_disposal_plan}</dd>
                          </div>
                        </>
                      )}
                      <div className="sm:col-span-2">
                        <dt className="text-gray-500">Contact</dt>
                        <dd className="text-gray-900">
                          {r.contact_name} · {r.contact_phone}
                          {r.contact_email && ` · ${r.contact_email}`}
                        </dd>
                      </div>
                    </dl>

                    {/* Documents */}
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">Supporting documents</p>
                      {r.documents.length === 0 && (
                        <p className="text-sm text-gray-500">No documents attached yet.</p>
                      )}
                      <ul className="space-y-1">
                        {r.documents.map((d) => (
                          <li key={d.id} className="text-sm">
                            <a href={d.url} target="_blank" rel="noreferrer" className="text-[#2D6A4F] hover:underline">
                              {d.name}
                            </a>
                            <span className="text-gray-500"> — {d.criterionId ?? "unclassified"}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Applicant document upload, per criterion */}
                      {r.submitted_by === user?.id && r.request_type === "formation" && criteria && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {criteria.formation
                            .filter((c) => c.kind === "document")
                            .map((c) => {
                              const attached = r.documents.some((d) => d.criterionId === c.id);
                              return (
                                <label
                                  key={c.id}
                                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                                    attached ? "border-green-300 bg-green-50 text-green-900" : "border-gray-300 hover:bg-gray-50"
                                  }`}
                                >
                                  {attached ? <CheckCircle2 className="w-4 h-4" /> : <Upload className="w-4 h-4 text-gray-500" />}
                                  <span className="flex-1">{c.label}</span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) uploadDoc(r.id, c.id, f);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    {/* Review history */}
                    {r.reviews.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-900 mb-2">Review history</p>
                        <ul className="space-y-2">
                          {r.reviews.map((v) => (
                            <li key={v.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                              <span className="font-medium text-gray-900">
                                {STAGE_LABEL[v.stage]} — {v.decision}
                              </span>
                              <span className="text-gray-500"> · {v.reviewerName} · {formatDate(v.reviewedAt)}</span>
                              {v.note && <p className="text-gray-700 mt-1">{v.note}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-5 border-t border-gray-200 pt-4 flex flex-wrap gap-3">
                  {r.request_type === "formation" && (
                    <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => runAssessment(r.id)}>
                      <span className="flex items-center gap-2">
                        <Brain className="w-4 h-4" />
                        Re-run eligibility check
                      </span>
                    </Button>
                  )}
                  {r.submitted_by === user?.id && (
                    <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => withdraw(r.id)}>
                      Withdraw
                    </Button>
                  )}
                </div>

                {canActOn(r) && (
                  <div className="mt-4 border-t border-gray-200 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Decision note (required to reject or return)
                    </label>
                    <textarea
                      rows={2}
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
                    />
                    <div className="flex flex-wrap gap-3 mt-3">
                      <Button disabled={busyId === r.id} onClick={() => decide(r.id, "approved")}>
                        {r.current_stage === "rca" ? "Approve — takes effect" : "Approve & forward"}
                      </Button>
                      <Button variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, "returned")}>
                        Return for more information
                      </Button>
                      <Button variant="danger" disabled={busyId === r.id} onClick={() => decide(r.id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      {r.current_stage === "rca"
                        ? r.request_type === "formation"
                          ? "Approving registers the cooperative immediately."
                          : "Approving dissolves the cooperative immediately."
                        : `Approving forwards this to the ${STAGE_LABEL[STAGE_ORDER[STAGE_ORDER.indexOf(r.current_stage as any) + 1]]}.`}
                    </p>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {closed.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Closed requests</h2>
          <div className="space-y-3">
            {closed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
                <div>
                  <p className="font-medium text-gray-900">
                    <span className="font-mono text-xs text-gray-500 mr-2">{r.reference}</span>
                    {r.request_type === "formation" ? r.proposed_name : r.cooperative_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.request_type} · {r.sector} sector · filed {formatDate(r.created_at)}
                  </p>
                  {r.reviews.slice(-1)[0]?.note && (
                    <p className="text-sm text-gray-700 mt-2">{r.reviews.slice(-1)[0].note}</p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
