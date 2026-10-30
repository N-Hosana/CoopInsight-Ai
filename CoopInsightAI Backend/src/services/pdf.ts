/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PDF ENGINE FOR EVERY DOCUMENT THE SYSTEM HANDS OUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Downloads used to be whatever each page improvised — a .txt of concatenated
 * lines here, a CSV there, a JSON dump for reports. None of it could be put in
 * front of a general assembly, a sector officer or a bank. A cooperative's
 * papers are documents: a letterhead saying whose they are, the period they
 * cover, figures in tables with totals, somebody's name under them, and page
 * numbers.
 *
 * Everything downloadable is described as a `PdfDocument` and rendered here, so
 * a report, a member's statement and an exported list all look like they came
 * from the same office.
 */

import PDFDocument from "pdfkit";

export type Cell = string | number | null | undefined;

export interface PdfSection {
  title: string;
  /** A line of explanation under the heading. */
  note?: string;
  /** Free text, one paragraph each. */
  paragraphs?: string[];
  /** Label/value pairs, set in two columns. */
  facts?: Array<{ label: string; value: string }>;
  columns?: string[];
  rows?: Cell[][];
  /** A closing row set in bold — the totals. */
  totals?: Cell[];
}

export interface PdfDocumentSpec {
  title: string;
  /** Usually the period covered. */
  subtitle?: string | null;
  /** The letterhead: whose document this is. */
  organisation?: { name: string; lines?: string[] } | null;
  /** Small print under the title: prepared by, generated on, reference. */
  meta?: Array<{ label: string; value: string }>;
  /** Opening paragraphs that say what the figures mean. */
  narrative?: string[];
  /** Headline figures, shown as tiles. */
  summary?: Array<{ label: string; value: string }>;
  sections?: PdfSection[];
  /** Titles to sign against, e.g. "President", "Secretary". */
  signatories?: string[];
  footer?: string;
}

const GREEN = "#2D6A4F";
const INK = "#111827";
const MUTED = "#6B7280";
const RULE = "#D1D5DB";
const BAND = "#F3F4F6";

/**
 * The built-in fonts cover Latin-1. Anything outside it would print as a wrong
 * glyph, so the few symbols the app uses are spelled out and the rest dropped.
 */
function clean(value: Cell): string {
  if (value == null) return "";
  return String(value)
    .replace(/[→➜]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[✓✔]/g, "Yes")
    .replace(/[✗✘]/g, "No")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[−]/g, "-")
    .replace(/[μ]/g, "mean")
    .replace(/[σ]/g, "sd")
    .replace(/[Δ]/g, "change")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…]/g, "");
}

/** Figures line up on the right; words on the left. */
const isFigure = (v: Cell) =>
  typeof v === "number" || /^(RWF\s*)?[-+]?[\d][\d,]*(\.\d+)?\s*(RWF|%)?$/.test(clean(v).trim());

