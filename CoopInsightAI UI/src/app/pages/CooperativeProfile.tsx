import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useParams, useSearchParams, useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { api } from "../services/api";
import {
  Building2,
  MapPin,
  Users,
  CheckCircle,
  Save,
  FileText,
  Briefcase,
  Download,
} from "lucide-react";

interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  file_url?: string;
  uploaded_at: string;
}

interface LeadershipRecord {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
}

interface CooperativeProfileData {
  id: string;
  name: string;
  registrationNumber: string;
  district: string;
  sector: string;
  type: string;
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
  registrationDate: string;
  status: string;
  operatingArea: string;
  membershipSize: string;
  description: string;
  leadershipRaw: LeadershipRecord[];
}

interface HealthScore {
  score: number;
  breakdown: Record<string, number>;
  trend: "up" | "down" | "stable";
}

// Roles are matched exactly so "Vice President" is never mistaken for "President".
const findLeader = (leadership: any[], role: string) =>
  leadership.find((l: any) => l.role?.trim().toLowerCase() === role);

const mapApiCooperative = (raw: any): CooperativeProfileData => {
  const leadership: any[] = raw.leadership ?? [];
  const president = findLeader(leadership, "president");
  const vicePresident = findLeader(leadership, "vice president");
  const secretary = findLeader(leadership, "secretary");
  const sectorOfficer = findLeader(leadership, "sector cooperative officer");
  return {
    id: raw.id,
    name: raw.name ?? "",
    registrationNumber: raw.registration_number ?? raw.registrationNumber ?? "",
    district: raw.district ?? raw.cell ?? "",
    sector: raw.sector ?? "",
    type: raw.type ?? "",
    status: raw.status ?? "",
    registrationDate: raw.registration_date ?? raw.registrationDate ?? "",
    description: raw.description ?? "",
    operatingArea: [raw.cell, raw.village].filter(Boolean).join(", ") || raw.sector || "",
    membershipSize: String(raw.member_count ?? raw.membershipSize ?? "0"),
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
    leadershipRaw: leadership,
  };
};

// The three cooperative offices the RCA register records. The sector cooperative
// officer is shown read-only — they are a district appointee, not an office of
// the cooperative, so they are not editable from this page.
const LEADERSHIP_ROLES: Array<{
  matchTerm: string;
  roleLabel: string;
  nameKey: keyof CooperativeProfileData;
  emailKey: keyof CooperativeProfileData;
  phoneKey: keyof CooperativeProfileData;
}> = [
  { matchTerm: "president", roleLabel: "President", nameKey: "president", emailKey: "presidentEmail", phoneKey: "presidentPhone" },
  { matchTerm: "vice president", roleLabel: "Vice President", nameKey: "vicePresident", emailKey: "vicePresidentEmail", phoneKey: "vicePresidentPhone" },
  { matchTerm: "secretary", roleLabel: "Secretary", nameKey: "secretary", emailKey: "secretaryEmail", phoneKey: "secretaryPhone" },
];

