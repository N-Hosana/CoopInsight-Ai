/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PDF ENGINE FOR EVERY DOCUMENT THE SYSTEM HANDS OUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A cooperative's papers are documents: whose they are, the period they cover,
 * figures in tables with totals, somebody's name under them — and, because they
 * are handed to a bank, a sector officer or the RCA, some way to tell a genuine
 * one from a retyped one.
 *
 * Every downloadable thing is described as a `PdfDocumentSpec` and rendered
 * here, so a report, a member's statement and an exported list all carry:
 *
 *   • the CoopInsightAI mark and the issuing body's letterhead
 *   • a document-details panel: scope, period, date and time generated, by whom
 *   • a reference and verification code on every page
 *   • a closing authenticity panel saying how to check it, with a fingerprint
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

/** The registry entry that makes the document checkable. */
export interface PdfDocumentInfo {
  reference: string;
  verificationCode: string;
  issuedAt: string;
  issuedBy?: string | null;
  issuedByRole?: string | null;
  /** Who the document covers: a cooperative, a sector, the district, a member. */
  scopeLabel?: string | null;
  /** The period covered, as words. */
  period?: string | null;
  fingerprint: string;
  verifyUrl: string;
}

export interface PdfDocumentSpec {
  title: string;
  /** Usually the period covered. */
  subtitle?: string | null;
  /** The letterhead: whose document this is. */
  organisation?: { name: string; lines?: string[] } | null;
  /** Reference, verification code, issuer — see documentRegistry.ts. */
  document?: PdfDocumentInfo;
  /** Extra small print under the title, for documents without a registry entry. */
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

// The app's palette: forest green, deep green, the gold accent.
const GREEN = "#2D6A4F";
const DEEP = "#1B4332";
const GOLD = "#D4A574";
const INK = "#111827";
const MUTED = "#6B7280";
const RULE = "#D1D5DB";
const BAND = "#F3F4F6";
const TINT = "#EEF5F1";

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
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…]/g, "");
}

/** Figures line up on the right; words on the left. */
const isFigure = (v: Cell) =>
  typeof v === "number" || /^(RWF\s*)?[-+]?[\d][\d,]*(\.\d+)?\s*(RWF|%)?$/.test(clean(v).trim());

/** "16 November 2026, 17:42 (Kigali time)" — the moment, not just the day. */
export const kigaliTime = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Kigali",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} (Kigali time)`;

/**
 * The CoopInsightAI mark, drawn rather than loaded so no asset can go missing:
 * three overlapping circles — members joining together — on the brand green,
 * with a gold point at the centre where they meet.
 */
function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.22).fillColor(GREEN).fill();
  const cx = x + size / 2;
  const cy = y + size / 2 + size * 0.02;
  const r = size * 0.2;
  const d = size * 0.13;
  doc.fillOpacity(0.9);
  for (const angle of [-90, 30, 150]) {
    const a = (angle * Math.PI) / 180;
    doc.circle(cx + d * Math.cos(a), cy + d * Math.sin(a), r).lineWidth(size * 0.045).strokeColor("#FFFFFF").stroke();
  }
  doc.fillOpacity(1);
  doc.circle(cx, cy, size * 0.075).fillColor(GOLD).fill();
  doc.restore();
}