export function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Wide tables read better on a landscape page.
    const widest = Math.max(0, ...(spec.sections ?? []).map((s) => s.columns?.length ?? 0));
    const doc = new PDFDocument({
      size: "A4",
      layout: widest > 6 ? "landscape" : "portrait",
      margins: { top: 54, bottom: 60, left: 48, right: 48 },
      bufferPages: true,
      info: { Title: clean(spec.title), Author: clean(spec.organisation?.name ?? "CoopInsight AI") },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (needed: number) => {
      if (doc.y + needed > bottom()) doc.addPage();
    };

    // ── Letterhead ──────────────────────────────────────────────────────────
    if (spec.organisation) {
      doc.font("Helvetica-Bold").fontSize(15).fillColor(GREEN).text(clean(spec.organisation.name), left, doc.y, { width });
      for (const line of spec.organisation.lines ?? []) {
        if (clean(line)) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(clean(line), { width });
      }
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.5).strokeColor(GREEN).stroke();
      doc.moveDown(0.9);
    }

    // ── Title block ─────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text(clean(spec.title), left, doc.y, { width });
    if (spec.subtitle) doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(clean(spec.subtitle), { width });
    if (spec.meta?.length) {
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
        spec.meta.map((m) => `${clean(m.label)}: ${clean(m.value)}`).join("   |   "),
        { width }
      );
    }
    doc.moveDown(0.9);

    // ── What the figures mean ───────────────────────────────────────────────
    for (const paragraph of spec.narrative ?? []) {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(paragraph), left, doc.y, { width, align: "justify", lineGap: 2 });
      doc.moveDown(0.5);
    }

    // ── Headline figures ────────────────────────────────────────────────────
    if (spec.summary?.length) {
      const perRow = Math.min(4, spec.summary.length);
      const gap = 8;
      const tileW = (width - gap * (perRow - 1)) / perRow;
      const tileH = 46;
      spec.summary.forEach((item, i) => {
        const col = i % perRow;
        if (col === 0) {
          if (i > 0) doc.y += tileH + gap;
          ensure(tileH + gap);
        }
        const x = left + col * (tileW + gap);
        const y = doc.y;
        doc.roundedRect(x, y, tileW, tileH, 4).fillColor(BAND).fill();
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(clean(item.label).toUpperCase(), x + 8, y + 8, { width: tileW - 16, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(clean(item.value), x + 8, y + 22, { width: tileW - 16, lineBreak: false, ellipsis: true });
        doc.y = y;
      });
      doc.y += tileH + 16;
      doc.x = left;
    }

    // ── Sections ────────────────────────────────────────────────────────────
    const drawTable = (section: PdfSection) => {
      const columns = section.columns ?? [];
      const rows = section.rows ?? [];
      if (!columns.length) return;

      const fontSize = columns.length > 7 ? 7.5 : 8.5;
      const pad = 4;

      // Widths follow the content: long text gets room, figures stay narrow.
      const weights = columns.map((heading, i) => {
        const sample = rows.slice(0, 60).map((r) => clean(r[i]).length);
        const longest = Math.max(clean(heading).length, ...sample, 4);
        return Math.min(longest, 42) + 2;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * width);
      const right = columns.map((_, i) => rows.length > 0 && rows.slice(0, 40).every((r) => r[i] == null || r[i] === "" || isFigure(r[i])));

      const rowHeight = (cells: Cell[], bold: boolean) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
        return Math.max(...cells.map((c, i) => doc.heightOfString(clean(c) || " ", { width: widths[i] - pad * 2 }))) + pad * 2;
      };

      const drawRow = (cells: Cell[], opts: { bold?: boolean; fill?: string; color?: string }) => {
        const h = rowHeight(cells, !!opts.bold);
        const y = doc.y;
        if (opts.fill) doc.rect(left, y, width, h).fillColor(opts.fill).fill();
        let x = left;
        cells.forEach((c, i) => {
          doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(opts.color ?? INK)
            .text(clean(c), x + pad, y + pad, { width: widths[i] - pad * 2, align: right[i] ? "right" : "left" });
          x += widths[i];
        });
        doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
        doc.y = y + h;
        doc.x = left;
      };

      const header = () => drawRow(columns, { bold: true, fill: GREEN, color: "#FFFFFF" });

      ensure(rowHeight(columns, true) + 24);
      header();
      rows.forEach((row, index) => {
        const padded = columns.map((_, i) => row[i]);
        if (doc.y + rowHeight(padded, false) > bottom()) {
          doc.addPage();
          header();
        }
        drawRow(padded, { fill: index % 2 ? BAND : undefined });
      });
      if (section.totals) {
        const padded = columns.map((_, i) => section.totals![i]);
        if (doc.y + rowHeight(padded, true) > bottom()) {
          doc.addPage();
          header();
        }
        drawRow(padded, { bold: true });
      }
      if (!rows.length) {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text("Nothing recorded for this period.", left, doc.y + 6, { width });
      }
    };

    for (const section of spec.sections ?? []) {
      ensure(70);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(GREEN).text(clean(section.title), left, doc.y, { width });
      if (section.note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(clean(section.note), { width });
      doc.moveDown(0.35);

      for (const paragraph of section.paragraphs ?? []) {
        ensure(30);
        doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(paragraph), left, doc.y, { width, lineGap: 2 });
        doc.moveDown(0.35);
      }

      if (section.facts?.length) {
        const labelW = Math.min(190, width * 0.38);
        for (const fact of section.facts) {
          const h = Math.max(
            doc.font("Helvetica").fontSize(9.5).heightOfString(clean(fact.value) || " ", { width: width - labelW - 8 }),
            12
          ) + 6;
          ensure(h);
          const y = doc.y;
          doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(clean(fact.label), left, y, { width: labelW });
          doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(clean(fact.value), left + labelW + 8, y, { width: width - labelW - 8 });
          doc.y = y + h;
          doc.x = left;
        }
        doc.moveDown(0.3);
      }

      drawTable(section);
      doc.moveDown(0.6);
    }

    // ── Signatures ──────────────────────────────────────────────────────────
    if (spec.signatories?.length) {
      ensure(110);
      doc.moveDown(2.2);
      const n = spec.signatories.length;
      const gap = 24;
      const w = (width - gap * (n - 1)) / n;
      const y = doc.y + 28;
      spec.signatories.forEach((role, i) => {
        const x = left + i * (w + gap);
        doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(INK).stroke();
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(clean(role), x, y + 5, { width: w });
        doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Name, signature and date", x, y + 18, { width: w });
      });
      doc.y = y + 40;
    }

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - doc.page.margins.bottom + 22;
      // Writing below the bottom margin would otherwise start a new page.
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, fy - 8).lineTo(left + width, fy - 8).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
        .text(clean(spec.footer ?? "Generated by CoopInsight AI"), left, fy, { width: width * 0.7, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, fy, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

/** A safe file name from a document title. */
export const pdfFileName = (title: string, stamp?: string) =>
  `${clean(title).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "document"}` +
  `${stamp ? `-${stamp}` : ""}.pdf`;
