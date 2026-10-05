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
  description?: string;
  url?: string | null;
  file_url?: string;
  /** False when the register entry exists but its original was never uploaded. */
  has_file?: boolean;
  uploaded_at: string;
  uploaded_by_name?: string;
  cooperative_id?: string;
  cooperative_name?: string;
  sector?: string;
}

/** A grouping of raw document types, as the backend defines them. */
interface DocumentCategory {
  id: string;
  label: string;
  description: string;
  types: string[];
  count: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DOCUMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This page was bound to `user.cooperativeId`, which meant it showed an officer
 * nothing at all — sector, district and RCA officers are not attached to a
 * cooperative, which is precisely why they need to see across several.
 *
 * It now reads `/cooperatives/documents/all`, which scopes itself the way
 * everything else does: a manager or member sees their own cooperative, a
 * sector officer sees their sector, the district office and the RCA see the
 * district. Documents are grouped into the categories an officer actually asks
 * for — the constituting documents, the books, the minutes, the returns —
 * rather than the six raw type values the column happens to store.
 */
export function CooperativeDocuments() {
  const { user } = useAuth();
  const cooperativeId = user?.cooperativeId ?? "";
  const canUpload = Boolean(cooperativeId) && ["manager", "cooperative", "admin", "generalManager"].includes(user?.role ?? "");

  const [documents, setDocuments] = useState<CooperativeDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<string>("cooperative");
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
    setIsLoadingDocs(true);
    setFetchError("");
    try {
      const data = await api.get<{
        data: CooperativeDocument[];
        categories: DocumentCategory[];
        scope: string;
      }>("/cooperatives/documents/all");
      setDocuments(data.data ?? []);
      setCategories(data.categories ?? []);
      setScope(data.scope ?? "cooperative");
      if (user?.cooperativeName) setCooperativeName(user.cooperativeName);
    } catch (err: any) {
      setFetchError(err.message ?? "Failed to load documents.");
    } finally {
      setIsLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [cooperativeId]);

  /** Which category a raw type belongs to. */
  const categoryOf = (type: string) =>
    categories.find((c) => c.types.includes(type)) ?? categories.find((c) => c.id === "other");

  const visibleDocuments = documents.filter((d) => {
    if (activeCategory !== "All" && categoryOf(d.type)?.id !== activeCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        d.name.toLowerCase().includes(q) ||
        (d.cooperative_name ?? "").toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  /** Grouped for display, so one cooperative's file reads as one block. */
  const byCooperative = visibleDocuments.reduce<Record<string, CooperativeDocument[]>>((acc, d) => {
    const key = d.cooperative_name ?? cooperativeName ?? "Your cooperative";
    (acc[key] ??= []).push(d);
    return acc;
  }, {});

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

  // ── Open / download a document ──────────────────────────────────────────────
  // Files are served through an access-checked route, which needs the login
  // token — a plain link cannot send it. The file is fetched and handed to the
  // browser, so "View" opens it in a tab and "Download" saves it.
  const [fileError, setFileError] = useState("");
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<CooperativeDocument | null>(null);

  const openDocument = async (doc: CooperativeDocument, download: boolean) => {
    setFileError("");
    const coopId = doc.cooperative_id ?? cooperativeId;
    // Open the tab first, synchronously, so the browser does not block it.
    const tab = download ? null : window.open("", "_blank");
    try {
      const token = localStorage.getItem("coopinsight_access_token");
      const res = await fetch(
        `${BASE_URL}/cooperatives/${coopId}/documents/${doc.id}/file${download ? "?download=1" : ""}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "The document could not be opened.");
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      if (download) {
        const a = window.document.createElement("a");
        a.href = blobUrl;
        a.download = doc.name;
        a.click();
      } else if (tab) {
        tab.location.href = blobUrl;
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: any) {
      tab?.close();
      setFileError(err?.message ?? "The document could not be opened.");
    }
  };

  /** Attach the original to a register entry that has none yet. */
  const attachFile = async (file: File) => {
    const doc = attachTarget.current;
    if (!doc || !cooperativeId) return;
    setAttachingId(doc.id);
    setFileError("");
    try {
      const token = localStorage.getItem("coopinsight_access_token");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/cooperatives/${cooperativeId}/documents/${doc.id}/file`, {
        method: "PUT",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Could not attach the file.");
      await fetchDocuments();
    } catch (err: any) {
      setFileError(err?.message ?? "Could not attach the file.");
    } finally {
      setAttachingId(null);
      if (attachInputRef.current) attachInputRef.current.value = "";
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

  // An officer has no cooperative of their own — that is normal, and is the
  // whole reason they need a view across several. Only an account that is
  // neither attached to a cooperative nor an officer has nothing to see.
  const isOfficer = ["admin", "generalManager", "government"].includes(user?.role ?? "");
  if (!cooperativeId && !isOfficer) {
    return (
      <div className="max-w-6xl mx-auto py-10">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold">Cooperative Documents</h1>
          <p className="mt-4 text-gray-600">
            Your account is not attached to a cooperative at the moment — usually because a request to
            leave was approved. Your own savings, loans and activity are still on{" "}
            <a href="/members/me" className="font-medium text-[#2D6A4F] underline">My Record</a>. If you
            did not ask to leave, your cooperative manager can reverse the exit from the Membership page.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cooperative Documents</h1>
          <p className="text-gray-600 mt-1">
            {scope === "district"
              ? "Every document held by the cooperatives in the district, grouped by what it is."
              : scope === "sector"
                ? "Documents held by the cooperatives in your sector, grouped by what they are."
                : "The bylaws, accounts, minutes and returns your cooperative keeps on file."}
          </p>
        </div>
        {cooperativeName && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Cooperative</p>
            <p className="text-lg font-semibold text-gray-900">{cooperativeName}</p>
          </div>
        )}
      </div>

      <input
        ref={attachInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) attachFile(file);
        }}
      />
      {fileError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{fileError}</div>
      )}
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
              <FileText className="w-5 h-5 text-[#2D6A4F]" />
              <h2 className="text-lg font-semibold text-gray-900">Document repository</h2>
              <span className="text-sm text-gray-500">
                {visibleDocuments.length} of {documents.length}
              </span>
            </div>

            {/*
              The categories an officer actually asks for. Each chip carries its
              own count, so an empty category is visibly empty rather than
              simply missing from the page.
            */}
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory("All")}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  activeCategory === "All"
                    ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                All ({documents.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  title={c.description}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    activeCategory === c.id
                      ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {c.label} ({c.count})
                </button>
              ))}
            </div>

            {activeCategory !== "All" && (
              <p className="mb-4 text-sm text-gray-600">
                {categories.find((c) => c.id === activeCategory)?.description}
              </p>
            )}

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by document or cooperative name…"
              className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
            />

            {isLoadingDocs ? (
              <p className="text-sm text-gray-500">Loading documents...</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(byCooperative).map(([coopName, docs]) => (
                  <div key={coopName}>
                    {/* An officer looking across cooperatives needs to know
                        whose file each document belongs to. */}
                    {scope !== "cooperative" && (
                      <p className="mb-2 text-sm font-semibold text-gray-900">
                        {coopName}
                        <span className="ml-2 font-normal text-gray-500">
                          {docs.length} document{docs.length === 1 ? "" : "s"}
                        </span>
                      </p>
                    )}
                    <div className="space-y-3">
                {docs.map((document) => (
                  <div
                    key={document.id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{document.name}</p>
                        <span className="rounded-full bg-[#2D6A4F]/10 px-2 py-0.5 text-[11px] font-medium text-[#2D6A4F]">
                          {categoryOf(document.type)?.label ?? document.type}
                        </span>
                      </div>
                      {document.description && (
                        <p className="mt-0.5 text-sm text-gray-600">{document.description}</p>
                      )}
                      <p className="text-xs text-gray-500">
                        Uploaded {new Date(document.uploaded_at).toLocaleDateString()}
                        {document.uploaded_by_name ? ` by ${document.uploaded_by_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {document.has_file !== false ? (
                        <>
                          <button
                            onClick={() => openDocument(document, false)}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#2D6A4F] px-4 py-2 text-sm text-white hover:bg-[#1B5E20] transition-colors"
                          >
                            <FolderOpen className="w-4 h-4" />
                            View
                          </button>
                          <button
                            onClick={() => openDocument(document, true)}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
                            title="The entry is on the register, but the original file has not been uploaded."
                          >
                            File not uploaded yet
                          </span>
                          {canUpload && document.cooperative_id === cooperativeId && (
                            <button
                              onClick={() => {
                                attachTarget.current = document;
                                attachInputRef.current?.click();
                              }}
                              disabled={attachingId === document.id}
                              className="inline-flex items-center gap-2 rounded-lg border border-[#2D6A4F] px-4 py-2 text-sm text-[#2D6A4F] hover:bg-[#2D6A4F]/5 disabled:opacity-50"
                            >
                              <Upload className="w-4 h-4" />
                              {attachingId === document.id ? "Attaching…" : "Attach file"}
                            </button>
                          )}
                        </>
                      )}
                      {/* Only the cooperative that owns a document may remove
                          it; an officer supervising it may not. */}
                      {canUpload && document.cooperative_id === cooperativeId && (
                      <button
                        onClick={() => handleDeleteDocument(document.id)}
                        disabled={deletingId === document.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        {deletingId === document.id ? "Deleting..." : "Delete"}
                      </button>
                      )}
                    </div>
                  </div>
                ))}
                    </div>
                  </div>
                ))}
                {visibleDocuments.length === 0 && !isLoadingDocs && (
                  <p className="text-sm text-gray-500">
                    {documents.length === 0
                      ? "No documents on file yet."
                      : "Nothing in this category matches your search."}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* ── Upload form ──
              Only a cooperative can add to its own file. An officer supervises
              documents; they do not file them on the cooperative's behalf. */}
          {canUpload && (
          <Card className="p-6 border-dashed border border-gray-200 bg-white">
            <div className="flex items-center gap-3 mb-4">
              <Upload className="w-5 h-5 text-[#2D6A4F]" />
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
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
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
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
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
                  className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-[#2D6A4F]"
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
          )}
        </div>

        {/* ── Quick access panel ── */}
        <Card className="p-6 bg-white">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-[#2D6A4F]" />
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
                        className="text-base font-medium text-[#2D6A4F] hover:underline"
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
