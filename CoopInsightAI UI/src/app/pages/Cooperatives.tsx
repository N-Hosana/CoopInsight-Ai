import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { SMSPanel } from "../components/SMSPanel";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { RegistryBreakdown, Place } from "../components/RegistryBreakdown";
import { Plus, Building2, Users, ChevronDown, ChevronUp, MessageSquare, ExternalLink } from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

interface Member {
  id: string;
  name: string;
  role: string;
  contribution: string;
  phone: string;
  status: string;
  progress: string;
}

interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

/** The active permit, if any. `null` means the cooperative is unlicensed. */
interface Permit {
  permitNumber: string;
  permitType: "temporary" | "permanent";
  status: string;
  issuedOn: string | null;
  expiresOn: string | null;
}

/** A formation or dissolution request still in the chain against this row. */
interface OpenRequest {
  id: string;
  reference: string;
  requestType: string;
  status: string;
  currentStage: string;
}

/** One reason a cooperative on the register is not active. */
interface InactiveReason {
  id: string;
  label: string;
  description: string;
  count: number;
}

interface RegistryView {
  id: string;
  label: string;
  description: string;
  kind: "cooperatives" | "requests";
  count: number;
  /** Only on "not active": the breakdown by reason. */
  reasons?: InactiveReason[];
}

/** An RCA audit that is still open against the cooperative. */
interface OpenAudit {
  reference: string;
  auditType: string;
  status: string;
  dueOn: string | null;
}

interface Cooperative {
  id: string;
  name: string;
  sector: string;
  district: string;
  type: string;
  registrationNumber: string;
  registrationDate: string;
  status: string;
  operatingArea: string;
  membershipSize: string;
  archivedMembers: number;
  composition: "Male" | "Female" | "Mixed";
  permit: Permit | null;
  openRequest: OpenRequest | null;
  auditBand: string | null;
  openAudit: OpenAudit | null;
  /** Why it is not active, most decisive first; empty when it is active. */
  inactiveReasons: string[];
  bylawsFileName: string;
  constitutionFileName: string;
  licenseFileName: string;
  permitsFileName: string;
  leadership: {
    president: string;
    presidentEmail?: string;
    presidentPhone?: string;
    vicePresident: string;
    vicePresidentEmail?: string;
    vicePresidentPhone?: string;
    secretary: string;
    secretaryEmail?: string;
    secretaryPhone?: string;
    sectorOfficer: string;
    sectorOfficerPhone?: string;
  };
  members: Member[];
  totalSavings: string;
  healthScore: number;
  documents: CooperativeDocument[];
}

// Roles are matched exactly so "Vice President" is never mistaken for "President".
const findLeader = (leadership: any[], role: string) =>
  leadership.find((l: any) => l.role?.trim().toLowerCase() === role);

function mapApiCooperative(raw: any, membershipSize?: number, composition: Cooperative["composition"] = "Mixed"): Cooperative {
  const leadership: any[] = Array.isArray(raw.leadership) ? raw.leadership : [];
  const president = findLeader(leadership, "president");
  const vicePresident = findLeader(leadership, "vice president");
  const secretary = findLeader(leadership, "secretary");
  const sectorOfficer = findLeader(leadership, "sector cooperative officer");
  const totalSavings = Number(raw.total_savings ?? 0);

  return {
    id: String(raw.id ?? ""),
    name: raw.name ?? "",
    sector: raw.sector ?? "",
    district: raw.district ?? "Gasabo",
    type: raw.type ?? "",
    registrationNumber: raw.registration_number ?? "",
    registrationDate: raw.registration_date ? String(raw.registration_date).slice(0, 10) : "",
    status: raw.status ?? "Active",
    operatingArea: raw.address ?? "",
    membershipSize: String(membershipSize ?? raw.member_count ?? 0),
    archivedMembers: Number(raw.archived_member_count ?? 0),
    composition,
    permit: raw.permit
      ? {
          permitNumber: raw.permit.permit_number,
          permitType: raw.permit.permit_type,
          status: raw.permit.status,
          issuedOn: raw.permit.issued_on ?? null,
          expiresOn: raw.permit.expires_on ?? null,
        }
      : null,
    openRequest: raw.open_request
      ? {
          id: raw.open_request.id,
          reference: raw.open_request.reference,
          requestType: raw.open_request.request_type,
          status: raw.open_request.status,
          currentStage: raw.open_request.current_stage,
        }
      : null,
    auditBand: raw.audit_band ?? null,
    openAudit: raw.open_audit
      ? {
          reference: raw.open_audit.reference,
          auditType: raw.open_audit.audit_type,
          status: raw.open_audit.status,
          dueOn: raw.open_audit.due_on ?? null,
        }
      : null,
    inactiveReasons: Array.isArray(raw.inactive_reasons) ? raw.inactive_reasons : [],
    bylawsFileName: "",
    constitutionFileName: "",
    licenseFileName: "",
    permitsFileName: "",
    leadership: {
      president: president?.name ?? "",
      presidentEmail: president?.email ?? "",
      presidentPhone: president?.phone ?? "",
      vicePresident: vicePresident?.name ?? "",
      vicePresidentEmail: vicePresident?.email ?? "",
      vicePresidentPhone: vicePresident?.phone ?? "",
      secretary: secretary?.name ?? "",
      secretaryEmail: secretary?.email ?? "",
      secretaryPhone: secretary?.phone ?? "",
      sectorOfficer: sectorOfficer?.name ?? "",
      sectorOfficerPhone: sectorOfficer?.phone ?? "",
    },
    members: [],
    totalSavings: `RWF ${totalSavings.toLocaleString()}`,
    healthScore: Math.round(Number(raw.health_score ?? 0)),
    documents: [],
  };
}