export function CooperativeProfile() {
  const { user } = useAuth();
  const { id: paramId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Resolve cooperative id: URL param > query string > user's own cooperative
  const queryId = searchParams.get("id");
  const cooperativeId = paramId || queryId || user?.cooperativeId || null;
  const comingFromList = !!(paramId || queryId);

  const [cooperative, setCooperative] = useState<CooperativeProfileData | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<CooperativeProfileData | null>(null);
  const [documents, setDocuments] = useState<CooperativeDocument[]>([]);

  const fetchCooperative = async () => {
    if (!cooperativeId) return;
    setLoading(true);
    setError(null);
    try {
      const [coopRes, healthRes, docsRes] = await Promise.allSettled([
        api.get<{ cooperative: CooperativeProfileData } | CooperativeProfileData>(`/cooperatives/${cooperativeId}`),
        api.get<HealthScore>(`/cooperatives/${cooperativeId}/health-score`),
        api.get<{ data: CooperativeDocument[] } | CooperativeDocument[]>(`/cooperatives/${cooperativeId}/documents`),
      ]);

      if (coopRes.status === "fulfilled") {
        // Backend returns { success, data: {...} } with snake_case DB columns
        const raw = (coopRes.value as any).data ?? (coopRes.value as any).cooperative ?? coopRes.value;
        const data = mapApiCooperative(raw);
        setCooperative(data);
        setFormData(data);
      } else {
        setError("Failed to load cooperative profile.");
      }

      if (healthRes.status === "fulfilled") {
        setHealthScore(healthRes.value as HealthScore);
      }
      // Health score failure is non-fatal — just leave it null

      if (docsRes.status === "fulfilled") {
        const raw = (docsRes.value as any).data ?? docsRes.value;
        setDocuments(Array.isArray(raw) ? raw : []);
      }
      // Document fetch failure is non-fatal — just leave the list empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCooperative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooperativeId]);

  const canEdit = user?.role === "manager" || user?.role === "admin";

  const handleSave = async () => {
    if (!formData || !cooperativeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Only send backend-allowed fields (strip UI-only and meta fields)
      const allowedPayload: Record<string, unknown> = {};
      const allowed = ["name", "type", "sector", "cell", "village", "description", "phone", "email", "address", "status"];
      for (const key of allowed) {
        if (formData[key as keyof CooperativeProfileData] !== undefined) {
          allowedPayload[key] = formData[key as keyof CooperativeProfileData];
        }
      }
      await api.put<{ data: CooperativeProfileData }>(`/cooperatives/${cooperativeId}`, allowedPayload);

      // Leadership lives in a separate table — create/update/delete each role independently.
      await Promise.all(
        LEADERSHIP_ROLES.map(async (role) => {
          const existing = findLeader(formData.leadershipRaw, role.matchTerm);
          const name = (formData[role.nameKey] as string)?.trim();
          const payload = {
            name,
            role: role.roleLabel,
            email: (formData[role.emailKey] as string) || undefined,
            phone: (formData[role.phoneKey] as string) || undefined,
          };

          if (existing && !name) {
            await api.delete(`/cooperatives/${cooperativeId}/leadership/${existing.id}`);
          } else if (existing && name) {
            await api.put(`/cooperatives/${cooperativeId}/leadership/${existing.id}`, payload);
          } else if (!existing && name) {
            await api.post(`/cooperatives/${cooperativeId}/leadership`, payload);
          }
        })
      );

      await fetchCooperative();
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleExportProfile = () => {
    if (!cooperative) return;

    const report = `
COOPERATIVE PROFILE EXPORT
Generated: ${new Date().toLocaleString()}

BASIC INFORMATION
Name: ${cooperative.name}
Registration Number: ${cooperative.registrationNumber}
Type: ${cooperative.type}
Status: ${cooperative.status}
Registration Date: ${cooperative.registrationDate}

LOCATION & OPERATIONS
District: ${cooperative.district}
Sector: ${cooperative.sector}
Operating Area: ${cooperative.operatingArea}
Membership Size: ${cooperative.membershipSize}

LEADERSHIP
President: ${cooperative.president || "Not recorded"}
Email: ${cooperative.presidentEmail || "N/A"}
Phone: ${cooperative.presidentPhone || "N/A"}

Vice President: ${cooperative.vicePresident || "Not recorded"}
Email: ${cooperative.vicePresidentEmail || "N/A"}
Phone: ${cooperative.vicePresidentPhone || "N/A"}

Secretary: ${cooperative.secretary || "Vacant / not recorded"}
Email: ${cooperative.secretaryEmail || "N/A"}
Phone: ${cooperative.secretaryPhone || "N/A"}

Sector Cooperative Officer: ${cooperative.sectorOfficer || "Not recorded"}
Phone: ${cooperative.sectorOfficerPhone || "N/A"}

DOCUMENTS (${documents.length})
${documents.map((doc) => `- ${doc.name} (${doc.type}) - ${new Date(doc.uploaded_at).toLocaleDateString()}`).join("\n")}

DESCRIPTION
${cooperative.description}
    `.trim();

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cooperative-profile-${cooperative.id}-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <p className="text-gray-500">Loading cooperative profile…</p>
        </Card>
      </div>
    );
  }

  if (error || !cooperative || !formData) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold">Cooperative Profile</h1>
          <p className="mt-4 text-gray-600">{error || "No cooperative profile available for your account yet."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      {comingFromList && (
        <button
          onClick={() => navigate("/cooperatives")}
          className="flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8] text-sm font-medium"
        >
          ← Back to Cooperatives
        </button>
      )}

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {saveError}
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{cooperative.name}</h1>
          <p className="text-gray-600 mt-1">Cooperative profile — {cooperative.type} · {cooperative.district}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleExportProfile}>
            <Download className="w-4 h-4 mr-2" />
            Export Profile
          </Button>
          {canEdit && (
            <Button variant="secondary" onClick={() => { setIsEditing(!isEditing); setSaveError(null); }}>
              {isEditing ? "Cancel" : "Edit Profile"}
            </Button>
          )}
        </div>
      </div>

      <Card className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="rounded-2xl bg-[#2563EB] p-3 text-white">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{cooperative.name}</h2>
                <p className="text-sm text-gray-500">
                  {cooperative.type} cooperative in {cooperative.district}
                </p>
              </div>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-gray-500">Registration Number</p>
                  <p className="font-medium text-gray-900">{cooperative.registrationNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Registration Date</p>
                  <p className="font-medium text-gray-900">{cooperative.registrationDate}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium text-gray-900">{cooperative.status}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Membership Size</p>
                  <p className="font-medium text-gray-900">{cooperative.membershipSize}</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="flex items-center gap-2 mb-4 text-gray-700">
                <MapPin className="w-4 h-4" />
                <span className="text-sm font-medium">Operating Area</span>
              </div>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.operatingArea}
                  onChange={(e) => setFormData({ ...formData, operatingArea: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              ) : (
                <p className="text-gray-900">{cooperative.operatingArea}</p>
              )}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="flex items-center gap-2 mb-4 text-gray-700">
                <Users className="w-4 h-4" />
                <span className="text-sm font-medium">Sector</span>
              </div>
              <p className="text-gray-900">{cooperative.sector}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center gap-2 mb-4 text-gray-700">
              <Briefcase className="w-4 h-4" />
              <span className="text-sm font-medium">Leadership Team</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-gray-500">President</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.president}
                    onChange={(e) => setFormData({ ...formData, president: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.president || "—"}</p>
                )}
                {!isEditing && formData.presidentPhone && (
                  <p className="text-xs text-gray-500 mt-0.5">{formData.presidentPhone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Vice President</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.vicePresident}
                    onChange={(e) => setFormData({ ...formData, vicePresident: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.vicePresident || "—"}</p>
                )}
                {!isEditing && formData.vicePresidentPhone && (
                  <p className="text-xs text-gray-500 mt-0.5">{formData.vicePresidentPhone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Secretary</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.secretary}
                    onChange={(e) => setFormData({ ...formData, secretary: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.secretary || "Vacant"}</p>
                )}
                {!isEditing && formData.secretaryPhone && (
                  <p className="text-xs text-gray-500 mt-0.5">{formData.secretaryPhone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Sector Cooperative Officer</p>
                <p className="font-medium text-gray-900">{formData.sectorOfficer || "—"}</p>
                {formData.sectorOfficerPhone && (
                  <p className="text-xs text-gray-500 mt-0.5">{formData.sectorOfficerPhone}</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-gray-700">
                <FileText className="w-4 h-4" />
                <span className="text-sm font-medium">Document Repository</span>
              </div>
              {canEdit && (
                <Button
                  className="!px-2 !py-1 text-sm"
                  variant="secondary"
                  onClick={() => navigate("/cooperative-documents")}
                >
                  Manage Documents
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      {doc.file_url ? (
                        <a
                          href={doc.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#2563EB] hover:underline truncate block"
                        >
                          {doc.name}
                        </a>
                      ) : (
                        <p className="font-medium text-gray-900 truncate">{doc.name}</p>
                      )}
                      <p className="text-xs text-gray-500">
                        {doc.type} • {new Date(doc.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <p className="text-sm text-gray-500">No documents uploaded yet.</p>
              )}
            </div>
          </div>

          {isEditing && (
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center justify-between gap-2 mb-5">
              <div>
                <p className="text-sm text-gray-500">Profile Status</p>
                <h2 className="text-xl font-semibold text-gray-900">Summary</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                <CheckCircle className="w-4 h-4" />
                {cooperative.status}
              </div>
            </div>
            <p className="text-gray-600 leading-7">{cooperative.description}</p>
          </div>

          {healthScore && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Health Score</h3>
              <div className="flex items-center gap-4 mb-4">
                <span className="text-4xl font-bold text-[#2563EB]">{healthScore.score}</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    healthScore.trend === "up"
                      ? "bg-green-100 text-green-800"
                      : healthScore.trend === "down"
                      ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {healthScore.trend === "up" ? "↑ Improving" : healthScore.trend === "down" ? "↓ Declining" : "→ Stable"}
                </span>
              </div>
              {healthScore.breakdown && Object.keys(healthScore.breakdown).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(healthScore.breakdown).map(([key, val]) => (
                    <div key={key}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="capitalize">{key.replace(/_/g, " ")}</span>
                        <span>{val}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div className="bg-[#2563EB] h-1.5 rounded-full" style={{ width: `${val}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
