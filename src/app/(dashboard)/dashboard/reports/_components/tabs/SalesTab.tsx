// src/app/(dashboard)/dashboard/reports/_components/tabs/SalesTab.tsx
// ---------------------------------------------------------------------------
// Sales report — one row per delivery line. Supports a group-by toggle
// (none / date / distributor / store / product) with summary cards.
// ---------------------------------------------------------------------------

"use client";

import { useMemo, useState } from "react";
import type { ExportKind } from "../ReportFilters";
import type {
  ReportFiltersState,
  SalesGroupBy,
  SalesRow,
  SalesSummary,
} from "../../types";
import {
  exportToExcel,
  exportToPDF,
  inr,
  type ExportColumn,
  type ExportSummaryItem,
} from "../../exports";

interface Props {
  rows: SalesRow[];
  summary: SalesSummary | null;
  loading?: boolean;
}

const detailColumns: ExportColumn<SalesRow>[] = [
  { header: "Date", key: "date" },
  { header: "Zone", key: "zone" },
  { header: "Area", key: "area" },
  { header: "Distributor", key: "distributor" },
  { header: "Store", key: "store" },
  { header: "Product", key: "product" },
  { header: "Qty", key: "qty", align: "right" },
  { header: "Unit Price", key: "unitPrice", align: "right", format: (v) => inr(v) },
  { header: "Total", key: "total", align: "right", format: (v) => inr(v) },
];

interface GroupedRow {
  bucket: string;
  qty: number;
  revenue: number;
}

const groupColumns: ExportColumn<GroupedRow>[] = [
  { header: "Group", key: "bucket" },
  { header: "Qty", key: "qty", align: "right" },
  { header: "Revenue", key: "revenue", align: "right", format: (v) => inr(v) },
];

const GROUP_BY_OPTIONS: Array<{ value: SalesGroupBy; label: string }> = [
  { value: "none", label: "No grouping" },
  { value: "date", label: "Date" },
  { value: "distributor", label: "Distributor" },
  { value: "store", label: "Store" },
  { value: "product", label: "Product" },
];

export function SalesTab({ rows, summary, loading }: Props) {
  const [groupBy, setGroupBy] = useState<SalesGroupBy>("none");

  const grouped = useMemo(() => aggregate(rows, groupBy), [rows, groupBy]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="Deliveries" value={summary.totalDeliveries.toLocaleString("en-IN")} />
          <SummaryCard label="Unique Stores" value={summary.uniqueStores.toLocaleString("en-IN")} />
          <SummaryCard label="Units Sold" value={summary.totalUnits.toLocaleString("en-IN")} />
          <SummaryCard label="Revenue (INR)" value={inr(summary.totalRevenue)} accent />
        </div>
      )}

      {/* Group-by toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Group by:</span>
        {GROUP_BY_OPTIONS.map((g) => (
          <button
            key={g.value}
            onClick={() => setGroupBy(g.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              groupBy === g.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        {groupBy === "none" ? (
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                {detailColumns.map((c) => (
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
                <EmptyRow colSpan={detailColumns.length} text="Loading…" />
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={detailColumns.length} text="No sales in this range." />
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.distributorId}-${r.storeId}-${r.productId}-${i}`} className="border-t">
                    <td className="px-3 py-2">{r.date}</td>
                    <td className="px-3 py-2">{r.zone}</td>
                    <td className="px-3 py-2">{r.area}</td>
                    <td className="px-3 py-2">{r.distributor}</td>
                    <td className="px-3 py-2">{r.store}</td>
                    <td className="px-3 py-2">{r.product}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.qty.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(r.unitPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(r.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Group</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <EmptyRow colSpan={3} text={loading ? "Loading…" : "No data."} />
              ) : (
                grouped.map((g) => (
                  <tr key={g.bucket} className="border-t">
                    <td className="px-3 py-2">{g.bucket}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {g.qty.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {inr(g.revenue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aggregate(rows: SalesRow[], groupBy: SalesGroupBy): GroupedRow[] {
  if (groupBy === "none") return [];
  const keyFn = (r: SalesRow) =>
    groupBy === "date"
      ? r.date
      : groupBy === "distributor"
        ? r.distributor
        : groupBy === "store"
          ? r.store
          : r.product;
  const map = new Map<string, GroupedRow>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = map.get(k);
    if (cur) {
      cur.qty += r.qty;
      cur.revenue += r.total;
    } else {
      map.set(k, { bucket: k, qty: r.qty, revenue: r.total });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
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

export function exportSales(
  kind: ExportKind,
  rows: SalesRow[],
  summary: SalesSummary | null,
  filters: ReportFiltersState,
) {
  const fileBase = `sales_${filters.dateFrom}_to_${filters.dateTo}`;
  const summaryItems: ExportSummaryItem[] = summary
    ? [
        { label: "Deliveries", value: summary.totalDeliveries },
        { label: "Unique stores", value: summary.uniqueStores },
        { label: "Units sold", value: summary.totalUnits },
        { label: "Revenue (INR)", value: inr(summary.totalRevenue) },
      ]
    : [];

  if (kind === "excel") {
    exportToExcel(fileBase, "Sales", detailColumns, rows, summaryItems);
  } else {
    exportToPDF(
      fileBase,
      `Sales Report (${filters.dateFrom} → ${filters.dateTo})`,
      detailColumns,
      rows,
      summaryItems,
    );
  }
}