const STAGE_NAMES: Record<string, string> = {
  sector: "sector officer",
  district: "district officer",
  rca: "RCA",
};

/**
 * The specific detail behind one "not active" reason, so the badge says not
 * just "no permit" but which permit lapsed and when.
 */
function reasonDetail(id: string, coop: Cooperative): string | null {
  switch (id) {
    case "under_final_audit":
      return coop.openAudit
        ? `${coop.openAudit.auditType.replace(/_/g, " ")} audit ${coop.openAudit.reference}, ${coop.openAudit.status.replace(/_/g, " ")}` +
            (coop.openAudit.dueOn ? `, due ${new Date(coop.openAudit.dueOn).toLocaleDateString()}` : "")
        : null;
    case "dissolving":
      return coop.openRequest?.requestType === "dissolution"
        ? `${coop.openRequest.reference}, with the ${STAGE_NAMES[coop.openRequest.currentStage] ?? coop.openRequest.currentStage}`
        : null;
    case "no_permit":
      if (!coop.permit) return "never issued";
      return coop.permit.status !== "active"
        ? `${coop.permit.permitNumber} ${coop.permit.status}`
        : coop.permit.expiresOn
          ? `${coop.permit.permitNumber} expired ${new Date(coop.permit.expiresOn).toLocaleDateString()}`
          : null;
    case "temporary_permit":
      return coop.permit?.expiresOn
        ? `temporary permit to ${new Date(coop.permit.expiresOn).toLocaleDateString()}`
        : null;
    default:
      return null;
  }
}

/**
 * The licence, as one badge.
 *
 * No permit is not a neutral state — it means the cooperative is on the
 * register and trading without authorisation — so it is shown in red rather
 * than as a quiet dash.
 */
