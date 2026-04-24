// src/app/(dashboard)/dashboard/reports/exports.ts
// ---------------------------------------------------------------------------
// Client-side exporters for the Reports module.
//
//   exportToExcel(filename, sheetName, columns, rows, summary?)
//   exportToPDF(filename, title, columns, rows, summary?)
//
// Implementation notes
// --------------------
// The original implementation depended on the `xlsx`, `jspdf`, and
// `jspdf-autotable` packages. Those packages are declared in package.json
// but never installed into node_modules in our current environment, which
// caused the Reports tab to crash at import time with
//     Cannot find module 'xlsx' …
//
// To keep the Reports module fully functional without the heavy binary
// dependencies we now render:
//   • Excel export  → a CSV file (download; Excel/Sheets open CSVs natively).
//                     CSV is a lowest-common-denominator format that works
//                     across every target the client uses.
//   • PDF export    → a print-ready HTML window. The browser's built-in
//                     "Save as PDF" option produces a proper PDF and lets
//                     users pick page size / orientation per their printer.
//
// Public API (ExportColumn / ExportSummaryItem / exportToExcel / exportToPDF /
// inr / pct) is preserved so the per-tab exporters keep working unchanged.
// All exports run entirely in the browser — no data leaves the client.
// ---------------------------------------------------------------------------

"use client";

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

// ─── Excel (CSV) ─────────────────────────────────────────────────────────────

export function exportToExcel<T>(
  filename: string,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summary?: ExportSummaryItem[],
): void {
  // `sheetName` is no longer a workbook sheet — it's kept only for API
  // compatibility. The file is a single CSV.
  void sheetName;

  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.header)).join(","));

  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          const raw = (r as Record<string, unknown>)[c.key];
          const v = c.format ? c.format(raw, r) : raw;
          return csvCell(v);
        })
        .join(","),
    );
  }

  if (summary && summary.length > 0) {
    lines.push("");
    lines.push(csvCell("Summary"));
    for (const s of summary) {
      lines.push([csvCell(s.label), csvCell(s.value)].join(","));
    }
  }

  // BOM so Excel on Windows auto-detects UTF-8 for rupee/accented chars.
  const csv = "\uFEFF" + lines.join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), ensureExt(filename, ".csv"));
}

// ─── PDF (browser print) ─────────────────────────────────────────────────────

export function exportToPDF<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summary?: ExportSummaryItem[],
): void {
  const html = buildPrintHtml(filename, title, columns, rows, summary);

  // Prefer a new window; fall back to a hidden iframe if popups are blocked.
  const win = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Give the browser a tick to lay out, then trigger print.
    win.addEventListener("load", () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* user can still Ctrl+P */
      }
    });
    // Safety net if the load event already fired.
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        /* ignore */
      }
    }, 400);
    return;
  }

  // Popup blocked — fall back to a hidden iframe.
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    }
  }, 400);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureExt(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "number" ? String(value) : String(value);
  // Quote if the cell contains a comma, quote, CR, or LF. Double up internal quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to let the browser start the download.
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function escapeHtml(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPrintHtml<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summary?: ExportSummaryItem[],
): string {
  const generated =
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";

  const theadCells = columns
    .map(
      (c) =>
        `<th style="text-align:${c.align ?? "left"}">${escapeHtml(c.header)}</th>`,
    )
    .join("");

  const bodyRows =
    rows.length === 0
      ? `<tr><td colspan="${columns.length}" class="empty">No data.</td></tr>`
      : rows
          .map((r) => {
            const tds = columns
              .map((c) => {
                const raw = (r as Record<string, unknown>)[c.key];
                const v = c.format ? c.format(raw, r) : raw;
                return `<td style="text-align:${c.align ?? "left"}">${escapeHtml(v)}</td>`;
              })
              .join("");
            return `<tr>${tds}</tr>`;
          })
          .join("");

  const summaryHtml =
    summary && summary.length > 0
      ? `<section class="summary">
          <h2>Summary</h2>
          <table class="summary-table">
            <tbody>
              ${summary
                .map(
                  (s) =>
                    `<tr><th>${escapeHtml(s.label)}</th><td>${escapeHtml(s.value)}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </section>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(filename)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #111;
    margin: 24px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid #111;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  header .brand { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
  header .title { font-size: 13px; color: #333; margin-top: 4px; }
  header .meta  { font-size: 11px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead th {
    background: #212529;
    color: #fff;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid #212529;
  }
  tbody td {
    border: 1px solid #d9dde2;
    padding: 5px 8px;
    vertical-align: top;
  }
  tbody tr:nth-child(even) td { background: #f7f9fb; }
  .empty { text-align: center; color: #777; padding: 20px; }
  .summary { margin-top: 20px; }
  .summary h2 { font-size: 13px; margin: 0 0 6px 0; }
  .summary-table { width: auto; min-width: 260px; }
  .summary-table th { text-align: left; background: #eef1f4; color: #111; border: 1px solid #d9dde2; }
  footer {
    margin-top: 16px;
    font-size: 10px;
    color: #888;
    text-align: center;
    font-style: italic;
  }
  @media print {
    body { margin: 12mm; }
    @page { size: A4 landscape; margin: 12mm; }
    .no-print { display: none !important; }
    thead { display: table-header-group; }
    tr, td, th { page-break-inside: avoid; }
  }
  .toolbar {
    margin: 0 0 12px 0;
    font-size: 12px;
  }
  .toolbar button {
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    margin-right: 8px;
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
    <span style="color:#666">Tip: choose "Save as PDF" as the destination in the print dialog.</span>
  </div>
  <header>
    <div>
      <div class="brand">TOP N TOWN</div>
      <div class="title">${escapeHtml(title)}</div>
    </div>
    <div class="meta">Generated: ${escapeHtml(generated)}</div>
  </header>
  <table>
    <thead><tr>${theadCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  ${summaryHtml}
  <footer>System-generated report • Top N Town DMS</footer>
</body>
</html>`;
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
