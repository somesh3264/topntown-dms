// src/app/(dashboard)/dashboard/reports/exports.ts
// ---------------------------------------------------------------------------
// Client-side exporters for the Reports module.
//
//   exportToExcel(filename, sheetName, columns, rows, summary?)
//   exportToPDF(filename, title, columns, rows, summary?)
//
// Library expectations (add to package.json):
//   "xlsx":             "^0.18.5",
//   "jspdf":            "^2.5.1",
//   "jspdf-autotable":  "^3.8.2"
//
// All exports run entirely in the browser — no data leaves the client.
// ---------------------------------------------------------------------------

"use client";

// deno-lint-ignore no-explicit-any — libraries ship partial types.
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportColumn<T> {
  header: string;
  key: keyof T & string;
  /** Optional formatter for PDF/Excel cell output. */
  format?: (value: unknown, row: T) => string | number;
  /** "right" for numeric columns in the PDF export. */
  align?: "left" | "right" | "center";
}

export interface ExportSummaryItem {
  label: string;
  value: string | number;
}

// ─── Excel ───────────────────────────────────────────────────────────────────

export function exportToExcel<T>(
  filename: string,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summary?: ExportSummaryItem[],
): void {
  const header = columns.map((c) => c.header);

  const body = rows.map((r) =>
    columns.map((c) => {
      const raw = (r as Record<string, unknown>)[c.key];
      if (c.format) return c.format(raw, r);
      // Keep numbers as numbers so Excel treats them as numeric.
      if (typeof raw === "number") return raw;
      if (raw === null || raw === undefined) return "";
      return String(raw);
    }),
  );

  const aoa: (string | number)[][] = [header, ...body];

  if (summary && summary.length > 0) {
    aoa.push([]);
    aoa.push(["Summary"]);
    summary.forEach((s) => {
      aoa.push([s.label, typeof s.value === "number" ? s.value : String(s.value)]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable column widths.
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, ensureExt(filename, ".xlsx"));
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

export function exportToPDF<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summary?: ExportSummaryItem[],
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("TOP N TOWN", margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(title, margin, 56);
  doc.text(
    `Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    pageWidth - margin,
    56,
    { align: "right" },
  );
  doc.setTextColor(0);

  const head = [columns.map((c) => c.header)];
  const body = rows.map((r) =>
    columns.map((c) => {
      const raw = (r as Record<string, unknown>)[c.key];
      if (c.format) return String(c.format(raw, r));
      if (raw === null || raw === undefined) return "";
      return String(raw);
    }),
  );

  autoTable(doc, {
    startY: 76,
    head,
    body,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: {
      fillColor: [33, 37, 41],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
    },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [i, { halign: c.align ?? "left" }]),
    ),
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(130);
      doc.text(
        "System-generated report • Top N Town DMS",
        pageWidth / 2,
        pageHeight - 18,
        { align: "center" },
      );
      doc.setTextColor(0);
    },
  });

  if (summary && summary.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const afterTableY = (doc as any).lastAutoTable?.finalY ?? 100;
    let y = afterTableY + 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Summary", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    summary.forEach((s) => {
      doc.text(s.label, margin, y);
      doc.text(String(s.value), margin + 200, y);
      y += 12;
    });
  }

  doc.save(ensureExt(filename, ".pdf"));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureExt(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

/** Shared INR formatter for amounts. */
export function inr(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Shared percent formatter. */
export function pct(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(1)}%`;
}