function PermitBadge({ permit }: { permit: Permit | null }) {
  if (!permit || permit.status !== "active") {
    return (
      <span
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
        title={
          permit
            ? `Last permit ${permit.permitNumber} is ${permit.status}.`
            : "No operating permit has ever been issued to this cooperative."
        }
      >
        No permit
      </span>
    );
  }

  const expires = permit.expiresOn ? new Date(permit.expiresOn) : null;
  const lapsed = expires ? expires.getTime() < Date.now() : false;
  if (lapsed) {
    return (
      <span
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
        title={`Permit ${permit.permitNumber} expired on ${expires!.toLocaleDateString()}.`}
      >
        Permit expired
      </span>
    );
  }

  const temporary = permit.permitType === "temporary";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        temporary ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
      }`}
      title={
        `Permit ${permit.permitNumber}` +
        (expires ? `, valid to ${expires.toLocaleDateString()}` : "") +
        (temporary ? ". An RCA maturity audit decides whether it becomes permanent." : ".")
      }
    >
      {temporary ? "Temporary permit" : "Licensed"}
    </span>
  );
}

/** A request row, for the Applications category, which lists requests rather than cooperatives. */
interface PendingRequest {
  id: string;
  reference: string;
  request_type: string;
  status: string;
  current_stage: string;
  sector: string;
  district?: string;
  proposed_name: string | null;
  cooperative_name: string | null;
  contact_name: string;
  contact_phone: string;
  created_at: string;
  response_due_at: string;
  process?: { percentComplete: number; nextAction: string | null; blockedBy: string | null };
}

const STAGE_LABELS: Record<string, string> = {
  sector: "Sector officer",
  district: "District officer",
  rca: "RCA",
  closed: "Closed",
};

export function Cooperatives() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cooperatives, setCooperatives] = useState<Cooperative[]>([]);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [views, setViews] = useState<RegistryView[]>([]);
  // A member has no category tabs and only ever sees their own cooperative,
  // so they read the whole register rather than one slice of it.
  const [view, setView] = useState(user?.role === "member" ? "all" : "active");
  const [reason, setReason] = useState<string | null>(null);
  const [onRegister, setOnRegister] = useState<number | null>(null);
  // The district office reads the register by sector and the RCA by district;
  // a sector officer already sees only their own sector.
  const canSeeBreakdown =
    ["admin", "generalManager"].includes(user?.role ?? "") ||
    (user?.role === "government" && user?.oversightLevel !== "sector");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeView = views.find((v) => v.id === view) ?? null;

  /**
   * The tab strip. Loaded once from the backend rather than restated here, so
   * a label can never claim a different rule from the one the query applied.
   */
  const fetchViews = async () => {
    try {
      const res = await api.get<{ data: RegistryView[]; onRegister?: number }>("/cooperatives/registry");
      setViews(Array.isArray(res?.data) ? res.data : []);
      setOnRegister(res?.onRegister ?? null);
    } catch {
      // The tab strip is a convenience. If it fails the list below still works
      // on the default view, so this is not surfaced as a page error.
      setViews([]);
    }
  };

  const fetchCooperatives = async (selectedView = view, selectedReason = reason, selectedPlace = place) => {
    setLoading(true);
    setError(null);
    try {
      const definition = views.find((v) => v.id === selectedView);

      // "Applications" lists REQUESTS, not cooperatives — a group applying to
      // form one does not have a row in the register yet.
      if (definition?.kind === "requests") {
        const res = await api.get<any>(`/cooperative-requests?type=formation`);
        const all: PendingRequest[] = Array.isArray(res?.data) ? res.data : [];
        setRequests(
          all.filter(
            (r) =>
              String(r.status).startsWith("pending") &&
              (!selectedPlace?.sector || r.sector === selectedPlace.sector) &&
              (!selectedPlace?.district || (r.district ?? "Gasabo") === selectedPlace.district)
          )
        );
        setCooperatives([]);
        return;
      }

      const response = await api.get<any>(
        `/cooperatives?view=${encodeURIComponent(selectedView)}&page=1&limit=100` +
          (selectedView === "not_active" && selectedReason
            ? `&reason=${encodeURIComponent(selectedReason)}`
            : "") +
          (selectedPlace?.sector ? `&sector=${encodeURIComponent(selectedPlace.sector)}` : "") +
          (selectedPlace?.district ? `&district=${encodeURIComponent(selectedPlace.district)}` : "")
      );
      const membersResponse = await api.get<any>("/members?page=1&limit=500");
      const rawList: any[] = Array.isArray(response?.data) ? response.data : [];
      const memberList: any[] = Array.isArray(membersResponse?.data) ? membersResponse.data : [];

      const counts = new Map<string, { count: number; genders: Set<string> }>();
      for (const member of memberList) {
        const coopId = String(member.cooperative_id ?? "");
        if (!coopId) continue;
        const existing = counts.get(coopId) ?? { count: 0, genders: new Set<string>() };
        existing.count += 1;
        if (member.gender) existing.genders.add(String(member.gender).toLowerCase());
        counts.set(coopId, existing);
      }

      setRequests([]);
      setCooperatives(rawList.map((raw: any) => {
        const coopId = String(raw.id ?? "");
        const memberInfo = counts.get(coopId);
        const count = memberInfo?.count ?? Number(raw.member_count ?? 0);
        const composition = memberInfo?.genders.size === 0
          ? "Mixed"
          : memberInfo?.genders.size === 1
            ? (memberInfo.genders.has("male") ? "Male" : "Female")
            : "Mixed";
        return mapApiCooperative(raw, count, composition as Cooperative["composition"]);
      }));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? "Failed to load cooperatives.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchViews();
  }, []);

  useEffect(() => {
    fetchCooperatives(view, reason, place);
    // `views` is in the deps because the fetch needs to know whether the
    // selected view lists cooperatives or requests, and that comes from it.
  }, [view, reason, place, views.length]);

  const reasonLabels = new Map(
    (views.find((v) => v.id === "not_active")?.reasons ?? []).map((r) => [r.id, r])
  );

  // Filter cooperatives based on user role
  const filteredCooperatives = (() => {
    if (user?.role === "member" && user.cooperativeId) {
      return cooperatives.filter(coop => coop.id === user.cooperativeId);
    }
    if (user?.role === "manager" && user.cooperativeId) {
      return cooperatives.filter(coop => coop.id === user.cooperativeId);
    }
    return cooperatives;
  })();

  const [expandedCoop, setExpandedCoop] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSMS, setShowSMS] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    sector: "",
    district: "Gasabo District",
    type: "",
    registrationNumber: "",
    registrationDate: "",
    status: "Active",
    operatingArea: "",
    membershipSize: "",
    president: "",
    presidentEmail: "",
    presidentPhone: "",
    vicePresident: "",
    vicePresidentEmail: "",
    vicePresidentPhone: "",
    secretary: "",
    secretaryEmail: "",
    secretaryPhone: "",
    bylawsFileName: "",
    constitutionFileName: "",
    licenseFileName: "",
    permitsFileName: "",
  });
  const [registrationFiles, setRegistrationFiles] = useState<{
    bylaws: File | null;
    constitution: File | null;
    license: File | null;
    permits: File | null;
  }>({ bylaws: null, constitution: null, license: null, permits: null });

  const uploadRegistrationDocument = async (cooperativeId: string, type: string, file: File) => {
    const token = localStorage.getItem("coopinsight_access_token");
    const body = new FormData();
    body.append("file", file);
    body.append("name", file.name);
    body.append("type", type);
    await fetch(`${BASE_URL}/cooperatives/${cooperativeId}/documents`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const requiredFields = [
      "name",
      "sector",
      "type",
      "registrationNumber",
      "registrationDate",
      "operatingArea",
      "membershipSize",
      // Only the president is mandatory — the vice president and secretary posts
      // are genuinely vacant in some cooperatives on the RCA register.
      "president",
      "bylawsFileName",
      "constitutionFileName",
      "licenseFileName",
      "permitsFileName",
    ];

    const missingField = requiredFields.find((field) => !formData[field as keyof typeof formData]);
    if (missingField) {
      setFormError("Please complete all required cooperative registration fields.");
      return;
    }

    const selectedDate = new Date(formData.registrationDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (selectedDate > today) {
      setFormError("Registration date cannot be in the future.");
      return;
    }

    setFormSubmitting(true);
    try {
      const createRes = await api.post<{ data: { id: string } }>("/cooperatives", {
        name: formData.name,
        type: formData.type,
        registration_number: formData.registrationNumber,
        sector: formData.sector,
        status: formData.status,
        member_count: Number(formData.membershipSize),
        registration_date: formData.registrationDate,
        address: formData.operatingArea,
        description: `Type: ${formData.type}`,
      });
      const newCoopId = (createRes as any).data?.id;

      if (newCoopId) {
        const leadershipEntries: Array<[string, string, string, string]> = [
          [formData.president, "President", formData.presidentEmail, formData.presidentPhone],
          [formData.vicePresident, "Vice President", formData.vicePresidentEmail, formData.vicePresidentPhone],
          [formData.secretary, "Secretary", formData.secretaryEmail, formData.secretaryPhone],
        ];
        await Promise.all(
          leadershipEntries
            .filter(([name]) => name)
            .map(([name, role, email, phone]) =>
              api.post(`/cooperatives/${newCoopId}/leadership`, { name, role, email, phone })
            )
        );

        const fileUploads: Array<[string, File | null]> = [
          ["bylaws", registrationFiles.bylaws],
          ["constitution", registrationFiles.constitution],
          ["license", registrationFiles.license],
          ["permit", registrationFiles.permits],
        ];
        await Promise.all(
          fileUploads
            .filter(([, file]) => file)
            .map(([type, file]) => uploadRegistrationDocument(newCoopId, type, file as File))
        );
      }

      await fetchCooperatives();
      setFormData({
        name: "",
        sector: "",
        district: "Gasabo District",
        type: "",
        registrationNumber: "",
        registrationDate: "",
        status: "Active",
        operatingArea: "",
        membershipSize: "",
        president: "",
        presidentEmail: "",
        presidentPhone: "",
        vicePresident: "",
        vicePresidentEmail: "",
        vicePresidentPhone: "",
        secretary: "",
        secretaryEmail: "",
        secretaryPhone: "",
        bylawsFileName: "",
        constitutionFileName: "",
        licenseFileName: "",
        permitsFileName: "",
      });
      setRegistrationFiles({ bylaws: null, constitution: null, license: null, permits: null });
      setShowForm(false);
    } catch (err: any) {
      setFormError(err?.response?.data?.message ?? err?.message ?? "Failed to register cooperative.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const toggleExpand = (coopId: string) => {
    setExpandedCoop(expandedCoop === coopId ? null : coopId);
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const allMembers = filteredCooperatives.flatMap(coop =>
    coop.members.map(member => ({
      ...member,
      cooperative: coop.name,
    }))
  );

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {(user?.role === "member" || user?.role === "manager") ? "My Cooperative" : "Cooperatives Management"}
          </h1>
          {(user?.role === "member" || user?.role === "manager") && user.cooperativeName && (
            <p className="text-gray-600 mt-1">{user.cooperativeName}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowSMS(!showSMS)}>
            <MessageSquare className="w-4 h-4 mr-2" />
            SMS Notifications
          </Button>
          {(user?.role === "admin" || user?.role === "generalManager") && (
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="w-4 h-4 mr-2" />
              Register Cooperative
            </Button>
          )}
        </div>
      </div>

      {/* SMS Panel */}
      {showSMS && (
        <div className="mb-8">
          <SMSPanel members={allMembers} />
        </div>
      )}

      {/* Add Cooperative Form */}
      {showForm && (user?.role === "admin" || user?.role === "generalManager") && (
        <Card className="p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Register New Cooperative</h2>
              <p className="text-gray-600 mt-1">Only admin and general managers can register new cooperatives.</p>
            </div>
          </div>

          {formError && <p className="text-sm text-red-600 mb-4">{formError}</p>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Cooperative Name"
                placeholder="Enter cooperative name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                label="Registration Number"
                placeholder="RWA-2024-001"
                value={formData.registrationNumber}
                onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                required
              />
              <Input
                label="Sector"
                placeholder="Agriculture, Fisheries, Retail"
                value={formData.sector}
                onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                required
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">District</label>
                <input
                  type="text"
                  value={formData.district}
                  readOnly
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cooperative Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                >
                  <option value="">Select a type</option>
                  <option value="Agriculture">Agriculture</option>
                  <option value="Livestock">Livestock</option>
                  <option value="Handicrafts">Handicrafts</option>
                  <option value="Services">Services</option>
                  <option value="Trading">Trading</option>
                  <option value="Transport">Transport</option>
                  <option value="Construction">Construction</option>
                  <option value="Carpentry">Carpentry</option>
                  <option value="Dairy">Dairy</option>
                  <option value="Coffee">Coffee</option>
                  <option value="Tea">Tea</option>
                  <option value="Honey Production">Honey Production</option>
                  <option value="Poultry">Poultry</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Registration Date</label>
                <input
                  type="date"
                  value={formData.registrationDate}
                  onChange={(e) => setFormData({ ...formData, registrationDate: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Operating Area</label>
                <input
                  type="text"
                  value={formData.operatingArea}
                  onChange={(e) => setFormData({ ...formData, operatingArea: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Membership Size</label>
                <input
                  type="number"
                  min={1}
                  value={formData.membershipSize}
                  onChange={(e) => setFormData({ ...formData, membershipSize: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">President</label>
                <input
                  type="text"
                  value={formData.president}
                  onChange={(e) => setFormData({ ...formData, president: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">President Email</label>
                <input
                  type="email"
                  value={formData.presidentEmail}
                  onChange={(e) => setFormData({ ...formData, presidentEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">President Phone</label>
                <input
                  type="tel"
                  value={formData.presidentPhone}
                  onChange={(e) => setFormData({ ...formData, presidentPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vice President</label>
                <input
                  type="text"
                  value={formData.vicePresident}
                  onChange={(e) => setFormData({ ...formData, vicePresident: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vice President Email</label>
                <input
                  type="email"
                  value={formData.vicePresidentEmail}
                  onChange={(e) => setFormData({ ...formData, vicePresidentEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vice President Phone</label>
                <input
                  type="tel"
                  value={formData.vicePresidentPhone}
                  onChange={(e) => setFormData({ ...formData, vicePresidentPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secretary</label>
                <input
                  type="text"
                  value={formData.secretary}
                  onChange={(e) => setFormData({ ...formData, secretary: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secretary Email</label>
                <input
                  type="email"
                  value={formData.secretaryEmail}
                  onChange={(e) => setFormData({ ...formData, secretaryEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secretary Phone</label>
                <input
                  type="tel"
                  value={formData.secretaryPhone}
                  onChange={(e) => setFormData({ ...formData, secretaryPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload Bylaws</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFormData({ ...formData, bylawsFileName: file.name });
                      setRegistrationFiles((prev) => ({ ...prev, bylaws: file }));
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload Constitution</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFormData({ ...formData, constitutionFileName: file.name });
                      setRegistrationFiles((prev) => ({ ...prev, constitution: file }));
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload License</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFormData({ ...formData, licenseFileName: file.name });
                      setRegistrationFiles((prev) => ({ ...prev, license: file }));
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload Permit</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFormData({ ...formData, permitsFileName: file.name });
                      setRegistrationFiles((prev) => ({ ...prev, permits: file }));
                    }
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-600"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={formSubmitting}>
                {formSubmitting ? "Registering..." : "Register Cooperative"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/*
        ── The register, sliced ──────────────────────────────────────────────
        An officer opening this page is looking for one specific thing:
        which cooperatives are licensed, which are trading with no permit,
        what is waiting to be approved, what is being wound up. Making them
        scan every row for it was the whole problem. Each tab is one of those
        questions, its count comes from the same query that fills the list,
        and its meaning is spelled out underneath so the number is arguable.
      */}
      {views.length > 0 && (user?.role !== "member") && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setView(v.id);
                  setReason(null);
                }}
                title={v.description}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  view === v.id
                    ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span>{v.label}</span>
                <span
                  className={`rounded-full px-1.5 text-xs font-semibold ${
                    view === v.id
                      ? "bg-white/20"
                      : v.id === "not_active" && v.count > 0
                        ? "bg-red-100 text-red-700"
                        : v.id === "at_risk" && v.count > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {v.count}
                </span>
              </button>
            ))}
          </div>
          {onRegister != null && (
            <p className="mt-2 text-xs text-gray-500">
              {onRegister} on the register: active, not active and at risk together account for
              every one of them.
            </p>
          )}

          {canSeeBreakdown && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowBreakdown((s) => !s)}
                className="text-sm font-medium text-[#2D6A4F] hover:underline"
              >
                {showBreakdown
                  ? "Hide the breakdown"
                  : user?.oversightLevel === "district"
                    ? "Break down by sector"
                    : "Break down by district and sector"}
              </button>
              {place && (
                <span className="inline-flex items-center gap-2 rounded-full bg-[#2D6A4F]/10 px-3 py-1 text-xs font-medium text-[#1b4332]">
                  Showing {place.label} only
                  <button onClick={() => setPlace(null)} className="text-[#1b4332] hover:text-red-700" aria-label="Clear place filter">
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
          {canSeeBreakdown && showBreakdown && (
            <Card className="mt-3 p-5">
              <RegistryBreakdown
                onSelect={(nextView, nextPlace) => {
                  setView(nextView);
                  setReason(null);
                  setPlace(nextPlace);
                }}
              />
            </Card>
          )}
          {activeView && (
            <p className="mt-3 max-w-3xl text-sm text-gray-600">{activeView.description}</p>
          )}

          {/* Why they are not active — the detail inside the category. */}
          {activeView?.reasons && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setReason(null)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  reason === null
                    ? "border-gray-800 bg-gray-800 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Every reason
              </button>
              {activeView.reasons.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReason(r.id)}
                  disabled={r.count === 0}
                  title={r.description}
                  className={`rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40 ${
                    reason === r.id
                      ? "border-gray-800 bg-gray-800 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {r.label} · {r.count}
                </button>
              ))}
            </div>
          )}
          {activeView?.reasons && (
            <p className="mt-2 text-xs text-gray-500">
              {reason
                ? reasonLabels.get(reason)?.description
                : "A cooperative with more than one reason is counted under each."}
            </p>
          )}
        </div>
      )}

      {/* Loading / Error States */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          Loading cooperatives...
        </div>
      )}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-red-600">{error}</p>
          <Button variant="secondary" onClick={() => fetchCooperatives(view)}>Retry</Button>
        </div>
      )}

      {/*
        ── Requests, for the one category that is not cooperatives at all ────
        "Applications" lists formation requests, not register rows. Showing
        them as an empty cooperative list — which is
        what a naive status filter would do — reads as "there are none", when
        the truth is "there are four and they are all waiting on you".
      */}
      {!loading && !error && activeView?.kind === "requests" && (
        <div className="space-y-3">
          {requests.length === 0 && (
            <div className="flex items-center justify-center py-16 text-gray-500">
              Nothing waiting in this queue.
            </div>
          )}
          {requests.map((request) => (
            <Card key={request.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-500">{request.reference}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      With the {STAGE_LABELS[request.current_stage] ?? request.current_stage}
                    </span>
                  </div>
                  <h3 className="mt-1 truncate text-lg font-semibold text-gray-900">
                    {request.proposed_name || request.cooperative_name || "Unnamed"}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {request.sector} sector · filed by {request.contact_name}
                    {request.contact_phone ? ` · ${request.contact_phone}` : ""}
                  </p>
                  {request.process?.blockedBy && (
                    <p className="mt-1 text-sm text-red-600">
                      Blocked: {request.process.blockedBy}
                    </p>
                  )}
                  {!request.process?.blockedBy && request.process?.nextAction && (
                    <p className="mt-1 text-sm text-gray-500">{request.process.nextAction}</p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {request.process && (
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Progress</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {request.process.percentComplete}%
                      </p>
                    </div>
                  )}
                  <Button variant="secondary" onClick={() => navigate("/rca-services")}>
                    Open
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Cooperatives List with Expandable Details */}
      {!loading && !error && activeView?.kind !== "requests" && (
        <div className="space-y-4">
          {filteredCooperatives.length === 0 && (
            <div className="flex items-center justify-center py-16 text-gray-500">
              No cooperatives found.
            </div>
          )}
          {filteredCooperatives.map((coop) => {
            const isExpanded = expandedCoop === coop.id;

            return (
              <Card key={coop.id} className="overflow-hidden">
                {/* Cooperative Header */}
                <div
                  className="p-6 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(coop.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-[#2D6A4F]/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-6 h-6 text-[#2D6A4F]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900 text-lg">{coop.name}</h3>
                        {/*
                          The licence, on the row. Whether a cooperative may
                          legally trade is the single most important fact about
                          it, and it used to be three clicks away on another
                          page. An unlicensed cooperative now says so here.
                        */}
                        <PermitBadge permit={coop.permit} />
                        {/* A dissolution shows as a "not active" reason below instead. */}
                        {coop.openRequest && coop.openRequest.requestType !== "dissolution" && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {coop.openRequest.requestType.replace(/_/g, " ")}
                            {" — "}
                            {STAGE_LABELS[coop.openRequest.currentStage] ??
                              coop.openRequest.currentStage}
                          </span>
                        )}
                        {coop.auditBand && ["at_risk", "critical"].includes(coop.auditBand) && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            {coop.auditBand === "critical" ? "Critical" : "At risk"}
                          </span>
                        )}
                        {coop.inactiveReasons.length > 0 && (
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-white">
                            Not active
                          </span>
                        )}
                      </div>
                      {coop.inactiveReasons.length > 0 && (
                        <ul className="mb-1.5 flex flex-wrap gap-1.5">
                          {coop.inactiveReasons.map((id) => {
                            const detail = reasonDetail(id, coop);
                            return (
                              <li
                                key={id}
                                title={reasonLabels.get(id)?.description}
                                className="rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-900"
                              >
                                <span className="font-medium">{reasonLabels.get(id)?.label ?? id.replace(/_/g, " ")}</span>
                                {detail && <span className="text-orange-800"> — {detail}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {coop.membershipSize} members
                        </span>
                        {coop.archivedMembers > 0 && (
                          <span className="text-gray-400">
                            {coop.archivedMembers} archived
                          </span>
                        )}
                        <span>•</span>
                        <span>{coop.composition}</span>
                        <span>•</span>
                        <span>{coop.sector}</span>
                        <span>•</span>
                        <span>{coop.district}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Member savings</p>
                        <p className="text-lg font-semibold text-gray-900">{coop.totalSavings}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Health Score</p>
                        <p className={`text-lg font-semibold ${getHealthColor(coop.healthScore)}`}>
                          {coop.healthScore}%
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/cooperatives/profile?id=${coop.id}`); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#2D6A4F] border border-[#2D6A4F] rounded-lg hover:bg-[#2D6A4F]/10 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View Details
                      </button>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content - Members Table, leadership, and documents */}
                {isExpanded && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    <div className="p-6 space-y-6">
                      <div>
                        <h4 className="font-medium text-gray-900 mb-4">Members & Their Activities</h4>
                        {coop.members.length > 0 ? (
                          <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
                            <table className="w-full">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contribution</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {coop.members.map((member) => (
                                  <tr key={member.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{member.name}</td>
                                    <td className="px-4 py-3 text-sm text-gray-700">{member.role}</td>
                                    <td className="px-4 py-3 text-sm text-gray-700">{member.contribution}</td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{member.phone}</td>
                                    <td className="px-4 py-3">
                                      <span
                                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                          member.status === "Active"
                                            ? "bg-green-100 text-green-800"
                                            : "bg-gray-100 text-gray-800"
                                        }`}
                                      >
                                        {member.status}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700">{member.progress}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-gray-500 text-sm">No members yet</p>
                        )}
                      </div>

                      <div className="grid gap-6 lg:grid-cols-2">
                        <div className="bg-white rounded-2xl border border-gray-200 p-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4">Cooperative details</h4>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <p className="text-sm text-gray-500">Registration number</p>
                              <p className="font-medium text-gray-900">{coop.registrationNumber}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Registration date</p>
                              <p className="font-medium text-gray-900">{coop.registrationDate}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Status</p>
                              <p className="font-medium text-gray-900">{coop.status}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Operating area</p>
                              <p className="font-medium text-gray-900">{coop.operatingArea}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Membership size</p>
                              <p className="font-medium text-gray-900">{coop.membershipSize}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Membership composition</p>
                              <p className="font-medium text-gray-900">{coop.composition}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-500">Cooperative type</p>
                              <p className="font-medium text-gray-900">{coop.type}</p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-200 p-6">
                          <h4 className="text-lg font-semibold text-gray-900 mb-4">Leadership & Contact</h4>
                          <div className="space-y-4 text-sm text-gray-700">
                            <div className="grid gap-2">
                              <p className="text-sm text-gray-500">President</p>
                              <p className="font-medium text-gray-900">{coop.leadership.president || "—"}</p>
                              {coop.leadership.presidentEmail && <p className="text-gray-500">{coop.leadership.presidentEmail}</p>}
                              {coop.leadership.presidentPhone && <p className="text-gray-500">{coop.leadership.presidentPhone}</p>}
                            </div>
                            <div className="grid gap-2">
                              <p className="text-sm text-gray-500">Vice President</p>
                              <p className="font-medium text-gray-900">{coop.leadership.vicePresident || "—"}</p>
                              {coop.leadership.vicePresidentEmail && <p className="text-gray-500">{coop.leadership.vicePresidentEmail}</p>}
                              {coop.leadership.vicePresidentPhone && <p className="text-gray-500">{coop.leadership.vicePresidentPhone}</p>}
                            </div>
                            <div className="grid gap-2">
                              <p className="text-sm text-gray-500">Secretary</p>
                              <p className="font-medium text-gray-900">{coop.leadership.secretary || "Vacant"}</p>
                              {coop.leadership.secretaryEmail && <p className="text-gray-500">{coop.leadership.secretaryEmail}</p>}
                              {coop.leadership.secretaryPhone && <p className="text-gray-500">{coop.leadership.secretaryPhone}</p>}
                            </div>
                            <div className="grid gap-2 border-t border-gray-100 pt-4">
                              <p className="text-sm text-gray-500">Sector Cooperative Officer</p>
                              <p className="font-medium text-gray-900">{coop.leadership.sectorOfficer || "—"}</p>
                              {coop.leadership.sectorOfficerPhone && <p className="text-gray-500">{coop.leadership.sectorOfficerPhone}</p>}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-gray-200 p-6">
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900">Document access</h4>
                            <p className="text-sm text-gray-500">Secure metadata for cooperative bylaws, constitution, licenses and permits.</p>
                          </div>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Restricted view</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-gray-200 p-4">
                            <p className="text-sm text-gray-500">Bylaws</p>
                            <p className="font-medium text-gray-900">{coop.bylawsFileName || "Not uploaded"}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 p-4">
                            <p className="text-sm text-gray-500">Constitution</p>
                            <p className="font-medium text-gray-900">{coop.constitutionFileName || "Not uploaded"}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 p-4">
                            <p className="text-sm text-gray-500">Business license</p>
                            <p className="font-medium text-gray-900">{coop.licenseFileName || "Not uploaded"}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-200 p-4">
                            <p className="text-sm text-gray-500">Permits</p>
                            <p className="font-medium text-gray-900">{coop.permitsFileName || "Not uploaded"}</p>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mt-4">Document files are stored securely; this view shows metadata only.</p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
