import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { FileText, Upload, Download, FolderOpen } from "lucide-react";

interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

interface CooperativeProfileData {
  id: string;
  name: string;
  documents: CooperativeDocument[];
  bylawsFileName: string;
  licenseFileName: string;
  permitsFileName: string;
}

const defaultProfiles: CooperativeProfileData[] = [
  {
    id: "coop-1",
    name: "Green Valley Farmers",
    bylawsFileName: "GreenValley_Bylaws.pdf",
    licenseFileName: "GreenValley_BusinessLicense.pdf",
    permitsFileName: "GreenValley_OperatingPermit.pdf",
    documents: [
      { id: "doc-1", name: "Cooperative Bylaws", type: "Bylaws", uploadedAt: "2024-02-11" },
      { id: "doc-2", name: "Business License", type: "License", uploadedAt: "2024-02-12" },
      { id: "doc-3", name: "Market Permit", type: "Permit", uploadedAt: "2024-02-13" },
    ],
  },
];

function getStoredCooperatives() {
  try {
    const stored = localStorage.getItem("coopinsight_cooperatives");
    return stored ? (JSON.parse(stored) as CooperativeProfileData[]) : defaultProfiles;
  } catch {
    return defaultProfiles;
  }
}

function saveStoredCooperatives(cooperatives: CooperativeProfileData[]) {
  localStorage.setItem("coopinsight_cooperatives", JSON.stringify(cooperatives));
}

export function CooperativeDocuments() {
  const { user } = useAuth();
  const [cooperative, setCooperative] = useState<CooperativeProfileData | null>(null);
  const [newDocType, setNewDocType] = useState("Other");
  const [newDocName, setNewDocName] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

  useEffect(() => {
    const allCoops = getStoredCooperatives();
    const selected = user?.cooperativeId ? allCoops.find((coop) => coop.id === user.cooperativeId) : allCoops[0];
    if (selected) {
      setCooperative(selected);
    }
  }, [user]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFileName(file.name);
      setNewDocName(file.name);
    }
  };

  const handleAddDocument = () => {
    if (!newDocName || !cooperative) return;
    const updated = {
      ...cooperative,
      documents: [
        ...cooperative.documents,
        {
          id: `doc-${Date.now()}`,
          name: newDocName,
          type: newDocType,
          uploadedAt: new Date().toLocaleDateString(),
        },
      ],
    };

    const allCoops = getStoredCooperatives().map((coop) => (coop.id === updated.id ? updated : coop));
    saveStoredCooperatives(allCoops);
    setCooperative(updated);
    setNewDocName("");
    setSelectedFileName("");
  };

  if (!cooperative) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold">Cooperative Documents</h1>
          <p className="mt-4 text-gray-600">No cooperative document repository is available yet.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cooperative Documents</h1>
          <p className="text-gray-600 mt-1">Browse bylaws, licenses, permits, and uploaded cooperative files.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Cooperative</p>
          <p className="text-lg font-semibold text-gray-900">{cooperative.name}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <FileText className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Document repository</h2>
            </div>
            <div className="space-y-4">
              {cooperative.documents.map((document) => (
                <div key={document.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{document.name}</p>
                    <p className="text-sm text-gray-500">{document.type} • Uploaded {document.uploadedAt}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white transition-colors">
                      <Download className="w-4 h-4" />
                      View
                    </button>
                    <button className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm text-white hover:bg-[#1d4ed8] transition-colors">
                      <FolderOpen className="w-4 h-4" />
                      Open
                    </button>
                  </div>
                </div>
              ))}
              {cooperative.documents.length === 0 && (
                <p className="text-sm text-gray-500">No documents uploaded yet. Use the upload form to add bylaws, licenses, and permits.</p>
              )}
            </div>
          </Card>

          <Card className="p-6 border-dashed border border-gray-200 bg-white">
            <div className="flex items-center gap-3 mb-4">
              <Upload className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Upload new document</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Document Type</label>
                <select
                  value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  <option value="Bylaws">Bylaws</option>
                  <option value="License">License</option>
                  <option value="Permit">Permit</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Choose file</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileChange}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                {selectedFileName && <p className="mt-2 text-sm text-gray-500">Selected file: {selectedFileName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Document label</label>
                <input
                  type="text"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="Enter a document title"
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <Button onClick={handleAddDocument} disabled={!newDocName}>
                Add document
              </Button>
            </div>
          </Card>
        </div>

        <Card className="p-6 bg-white">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-[#2563EB]" />
            <h2 className="text-lg font-semibold text-gray-900">Quick access</h2>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Bylaws</p>
              <p className="text-base font-medium text-gray-900">{cooperative.bylawsFileName}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Business license</p>
              <p className="text-base font-medium text-gray-900">{cooperative.licenseFileName}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">Operating permits</p>
              <p className="text-base font-medium text-gray-900">{cooperative.permitsFileName}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
