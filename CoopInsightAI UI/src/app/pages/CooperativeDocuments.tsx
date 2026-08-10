import { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { FileText, Upload, Download, FolderOpen, Trash2 } from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

interface CooperativeDocument {
  id: string;
  name: string;
  type: string;
  file_url?: string;
  uploaded_at: string;
  uploaded_by_name?: string;
}

export function CooperativeDocuments() {
  const { user } = useAuth();
  const cooperativeId = user?.cooperativeId ?? "";

  const [documents, setDocuments] = useState<CooperativeDocument[]>([]);
  const [cooperativeName, setCooperativeName] = useState<string>("");
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // Upload form state
  const [newDocType, setNewDocType] = useState("Other");
  const [newDocName, setNewDocName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch documents ─────────────────────────────────────────────────────────
  const fetchDocuments = async () => {
    if (!cooperativeId) return;
    setIsLoadingDocs(true);
    setFetchError("");
    try {
      const data = await api.get<{ documents: CooperativeDocument[]; cooperativeName?: string }>(
        `/cooperatives/${cooperativeId}/documents`
      );
      setDocuments(data.documents ?? []);
      if (data.cooperativeName) setCooperativeName(data.cooperativeName);
    } catch (err: any) {
      setFetchError(err.message ?? "Failed to load documents.");
    } finally {
      setIsLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [cooperativeId]);

  // ── Handle file selection ───────────────────────────────────────────────────
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !newDocName) setNewDocName(file.name);
  };

  // ── Upload document ─────────────────────────────────────────────────────────
  const handleAddDocument = async () => {
    if (!selectedFile || !newDocName || !cooperativeId) return;

    setIsUploading(true);
    setUploadError("");

    const token = localStorage.getItem("coopinsight_access_token");
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("name", newDocName);
    formData.append("type", newDocType);

    try {
      const res = await fetch(`${BASE_URL}/cooperatives/${cooperativeId}/documents`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.message ?? "Upload failed. Please try again.");
      } else {
        // Refresh list
        await fetchDocuments();
        setNewDocName("");
        setSelectedFile(null);
        setNewDocType("Other");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch {
      setUploadError("Network error. Please check your connection and try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // ── Delete document ─────────────────────────────────────────────────────────
  const handleDeleteDocument = async (docId: string) => {
    if (!cooperativeId) return;
    setDeletingId(docId);
    try {
      await api.delete(`/cooperatives/${cooperativeId}/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      alert(err.message ?? "Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
  };

  // ── No cooperative assigned ─────────────────────────────────────────────────
  if (!cooperativeId) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold">Cooperative Documents</h1>
          <p className="mt-4 text-gray-600">No cooperative is associated with your account.</p>
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
        {cooperativeName && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Cooperative</p>
            <p className="text-lg font-semibold text-gray-900">{cooperativeName}</p>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{fetchError}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <div className="space-y-6">
          {/* ── Document list ── */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <FileText className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Document repository</h2>
            </div>

            {isLoadingDocs ? (
              <p className="text-sm text-gray-500">Loading documents...</p>
            ) : (
              <div className="space-y-4">
                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{document.name}</p>
                      <p className="text-sm text-gray-500">
                        {document.type} • Uploaded{" "}
                        {new Date(document.uploaded_at).toLocaleDateString()}
                        {document.uploaded_by_name ? ` by ${document.uploaded_by_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {document.file_url && (
                        <>
                          <a
                            href={document.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            View
                          </a>
                          <a
                            href={document.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm text-white hover:bg-[#1d4ed8] transition-colors"
                          >
                            <FolderOpen className="w-4 h-4" />
                            Open
                          </a>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteDocument(document.id)}
                        disabled={deletingId === document.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        {deletingId === document.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
                {documents.length === 0 && !isLoadingDocs && (
                  <p className="text-sm text-gray-500">
                    No documents uploaded yet. Use the upload form to add bylaws, licenses, and permits.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* ── Upload form ── */}
          <Card className="p-6 border-dashed border border-gray-200 bg-white">
            <div className="flex items-center gap-3 mb-4">
              <Upload className="w-5 h-5 text-[#2563EB]" />
              <h2 className="text-lg font-semibold text-gray-900">Upload new document</h2>
            </div>

            {uploadError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{uploadError}</p>
              </div>
            )}

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
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileChange}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm text-gray-500">Selected file: {selectedFile.name}</p>
                )}
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
              <Button
                onClick={handleAddDocument}
                disabled={!newDocName || !selectedFile || isUploading}
              >
                {isUploading ? "Uploading..." : "Add document"}
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Quick access panel ── */}
        <Card className="p-6 bg-white">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-[#2563EB]" />
            <h2 className="text-lg font-semibold text-gray-900">Quick access</h2>
          </div>
          <div className="space-y-4">
            {["Bylaws", "License", "Permit"].map((docType) => {
              const match = documents.find(
                (d) => d.type.toLowerCase() === docType.toLowerCase()
              );
              return (
                <div key={docType} className="rounded-2xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">{docType}</p>
                  {match ? (
                    match.file_url ? (
                      <a
                        href={match.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-base font-medium text-[#2563EB] hover:underline"
                      >
                        {match.name}
                      </a>
                    ) : (
                      <p className="text-base font-medium text-gray-900">{match.name}</p>
                    )
                  ) : (
                    <p className="text-base font-medium text-gray-400 italic">Not uploaded</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
