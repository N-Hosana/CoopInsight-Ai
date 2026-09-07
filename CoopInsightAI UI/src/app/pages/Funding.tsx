import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import {
  HandCoins,
  Building,
  Handshake,
  Target,
  Ban,
  Inbox,
  CheckCircle2,
  Send,
  Users,
  ExternalLink,
} from "lucide-react";

/**
 * External support: who funds cooperatives like this one, which programmes are
 * open, and how well each fits.
 *
 * The matching is deliberately explainable — every score comes back with the
 * three factors behind it and a plain-language reason for each, because a
 * manager who is told "you scored 0.4" and nothing else cannot act on it.
 */

interface Organization {
  id: string;
  name: string;
  type: string;
  description: string | null;
  focus_areas: string[];
  support_types: string[];
  target_bands: string[];
  min_amount: string | null;
  max_amount: string | null;
  eligibility_notes: string | null;
  contact_role: string | null;
  open_opportunities: string;
  partnerships: string;
}

interface Opportunity {
  id: string;
  title: string;
  description: string;
  support_type: string;
  amount_available: string | null;
  currency: string;
  organization_name: string;
  organization_type: string;
  closes_on: string | null;
  min_members: number | null;
  min_health_score: string | null;
  requires_permanent_permit: boolean;
}

interface Match {
  opportunityId: string;
  score: number;
  eligible: boolean;
  recommended: boolean;
  blockers: string[];
  components: { specialisation: number; state: number; relationship: number };
  reasons: string[];
  alreadyApplied: string | null;
  opportunity: Opportunity;
}

interface FundingRequest {
  id: string;
  reference: string;
  cooperative_name: string;
  organization_name: string;
  opportunity_title: string | null;
  support_type: string;
  requested_amount: string | null;
  purpose: string;
  status: string;
  match_score: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
  disbursed_total: string;
  disbursements: Array<{ id: string; amount: string; disbursedOn: string; reference: string | null }>;
  created_at: string;
}

interface Partnership {
  id: string;
  organization_name: string;
  organization_type: string;
  cooperative_name: string;
  status: string;
  relationship_strength: number;
  liaison_name: string | null;
  liaison_role: string | null;
  last_contact_on: string | null;
  notes: string | null;
}

const money = (v: string | number | null | undefined, currency = "RWF") =>
  v == null ? "—" : `${currency} ${Number(v).toLocaleString()}`;

const formatDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const titleCase = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const STATUS_BADGE: Record<string, string> = {
  submitted: "bg-amber-100 text-amber-800",
  under_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  disbursed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  withdrawn: "bg-gray-100 text-gray-700",
};