export function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Wide tables read better on a landscape page.
    const widest = Math.max(0, ...(spec.sections ?? []).map((s) => s.columns?.length ?? 0));
    const doc = new PDFDocument({
      size: "A4",
      layout: widest > 6 ? "landscape" : "portrait",
      margins: { top: 44, bottom: 64, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: clean(spec.title),
        Author: clean(spec.organisation?.name ?? "CoopInsightAI"),
        Creator: "CoopInsightAI",
        Subject: spec.document ? `Reference ${spec.document.reference}` : clean(spec.title),
      },
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
    const info = spec.document;

    // ── Brand band ──────────────────────────────────────────────────────────
    {
      const top = doc.y;
      const size = 34;
      drawLogo(doc, left, top, size);
      doc.font("Helvetica-Bold").fontSize(15).fillColor(DEEP).text("CoopInsightAI", left + size + 10, top + 3, { lineBreak: false });
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
        .text("Cooperative management and oversight platform  ·  Gasabo District, Rwanda", left + size + 10, top + 21, { lineBreak: false });

      if (info) {
        const boxW = 190;
        doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("DOCUMENT REFERENCE", left + width - boxW, top + 1, { width: boxW, align: "right" });
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(clean(info.reference), left + width - boxW, top + 10, { width: boxW, align: "right" });
        doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(`Issued ${clean(kigaliTime(info.issuedAt))}`, left + width - boxW, top + 24, { width: boxW, align: "right" });
      }

      const ruleY = top + size + 9;
      doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(2).strokeColor(GREEN).stroke();
      doc.moveTo(left, ruleY + 3).lineTo(left + width * 0.28, ruleY + 3).lineWidth(1.2).strokeColor(GOLD).stroke();
      doc.y = ruleY + 14;
      doc.x = left;
    }

    // ── Letterhead of the body the document is about ───────────────────────
    if (spec.organisation) {
      doc.font("Helvetica-Bold").fontSize(12.5).fillColor(GREEN).text(clean(spec.organisation.name), left, doc.y, { width });
      const lines = (spec.organisation.lines ?? []).map(clean).filter(Boolean);
      if (lines.length) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(lines.join("   ·   "), { width });
      doc.moveDown(0.8);
    }

    // ── Title ───────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(19).fillColor(INK).text(clean(spec.title), left, doc.y, { width });
    if (spec.subtitle) doc.font("Helvetica").fontSize(10.5).fillColor(MUTED).text(clean(spec.subtitle), { width });
    if (!info && spec.meta?.length) {
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
        spec.meta.map((m) => `${clean(m.label)}: ${clean(m.value)}`).join("   |   "),
        { width }
      );
    }
    doc.moveDown(0.8);

    // ── Document details ────────────────────────────────────────────────────
    if (info) {
      const details: Array<[string, string]> = [
        ["Covers", info.scopeLabel ?? "—"],
        ["Period", info.period ?? "—"],
        ["Generated on", kigaliTime(info.issuedAt)],
        ["Generated by", [info.issuedBy, info.issuedByRole].filter(Boolean).join(", ") || "—"],
        ["Reference", info.reference],
        ["Verification code", info.verificationCode],
      ];
      const colW = (width - 24) / 2;
      const labelW = 100;
      doc.font("Helvetica-Bold").fontSize(9);
      const rowH = (pair: Array<[string, string]>) =>
        Math.max(...pair.map(([, v]) => doc.heightOfString(clean(v), { width: colW - labelW - 8 }))) + 6;
      const pairs: Array<Array<[string, string]>> = [];
      for (let i = 0; i < details.length; i += 2) pairs.push(details.slice(i, i + 2));
      const boxH = pairs.reduce((a, p) => a + rowH(p), 0) + 16;
      ensure(boxH + 10);
      const y0 = doc.y;
      doc.roundedRect(left, y0, width, boxH, 5).fillColor(TINT).fill();
      doc.rect(left, y0, 3, boxH).fillColor(GREEN).fill();
      let y = y0 + 8;
      for (const pair of pairs) {
        const h = rowH(pair);
        pair.forEach(([label, value], i) => {
          const x = left + 12 + i * (colW + 12);
          doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(clean(label).toUpperCase(), x, y + 1, { width: labelW, lineBreak: false });
          doc.font(label === "Verification code" || label === "Reference" ? "Courier-Bold" : "Helvetica-Bold")
            .fontSize(9).fillColor(INK).text(clean(value), x + labelW, y, { width: colW - labelW - 8 });
        });
        y += h;
      }
      doc.y = y0 + boxH + 14;
      doc.x = left;
    }

    // ── What the figures mean ───────────────────────────────────────────────
    for (const paragraph of spec.narrative ?? []) {
      ensure(30);
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(paragraph), left, doc.y, { width, align: "justify", lineGap: 2 });
      doc.moveDown(0.5);
    }

    // ── Headline figures ────────────────────────────────────────────────────
    if (spec.summary?.length) {
      doc.moveDown(0.2);
      const perRow = Math.min(4, spec.summary.length);
      const gap = 8;
      const tileW = (width - gap * (perRow - 1)) / perRow;
      const tileH = 48;
      spec.summary.forEach((item, i) => {
        const col = i % perRow;
        if (col === 0) {
          if (i > 0) doc.y += tileH + gap;
          ensure(tileH + gap);
        }
        const x = left + col * (tileW + gap);
        const y = doc.y;
        doc.roundedRect(x, y, tileW, tileH, 4).fillColor(BAND).fill();
        doc.rect(x, y + 8, 2.5, tileH - 16).fillColor(GOLD).fill();
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(clean(item.label).toUpperCase(), x + 10, y + 9, { width: tileW - 18, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(12.5).fillColor(DEEP).text(clean(item.value), x + 10, y + 23, { width: tileW - 18, lineBreak: false, ellipsis: true });
        doc.y = y;
      });
      doc.y += tileH + 18;
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

      // No column narrower than its longest single word — "Remera" must not
      // break into "Remer / a". The room comes from the widest columns.
      const minimums = columns.map((heading, i) => {
        const cells = [heading, ...rows.slice(0, 60).map((r) => r[i])];
        const longestWord = Math.max(
          ...cells.flatMap((c) => clean(c).split(/\s+/)).map((word) =>
            doc.font("Helvetica-Bold").fontSize(fontSize).widthOfString(word)
          ),
          0
        );
        return Math.min(longestWord + pad * 2 + 2, width / 3);
      });
      for (let pass = 0; pass < 3; pass++) {
        const short = widths.reduce((a, w, i) => a + Math.max(0, minimums[i] - w), 0);
        if (short <= 0.5) break;
        widths.forEach((w, i) => { if (w < minimums[i]) widths[i] = minimums[i]; });
        const spare = widths.map((w, i) => Math.max(0, w - minimums[i]));
        const spareTotal = spare.reduce((a, b) => a + b, 0);
        if (spareTotal <= 0) break;
        widths.forEach((_, i) => { widths[i] -= (spare[i] / spareTotal) * short; });
      }
      const right = columns.map((_, i) => rows.length > 0 && rows.slice(0, 40).every((r) => r[i] == null || r[i] === "" || isFigure(r[i])));

      const rowHeight = (cells: Cell[], bold: boolean) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
        return Math.max(...cells.map((c, i) => doc.heightOfString(clean(c) || " ", { width: widths[i] - pad * 2 }))) + pad * 2;
      };

      const drawRow = (cells: Cell[], opts: { bold?: boolean; fill?: string; color?: string; topRule?: boolean }) => {
        const h = rowHeight(cells, !!opts.bold);
        const y = doc.y;
        if (opts.fill) doc.rect(left, y, width, h).fillColor(opts.fill).fill();
        if (opts.topRule) doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(DEEP).stroke();
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
        drawRow(padded, { bold: true, fill: TINT, topRule: true });
      }
      if (!rows.length) {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text("Nothing recorded for this period.", left, doc.y + 6, { width });
      }
    };

    for (const section of spec.sections ?? []) {
      ensure(70);
      doc.moveDown(0.5);
      const hy = doc.y;
      doc.rect(left, hy + 2, 3, 11).fillColor(GOLD).fill();
      doc.font("Helvetica-Bold").fontSize(12).fillColor(DEEP).text(clean(section.title), left + 9, hy, { width: width - 9 });
      if (section.note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(clean(section.note), left + 9, doc.y, { width: width - 9 });
      doc.moveDown(0.4);
      doc.x = left;

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
          doc.moveTo(left, y + h - 2).lineTo(left + width, y + h - 2).lineWidth(0.3).strokeColor(RULE).stroke();
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
      doc.moveDown(2);
      const n = spec.signatories.length;
      const gap = 24;
      const w = (width - gap * (n - 1)) / n;
      const y = doc.y + 28;
      spec.signatories.forEach((role, i) => {
        const x = left + i * (w + gap);
        doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(INK).stroke();
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(clean(role), x, y + 5, { width: w });
        doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Name, signature, date and stamp", x, y + 18, { width: w });
      });
      doc.y = y + 44;
      doc.x = left;
    }

    // ── Authenticity ────────────────────────────────────────────────────────
    if (info) {
      const text =
        `This document was generated by CoopInsightAI on ${kigaliTime(info.issuedAt)} from the records held at ` +
        `that moment, and entered in the document register under reference ${info.reference}. To confirm that it ` +
        `is genuine and has not been altered, open ${info.verifyUrl} or enter the verification code ` +
        `${info.verificationCode} on the CoopInsightAI verification page. ` +
        `Content fingerprint (SHA-256): ${info.fingerprint.slice(0, 16)}…${info.fingerprint.slice(-8)}.`;
      doc.font("Helvetica").fontSize(8.5);
      const h = doc.heightOfString(clean(text), { width: width - 70, lineGap: 1.5 }) + 30;
      ensure(h + 16);
      doc.moveDown(0.8);
      const y = doc.y;
      doc.roundedRect(left, y, width, h, 5).lineWidth(1).strokeColor(GREEN).stroke();
      drawLogo(doc, left + 12, y + 12, 26);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(DEEP).text("Authenticity", left + 50, y + 10, { width: width - 62 });
      doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(clean(text), left + 50, y + 23, { width: width - 62, lineGap: 1.5 });
      doc.y = y + h + 6;
      doc.x = left;
    }

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - doc.page.margins.bottom + 24;
      // Writing below the bottom margin would otherwise start a new page.
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, fy - 9).lineTo(left + width, fy - 9).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GREEN).text("CoopInsightAI", left, fy, { lineBreak: false });
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
        .text(`  ·  ${clean(spec.footer ?? spec.title).slice(0, 70)}`, left + 54, fy, { width: width * 0.5, lineBreak: false, ellipsis: true });
      const middle = info ? `Ref. ${info.reference}   ·   Verify: ${info.verificationCode}` : "";
      if (middle) doc.font("Courier").fontSize(7.5).fillColor(INK).text(middle, left, fy + 10, { width, lineBreak: false });
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`Page ${i - range.start + 1} of ${range.count}`, left, fy, { width, align: "right", lineBreak: false });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

/** A safe file name from a document title. */
export const pdfFileName = (title: string, stamp?: string) =>
  `${clean(title).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "document"}` +
  `${stamp ? `-${stamp}` : ""}.pdf`;
