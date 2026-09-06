import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { SMSPanel } from "../components/SMSPanel";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
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
  composition: "Male" | "Female" | "Mixed";
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
    district: raw.address ?? "Gasabo District",
    type: raw.type ?? "",
    registrationNumber: raw.registration_number ?? "",
    registrationDate: raw.registration_date ? String(raw.registration_date).slice(0, 10) : "",
    status: raw.status ?? "Active",
    operatingArea: raw.address ?? "",
    membershipSize: String(membershipSize ?? raw.member_count ?? 0),
    composition,
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

export function Cooperatives() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cooperatives, setCooperatives] = useState<Cooperative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCooperatives = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<any>("/cooperatives?page=1&limit=100");
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
    fetchCooperatives();
  }, []);

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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Operating Area</label>
                <input
                  type="text"
                  value={formData.operatingArea}
                  onChange={(e) => setFormData({ ...formData, operatingArea: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">President Email</label>
                <input
                  type="email"
                  value={formData.presidentEmail}
                  onChange={(e) => setFormData({ ...formData, presidentEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">President Phone</label>
                <input
                  type="tel"
                  value={formData.presidentPhone}
                  onChange={(e) => setFormData({ ...formData, presidentPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vice President Email</label>
                <input
                  type="email"
                  value={formData.vicePresidentEmail}
                  onChange={(e) => setFormData({ ...formData, vicePresidentEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vice President Phone</label>
                <input
                  type="tel"
                  value={formData.vicePresidentPhone}
                  onChange={(e) => setFormData({ ...formData, vicePresidentPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secretary Email</label>
                <input
                  type="email"
                  value={formData.secretaryEmail}
                  onChange={(e) => setFormData({ ...formData, secretaryEmail: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Secretary Phone</label>
                <input
                  type="tel"
                  value={formData.secretaryPhone}
                  onChange={(e) => setFormData({ ...formData, secretaryPhone: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
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

      {/* Loading / Error States */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          Loading cooperatives...
        </div>
      )}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-red-600">{error}</p>
          <Button variant="secondary" onClick={fetchCooperatives}>Retry</Button>
        </div>
      )}

      {/* Cooperatives List with Expandable Details */}
      {!loading && !error && (
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
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-lg mb-1">{coop.name}</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {coop.membershipSize} members
                        </span>
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
