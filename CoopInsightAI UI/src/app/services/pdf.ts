/**
 * Downloads as PDF documents.
 *
 * Every page that lets the user take something away describes it — a title,
 * headline figures, tables — and the backend renders it in the same house style
 * as the formal reports: the cooperative's letterhead, who produced it, page
 * numbers. Pages used to build .txt and .csv files in the browser, each its own
 * way; nothing that could be printed and handed to a general assembly.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export type PdfCell = string | number | null | undefined;

export interface PdfSection {
  title: string;
  note?: string;
  paragraphs?: string[];
  facts?: Array<{ label: string; value: string }>;
  columns?: string[];
  rows?: PdfCell[][];
  totals?: PdfCell[];
}

export interface PdfSpec {
  title: string;
  subtitle?: string;
  /** For someone who supervises several cooperatives: whose letterhead to use. */
  cooperativeId?: string | null;
  narrative?: string[];
  summary?: Array<{ label: string; value: string }>;
  sections?: PdfSection[];
  signatories?: string[];
}

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("coopinsight_access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Hands a file to the browser as a download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const slug = (title: string) =>
  title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "document";

/** The file name the server suggested, if it sent one. */
function serverFileName(res: Response): string | null {
  const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
  return match?.[1] ?? null;
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.message ?? fallback);
}

/** Renders a described document as a PDF and downloads it. */
export async function downloadPdf(spec: PdfSpec): Promise<void> {
  const res = await fetch(`${BASE_URL}/exports/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw await failure(res, "The PDF could not be produced.");
  saveBlob(await res.blob(), serverFileName(res) ?? `${slug(spec.title)}.pdf`);
}

/** Downloads a file from an authenticated API path (a stored report, say). */
export async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await failure(res, "The file could not be downloaded.");
  saveBlob(await res.blob(), serverFileName(res) ?? fallbackName);
}

/**
 * Opens the browser's print dialog on a PDF, without saving it first.
 *
 * Printing the page itself would print the app around the report — sidebar,
 * buttons, a scrolled table cut off at the fold. The PDF is the document, so
 * that is what goes to the printer: loaded into a hidden frame and printed
 * from there, with the same letterhead, reference and page numbers as the
 * download.
 */
export function printBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (err) {
        // Some browsers will not script a PDF frame; open it so the user can print.
        window.open(url, "_blank");
        reject(err);
      }
      // Leave the frame long enough for the print dialog to take its copy.
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    document.body.appendChild(frame);
  });
}

/** Renders a described document as a PDF and opens the print dialog on it. */
export async function printPdf(spec: PdfSpec): Promise<void> {
  const res = await fetch(`${BASE_URL}/exports/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw await failure(res, "The document could not be prepared for printing.");
  await printBlob(await res.blob());
}

/** Prints a PDF served from an authenticated API path. */
export async function printFromApi(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await failure(res, "The document could not be prepared for printing.");
  await printBlob(await res.blob());
}

export const rwf = (v: unknown) => `RWF ${Math.round(Number(v ?? 0)).toLocaleString("en-US")}`;