/** The three factors, shown as bars so the ranking is arguable rather than opaque. */
function MatchBreakdown({ components }: { components: Match["components"] }) {
  const rows: Array<[string, number, string]> = [
    ["Specialisation", components.specialisation, "Does the funder work on what this cooperative does?"],
    ["Condition", components.state, "Is this cooperative's current state who the programme is for?"],
    ["Relationship", components.relationship, "Does the cooperative already know this funder?"],
  ];
  return (
    <div className="space-y-2.5">
      {rows.map(([label, value, hint]) => (
        <div key={label}>
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-gray-700" title={hint}>
              {label}
            </p>
            <p className="text-xs font-medium text-gray-600">{Math.round(value * 100)}%</p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200">
            <div
              className="h-1.5 rounded-full bg-[#2D6A4F]"
              style={{ width: `${Math.round(value * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Matches — what this cooperative could apply for
// ─────────────────────────────────────────────────────────────────────────────

function MatchesTab({ cooperativeId, onApplied }: { cooperativeId?: string; onApplied: () => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [cooperative, setCooperative] = useState<any>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ requestedAmount: "", purpose: "", expectedBeneficiaries: "" });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<any>(
        `/funding/matches${cooperativeId ? `?cooperativeId=${cooperativeId}` : ""}`
      );
      setMatches(res.data ?? []);
      setCooperative(res.cooperative);
      setNote(res.note);
    } catch (err: any) {
      setError(err?.message ?? "Could not load funding matches.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [cooperativeId]);

  const apply = async (m: Match) => {
    if (form.purpose.trim().length < 40) {
      setError("Explain in at least 40 characters what the support is for and what it will change.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ message: string }>("/funding/requests", {
        cooperativeId,
        opportunityId: m.opportunityId,
        requestedAmount: form.requestedAmount ? Number(form.requestedAmount) : undefined,
        purpose: form.purpose.trim(),
        expectedBeneficiaries: form.expectedBeneficiaries
          ? Number(form.expectedBeneficiaries)
          : undefined,
      });
      setMessage(res.message);
      setApplyingTo(null);
      setForm({ requestedAmount: "", purpose: "", expectedBeneficiaries: "" });
      await load();
      onApplied();
    } catch (err: any) {
      const blockers = err?.data?.blockers as string[] | undefined;
      setError(blockers?.length ? `${err.message} ${blockers.join(" ")}` : (err?.message ?? "Could not file the application."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Matching this cooperative to open programmes…</p>;
  if (!cooperative)
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-600">{error || "No cooperative selected."}</p>
      </Card>
    );

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <Card className="p-5">
        <p className="text-sm text-gray-700">
          Matching <span className="font-semibold text-gray-900">{cooperative.name}</span> —{" "}
          {cooperative.type} in {cooperative.sector}, {cooperative.memberCount} members,
          {cooperative.band ? ` currently assessed "${cooperative.band}"` : " never audited"},
          {cooperative.hasPermanentPermit ? " permanent permit" : " temporary permit"}.
        </p>
        {note && <p className="mt-2 text-xs text-amber-800">{note}</p>}
      </Card>

      {matches.length === 0 && (
        <Card className="p-10 text-center">
          <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No programmes are open</p>
        </Card>
      )}

      {matches.map((m) => (
        <Card key={m.opportunityId} className={`p-6 ${!m.eligible ? "opacity-90" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold text-gray-900">{m.opportunity.title}</p>
                {m.recommended && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                    <Target className="w-3 h-3" /> Strong match
                  </span>
                )}
                {!m.eligible && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    <Ban className="w-3 h-3" /> Not eligible
                  </span>
                )}
                {m.alreadyApplied && (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                    Applied — {titleCase(m.alreadyApplied)}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {m.opportunity.organization_name} · {titleCase(m.opportunity.organization_type)} ·{" "}
                {titleCase(m.opportunity.support_type)}
                {m.opportunity.closes_on && ` · closes ${formatDate(m.opportunity.closes_on)}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-[#2D6A4F]">
                {Math.round(m.score * 100)}
                <span className="text-sm text-gray-500">/100</span>
              </p>
              <p className="text-xs text-gray-500">match</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-gray-700">{m.opportunity.description}</p>

          {m.opportunity.amount_available && (
            <p className="mt-2 text-sm font-medium text-gray-900">
              Up to {money(m.opportunity.amount_available, m.opportunity.currency)} available
            </p>
          )}

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <MatchBreakdown components={m.components} />
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Why this ranking</p>
              <ul className="space-y-1.5">
                {m.reasons.map((r, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    · {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {m.blockers.length > 0 && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-800">
                What would have to change before applying
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
                {m.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {m.eligible && !m.alreadyApplied && (
            <div className="mt-5 border-t border-gray-200 pt-4">
              {applyingTo !== m.opportunityId ? (
                <Button variant="primary" size="sm" onClick={() => setApplyingTo(m.opportunityId)}>
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Apply
                  </span>
                </Button>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      What is the support for, and what will it change? *
                    </label>
                    <textarea
                      rows={4}
                      value={form.purpose}
                      onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                      placeholder="Funders read this before anything else. Be concrete about what you will buy or do, and what will be different afterwards."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {form.purpose.trim().length}/40 characters minimum
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Amount requested (RWF)"
                      type="number"
                      value={form.requestedAmount}
                      onChange={(e) => setForm({ ...form, requestedAmount: e.target.value })}
                    />
                    <Input
                      label="Members who would benefit"
                      type="number"
                      value={form.expectedBeneficiaries}
                      onChange={(e) => setForm({ ...form, expectedBeneficiaries: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="primary" disabled={busy} onClick={() => apply(m)}>
                      {busy ? "Filing…" : "File the application"}
                    </Button>
                    <Button variant="outline" onClick={() => setApplyingTo(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RequestsTab({ isOversight }: { isOversight: boolean }) {
  const [requests, setRequests] = useState<FundingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: FundingRequest[] }>("/funding/requests");
      setRequests(res.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load applications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, decision: string) => {
    setBusy(id);
    setError("");
    try {
      const res = await api.patch<{ message: string }>(`/funding/requests/${id}/decision`, {
        decision,
        note: notes[id]?.trim() || undefined,
      });
      setMessage(res.message);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not record the decision.");
    } finally {
      setBusy(null);
    }
  };

  const disburse = async (id: string) => {
    const amount = Number(amounts[id]);
    if (!amount || amount <= 0) return setError("Enter the amount that was disbursed.");
    setBusy(id);
    setError("");
    try {
      const res = await api.post<{ message: string }>(`/funding/requests/${id}/disbursements`, {
        amount,
      });
      setMessage(res.message);
      setAmounts({ ...amounts, [id]: "" });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not record the disbursement.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-gray-500">Loading applications…</p>;

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {requests.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No applications yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Applications filed against an open programme appear here.
          </p>
        </Card>
      ) : (
        requests.map((r) => (
          <Card key={r.id} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {r.opportunity_title ?? titleCase(r.support_type)}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {r.reference} · {r.cooperative_name} → {r.organization_name} · filed{" "}
                  {formatDate(r.created_at)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {titleCase(r.status)}
              </span>
            </div>

            <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
              <div>
                <dt className="text-gray-500">Requested</dt>
                <dd className="font-medium text-gray-900">{money(r.requested_amount)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Disbursed</dt>
                <dd className="font-medium text-gray-900">{money(r.disbursed_total)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Match at filing</dt>
                <dd className="font-medium text-gray-900">
                  {r.match_score != null ? `${Math.round(Number(r.match_score) * 100)}/100` : "—"}
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap">
              {r.purpose}
            </p>

            {r.decision_note && (
              <p className="mt-3 text-sm text-gray-700">
                <span className="font-medium">Funder's note:</span> {r.decision_note}
                {r.decided_by_name && (
                  <span className="text-gray-500"> — recorded by {r.decided_by_name}</span>
                )}
              </p>
            )}

            {r.disbursements.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-gray-700">
                {r.disbursements.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2D6A4F]" />
                    {money(d.amount)} on {formatDate(d.disbursedOn)}
                    <span className="text-xs text-gray-500">
                      — posted to the cooperative's income
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {isOversight && ["submitted", "under_review"].includes(r.status) && (
              <div className="mt-5 border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Funder's note (required to reject)
                </label>
                <textarea
                  rows={2}
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
                <div className="flex flex-wrap gap-3 mt-3">
                  {r.status === "submitted" && (
                    <Button variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, "under_review")}>
                      Mark under review
                    </Button>
                  )}
                  <Button variant="primary" disabled={busy === r.id} onClick={() => decide(r.id, "approved")}>
                    Approve
                  </Button>
                  <Button variant="danger" disabled={busy === r.id} onClick={() => decide(r.id, "rejected")}>
                    Reject
                  </Button>
                </div>
              </div>
            )}

            {isOversight && ["approved", "disbursed"].includes(r.status) && (
              <div className="mt-5 border-t border-gray-200 pt-4 flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <Input
                    label="Record a disbursement (RWF)"
                    type="number"
                    value={amounts[r.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })}
                  />
                </div>
                <Button variant="primary" disabled={busy === r.id} onClick={() => disburse(r.id)}>
                  {busy === r.id ? "Recording…" : "Record"}
                </Button>
                <p className="text-xs text-gray-500 w-full">
                  The amount is posted to the cooperative's income at the same time, so the funding
                  record and the financials cannot disagree.
                </p>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function OrganizationsTab() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: Organization[] }>("/funding/organizations")
      .then((r) => setOrgs(r.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading the partner register…</p>;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs text-gray-600">
          The organisations in this register are illustrative — named after the kind of funder they
          represent rather than after real NGOs, so nothing here can be read as a claim about a real
          organisation's programmes or budgets. The seven cooperatives in this system are real; these
          funders are not.
        </p>
      </Card>

      {orgs.map((o) => (
        <Card key={o.id} className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-gray-700" />
                <p className="text-lg font-semibold text-gray-900">{o.name}</p>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                {titleCase(o.type)}
                {o.contact_role && ` · contact: ${o.contact_role}`}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-500">{o.open_opportunities} open programme(s)</p>
              <p className="text-gray-500">{o.partnerships} cooperative relationship(s)</p>
            </div>
          </div>

          {o.description && <p className="mt-3 text-sm text-gray-700">{o.description}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            {o.focus_areas.map((f) => (
              <span key={f} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                {f}
              </span>
            ))}
            {o.support_types.map((s) => (
              <span key={s} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800">
                {titleCase(s)}
              </span>
            ))}
            {o.target_bands.map((b) => (
              <span key={b} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs text-amber-800">
                serves: {titleCase(b)}
              </span>
            ))}
          </div>

          {(o.min_amount || o.max_amount) && (
            <p className="mt-3 text-sm text-gray-700">
              Typical range {money(o.min_amount)} – {money(o.max_amount)}
            </p>
          )}
          {o.eligibility_notes && (
            <p className="mt-2 text-xs text-gray-500">{o.eligibility_notes}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PartnershipsTab({ cooperativeId }: { cooperativeId?: string }) {
  const [items, setItems] = useState<Partnership[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    organizationId: "",
    status: "introduced",
    liaisonName: "",
    liaisonRole: "",
    relationshipStrength: "40",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [p, o] = await Promise.all([
        api.get<{ data: Partnership[] }>(
          `/funding/partnerships${cooperativeId ? `?cooperativeId=${cooperativeId}` : ""}`
        ),
        api.get<{ data: Organization[] }>("/funding/organizations"),
      ]);
      setItems(p.data ?? []);
      setOrgs(o.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load relationships.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [cooperativeId]);

  const save = async () => {
    if (!form.organizationId) return setError("Choose the organisation.");
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ message: string }>("/funding/partnerships", {
        cooperativeId,
        organizationId: form.organizationId,
        status: form.status,
        liaisonName: form.liaisonName || undefined,
        liaisonRole: form.liaisonRole || undefined,
        relationshipStrength: Number(form.relationshipStrength),
        notes: form.notes || undefined,
      });
      setMessage(res.message);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not save the relationship.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading relationships…</p>;

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm text-gray-700 max-w-2xl">
            Funding follows relationships. A cooperative whose secretary already knows the programme
            officer gets the call — so who you actually deal with is recorded here rather than left
            implicit, and it counts for a fifth of every match score.
          </p>
          {cooperativeId && !showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)}>
              <span className="flex items-center gap-2">
                <Handshake className="w-4 h-4" />
                Record a relationship
              </span>
            </Button>
          )}
        </div>

        {showForm && (
          <div className="mt-5 space-y-4 border-t border-gray-200 pt-5">
            <Select
              label="Organisation *"
              value={form.organizationId}
              onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
              options={[
                { value: "", label: "Select an organisation…" },
                ...orgs.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Where the relationship stands"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={[
                  { value: "introduced", label: "Introduced, nothing yet" },
                  { value: "active", label: "Actively working together" },
                  { value: "completed", label: "Worked together in the past" },
                  { value: "ended", label: "Relationship has ended" },
                ]}
              />
              <Input
                label="How well do you know them? (0–100)"
                type="number"
                min={0}
                max={100}
                value={form.relationshipStrength}
                onChange={(e) => setForm({ ...form, relationshipStrength: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Who you deal with"
                value={form.liaisonName}
                onChange={(e) => setForm({ ...form, liaisonName: e.target.value })}
              />
              <Input
                label="Their role"
                value={form.liaisonRole}
                onChange={(e) => setForm({ ...form, liaisonRole: e.target.value })}
                placeholder="e.g. Programme Officer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="font-medium text-gray-900 mt-3">No relationships recorded</p>
          <p className="text-sm text-gray-500 mt-1">
            Every match currently starts from a cold introduction.
          </p>
        </Card>
      ) : (
        items.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900">{p.organization_name}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {p.cooperative_name} · {titleCase(p.status)}
                  {p.liaison_name && ` · ${p.liaison_name}`}
                  {p.liaison_role && ` (${p.liaison_role})`}
                  {p.last_contact_on && ` · last contact ${formatDate(p.last_contact_on)}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-[#2D6A4F]">{p.relationship_strength}</p>
                <p className="text-xs text-gray-500">strength /100</p>
              </div>
            </div>
            {p.notes && <p className="mt-3 text-sm text-gray-700">{p.notes}</p>}
          </Card>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Funding() {
  const { user } = useAuth();
  const isOversight = ["admin", "generalManager", "government"].includes(user?.role ?? "");
  const [tab, setTab] = useState<"matches" | "requests" | "organizations" | "partnerships">(
    isOversight ? "requests" : "matches"
  );
  const [refresh, setRefresh] = useState(0);
  const [cooperatives, setCooperatives] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<string | undefined>(user?.cooperativeId ?? undefined);

  useEffect(() => {
    if (!isOversight) return;
    api
      .get<{ data: Array<{ id: string; name: string }> }>("/cooperatives?limit=100")
      .then((r) => {
        setCooperatives(r.data ?? []);
        if (!selected && r.data?.length) setSelected(r.data[0].id);
      })
      .catch(() => {
        /* the tab still works without the picker */
      });
  }, [isOversight]);

  const tabs = useMemo(
    () =>
      [
        { id: "matches" as const, label: "Matches" },
        { id: "requests" as const, label: "Applications" },
        { id: "organizations" as const, label: "Who funds cooperatives" },
        { id: "partnerships" as const, label: "Relationships" },
      ].filter((t) => t.id !== "matches" || isOversight || user?.cooperativeId),
    [isOversight, user?.cooperativeId]
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <HandCoins className="w-5 h-5 text-gray-700" />
          <h1 className="text-2xl font-semibold text-gray-900">External support</h1>
        </div>
        <p className="text-gray-600 mt-1 max-w-3xl">
          Almost none of the money that reaches a cooperative comes from the RCA — it comes from
          NGOs, development partners, government programmes, unions and banks. Which cooperative
          gets it turns on what it does, what state it is in, and who it already knows.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap rounded-lg border border-gray-200 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? "bg-[#2D6A4F] text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isOversight && cooperatives.length > 0 && ["matches", "partnerships"].includes(tab) && (
          <div className="w-64">
            <Select
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              options={cooperatives.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}
      </div>

      {tab === "matches" && (
        <MatchesTab
          key={`${selected}-${refresh}`}
          cooperativeId={selected}
          onApplied={() => setRefresh((n) => n + 1)}
        />
      )}
      {tab === "requests" && <RequestsTab key={refresh} isOversight={isOversight} />}
      {tab === "organizations" && <OrganizationsTab />}
      {tab === "partnerships" && <PartnershipsTab cooperativeId={selected} />}

      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <ExternalLink className="w-3 h-3" />
        Match scores weight specialisation 45%, the cooperative's condition 35% and the existing
        relationship 20%. Hard requirements are reported as blockers, not folded into the score.
      </p>
    </div>
  );
}
