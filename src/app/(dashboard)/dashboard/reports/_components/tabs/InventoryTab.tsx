// src/app/(dashboard)/dashboard/reports/_components/tabs/InventoryTab.tsx
// ---------------------------------------------------------------------------
// Inventory report — stock_allocations rolled up by (distributor, product).
// Fill rate % highlights: red < 80, amber 80–95, green > 95.
// ---------------------------------------------------------------------------

"use client";

import type { ExportKind } from "../ReportFilters";
import type { InventoryRow, ReportFiltersState } from "../../types";
import { exportToExcel, exportToPDF, pct, type ExportColumn } from "../../exports";

interface Props {
  rows: InventoryRow[];
  loading?: boolean;
}

const columns: ExportColumn<InventoryRow>[] = [
  { header: "Distributor", key: "distributor" },
  { header: "Zone", key: "zone" },
  { header: "Area", key: "area" },
  { header: "Product", key: "product" },
  { header: "Allocated", key: "allocated", align: "right" },
  { header: "Delivered", key: "delivered", align: "right" },
  { header: "Remaining", key: "remaining", align: "right" },
  { header: "Fill Rate", key: "fillRatePct", align: "right", format: (v) => pct(v) },
];

export function InventoryTab({ rows, loading }: Props) {
  return (
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
            <EmptyRow
              colSpan={columns.length}
              text="No inventory data for this selection. Hit Generate to load."
            />
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.distributorId}-${r.productId}-${i}`} className="border-t">
                <td className="px-3 py-2">{r.distributor}</td>
                <td className="px-3 py-2">{r.zone}</td>
                <td className="px-3 py-2">{r.area}</td>
                <td className="px-3 py-2">{r.product}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.allocated.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.delivered.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.remaining.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right">
                  <FillRateBadge value={r.fillRatePct} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FillRateBadge({ value }: { value: number }) {
  const tone =
    value < 80
      ? "bg-red-100 text-red-900"
      : value > 95
        ? "bg-emerald-100 text-emerald-900"
        : "bg-amber-100 text-amber-900";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      {value.toFixed(1)}%
    </span>
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

export function exportInventory(
  kind: ExportKind,
  rows: InventoryRow[],
  filters: ReportFiltersState,
) {
  const fileBase = `inventory_${filters.dateFrom}_to_${filters.dateTo}`;
  if (kind === "excel") {
    exportToExcel(fileBase, "Inventory", columns, rows);
  } else {
    exportToPDF(
      fileBase,
      `Inventory Report (${filters.dateFrom} → ${filters.dateTo})`,
      columns,
      rows,
    );
  }
}
