import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useSearchParams, useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import {
  Building2,
  MapPin,
  Users,
  CheckCircle,
  Save,
  FileText,
  Briefcase,
  Download,
  Plus,
  X,
} from "lucide-react";

interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  size?: string;
}

interface CooperativeProfileData {
  id: string;
  name: string;
  registrationNumber: string;
  district: string;
  sector: string;
  type: string;
  chairperson: string;
  chairpersonEmail?: string;
  chairpersonPhone?: string;
  treasurer: string;
  treasurerEmail?: string;
  treasurerPhone?: string;
  secretary: string;
  secretaryEmail?: string;
  secretaryPhone?: string;
  registrationDate: string;
  status: string;
  bylawsFileName: string;
  licenseFileName: string;
  permitsFileName: string;
  constitutionFileName?: string;
  operatingArea: string;
  membershipSize: string;
  description: string;
  documents: CooperativeDocument[];
}

const defaultProfiles: CooperativeProfileData[] = [
  {
    id: "coop-1",
    name: "Green Valley Farmers",
    registrationNumber: "RWA-2024-001",
    district: "Gasabo District",
    sector: "Agriculture",
    type: "Savings & Credit",
    chairperson: "David Mugisha",
    chairpersonEmail: "david.mugisha@greenvalley.coop",
    chairpersonPhone: "+250788234567",
    treasurer: "Sarah Johnson",
    treasurerEmail: "sarah.johnson@greenvalley.coop",
    treasurerPhone: "+250788456789",
    secretary: "Aline Uwase",
    secretaryEmail: "aline.uwase@greenvalley.coop",
    secretaryPhone: "+250788567890",
    registrationDate: "2024-02-10",
    status: "Active",
    bylawsFileName: "GreenValley_Bylaws.pdf",
    licenseFileName: "GreenValley_BusinessLicense.pdf",
    permitsFileName: "GreenValley_OperatingPermit.pdf",
    constitutionFileName: "GreenValley_Constitution.pdf",
    operatingArea: "Gasabo District",
    membershipSize: "320",
    description: "A cooperative supporting smallholder farmers with production, savings, and market access.",
    documents: [
      { id: "doc-1", name: "Cooperative Bylaws", type: "Bylaws", uploadedAt: "2024-02-11", size: "245 KB" },
      { id: "doc-2", name: "Business License", type: "License", uploadedAt: "2024-02-12", size: "123 KB" },
      { id: "doc-3", name: "Market Permit", type: "Permit", uploadedAt: "2024-02-13", size: "98 KB" },
      { id: "doc-4", name: "Constitution", type: "Constitution", uploadedAt: "2024-02-11", size: "456 KB" },
    ],
  },
];

function getStoredCooperatives() {
  try {
    const stored = localStorage.getItem("coopinsight_cooperatives");
    return stored ? (JSON.parse(stored) as CooperativeProfileData[]) : defaultProfiles;
  } catch (error) {
    return defaultProfiles;
  }
}

function saveStoredCooperatives(cooperatives: CooperativeProfileData[]) {
  localStorage.setItem("coopinsight_cooperatives", JSON.stringify(cooperatives));
}

