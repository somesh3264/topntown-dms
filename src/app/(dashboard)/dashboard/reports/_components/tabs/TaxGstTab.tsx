// src/app/(dashboard)/dashboard/reports/_components/tabs/TaxGstTab.tsx
// ---------------------------------------------------------------------------
// Tax / GST report — bill_items with product tax rates. Summary cards show
// taxable value, total tax, grand total, and bill count for the period.
// Date range defaults (in ReportsShell) to the current financial month.
// ---------------------------------------------------------------------------

"use client";

import type { ExportKind } from "../ReportFilters";
import type { ReportFiltersState, TaxGstRow, TaxGstSummary } from "../../types";
import {
  exportToExcel,
  exportToPDF,
  inr,
  type ExportColumn,
  type ExportSummaryItem,
} from "../../exports";

interface Props {
  rows: TaxGstRow[];
  summary: TaxGstSummary | null;
  loading?: boolean;
}

const columns: ExportColumn<TaxGstRow>[] = [
  { header: "Bill Date", key: "billDate" },
  { header: "Bill #", key: "billNumber" },
  { header: "Distributor", key: "distributor" },
  { header: "Product", key: "product" },
  { header: "Tax Rate", key: "taxRate", align: "right", format: (v) => `${Number(v).toFixed(2)}%` },
  { header: "Taxable Value", key: "taxableValue", align: "right", format: (v) => inr(v) },
  { header: "Tax Amount", key: "taxAmount", align: "right", format: (v) => inr(v) },
  { header: "Total", key: "total", align: "right", format: (v) => inr(v) },
];

export function TaxGstTab({ rows, summary, loading }: Props) {
  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="Bills" value={summary.billCount.toLocaleString("en-IN")} />
          <SummaryCard label="Taxable Value (INR)" value={inr(summary.taxableValue)} />
          <SummaryCard label="Tax Amount (INR)" value={inr(summary.taxAmount)} />
          <SummaryCard label="Grand Total (INR)" value={inr(summary.grandTotal)} accent />
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <EmptyRow colSpan={columns.length} text="Loading…" />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={columns.length} text="No bills in this period." />
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.billNumber}-${r.productId}-${i}`} className="border-t">
                  <td className="px-3 py-2">{r.billDate}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.billNumber}</td>
                  <td className="px-3 py-2">{r.distributor}</td>
                  <td className="px-3 py-2">{r.product}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.taxRate.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.taxableValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.taxAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(r.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 ${
        accent ? "border-emerald-200 bg-emerald-50" : "bg-card"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

export function exportTaxGst(
  kind: ExportKind,
  rows: TaxGstRow[],
  summary: TaxGstSummary | null,
  filters: ReportFiltersState,
) {
  const fileBase = `tax_gst_${filters.dateFrom}_to_${filters.dateTo}`;
  const summaryItems: ExportSummaryItem[] = summary
    ? [
        { label: "Bills", value: summary.billCount },
        { label: "Taxable value (INR)", value: inr(summary.taxableValue) },
        { label: "Tax amount (INR)", value: inr(summary.taxAmount) },
        { label: "Grand total (INR)", value: inr(summary.grandTotal) },
      ]
    : [];

  if (kind === "excel") {
    exportToExcel(fileBase, "Tax GST", columns, rows, summaryItems);
  } else {
    exportToPDF(
      fileBase,
      `Tax / GST Report (${filters.dateFrom} → ${filters.dateTo})`,
      columns,
      rows,
      summaryItems,
    );
  }
}