export function CooperativeProfile() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryId = searchParams.get("id");
  const [cooperative, setCooperative] = useState<CooperativeProfileData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [formData, setFormData] = useState<CooperativeProfileData | null>(null);
  const [newDocument, setNewDocument] = useState({
    name: "",
    type: "Bylaws" as string,
    file: null as File | null,
  });

  useEffect(() => {
    const allCoops = getStoredCooperatives();
    let selected: CooperativeProfileData | undefined;
    if (queryId) {
      selected = allCoops.find((c) => c.id === queryId);
    } else if (user?.cooperativeId) {
      selected = allCoops.find((c) => c.id === user.cooperativeId);
    }
    if (!selected) selected = allCoops[0];
    if (selected) {
      setCooperative(selected);
      setFormData(selected);
    }
  }, [user, queryId]);

  const canEdit = user?.role === "manager" || user?.role === "admin";

  const handleSave = () => {
    if (!formData) return;
    const allCoops = getStoredCooperatives();
    const updated = allCoops.map((coop) => (coop.id === formData.id ? formData : coop));
    saveStoredCooperatives(updated);
    setCooperative(formData);
    setIsEditing(false);
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData || !newDocument.name) return;

    const updatedDoc: CooperativeDocument = {
      id: `doc-${Date.now()}`,
      name: newDocument.name,
      type: newDocument.type,
      uploadedAt: new Date().toLocaleDateString(),
      size: "0 KB",
    };

    setFormData({
      ...formData,
      documents: [...formData.documents, updatedDoc],
    });

    setNewDocument({ name: "", type: "Bylaws", file: null });
    setShowDocumentForm(false);
  };

  const handleRemoveDocument = (docId: string) => {
    if (!formData) return;
    setFormData({
      ...formData,
      documents: formData.documents.filter((doc) => doc.id !== docId),
    });
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
Chairperson: ${cooperative.chairperson}
Email: ${cooperative.chairpersonEmail || "N/A"}
Phone: ${cooperative.chairpersonPhone || "N/A"}

Treasurer: ${cooperative.treasurer}
Email: ${cooperative.treasurerEmail || "N/A"}
Phone: ${cooperative.treasurerPhone || "N/A"}

Secretary: ${cooperative.secretary}
Email: ${cooperative.secretaryEmail || "N/A"}
Phone: ${cooperative.secretaryPhone || "N/A"}

DOCUMENTS (${cooperative.documents.length})
${cooperative.documents.map((doc) => `- ${doc.name} (${doc.type}) - ${doc.uploadedAt} - ${doc.size || "0 KB"}`).join("\n")}

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

  if (!cooperative || !formData) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold">Cooperative Profile</h1>
          <p className="mt-4 text-gray-600">No cooperative profile available for your account yet.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      {queryId && (
        <button onClick={() => navigate("/cooperatives")} className="flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8] text-sm font-medium">
          ← Back to Cooperatives
        </button>
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
            <Button variant="secondary" onClick={() => setIsEditing(!isEditing)}>
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
                <p className="text-xs text-gray-500">Chairperson</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.chairperson}
                    onChange={(e) => setFormData({ ...formData, chairperson: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.chairperson}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Treasurer</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.treasurer}
                    onChange={(e) => setFormData({ ...formData, treasurer: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.treasurer}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-gray-500">Secretary</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.secretary}
                    onChange={(e) => setFormData({ ...formData, secretary: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB] mt-1"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{formData.secretary}</p>
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
              {canEdit && isEditing && (
                <Button
                  className="!px-2 !py-1 text-sm"
                  variant="secondary"
                  onClick={() => setShowDocumentForm(!showDocumentForm)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Document
                </Button>
              )}
            </div>

            {showDocumentForm && (
              <form onSubmit={handleAddDocument} className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
                    <input
                      type="text"
                      value={newDocument.name}
                      onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                      placeholder="e.g., Financial Report 2024"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                    <select
                      value={newDocument.type}
                      onChange={(e) => setNewDocument({ ...newDocument, type: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-[#2563EB]"
                    >
                      <option>Bylaws</option>
                      <option>Constitution</option>
                      <option>License</option>
                      <option>Permit</option>
                      <option>Financial Report</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" className="!px-2 !py-1 text-sm">
                      Add Document
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-2 !py-1 text-sm"
                      onClick={() => setShowDocumentForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </form>
            )}

            <div className="space-y-2">
              {formData.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{doc.name}</p>
                      <p className="text-xs text-gray-500">
                        {doc.type} • {doc.uploadedAt} • {doc.size}
                      </p>
                    </div>
                  </div>
                  {canEdit && isEditing && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDocument(doc.id)}
                      className="text-red-600 hover:text-red-700 p-2"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isEditing && (
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
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
        </div>
      </Card>
    </div>
  );
}
