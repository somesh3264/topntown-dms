// src/app/(dashboard)/dashboard/reports/_components/tabs/OrderFulfilmentTab.tsx
// ---------------------------------------------------------------------------
// Order vs. Fulfilment — Ordered | Allocated | Delivered | Variance (%).
// Variance colouring mirrors fill-rate thresholds.
// ---------------------------------------------------------------------------

"use client";

import type { ExportKind } from "../ReportFilters";
import type { OrderFulfilmentRow, ReportFiltersState } from "../../types";
import { exportToExcel, exportToPDF, pct, type ExportColumn } from "../../exports";

interface Props {
  rows: OrderFulfilmentRow[];
  loading?: boolean;
}

const columns: ExportColumn<OrderFulfilmentRow>[] = [
  { header: "Distributor", key: "distributor" },
  { header: "Zone", key: "zone" },
  { header: "Area", key: "area" },
  { header: "Product", key: "product" },
  { header: "Ordered", key: "ordered", align: "right" },
  { header: "Allocated", key: "allocated", align: "right" },
  { header: "Delivered", key: "delivered", align: "right" },
  { header: "Variance", key: "variance", align: "right" },
  { header: "Fulfilment", key: "variancePct", align: "right", format: (v) => pct(v) },
];

export function OrderFulfilmentTab({ rows, loading }: Props) {
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
            <EmptyRow colSpan={columns.length} text="No orders in this range." />
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.distributorId}-${r.productId}-${i}`} className="border-t">
                <td className="px-3 py-2">{r.distributor}</td>
                <td className="px-3 py-2">{r.zone}</td>
                <td className="px-3 py-2">{r.area}</td>
                <td className="px-3 py-2">{r.product}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ordered.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.allocated.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.delivered.toLocaleString("en-IN")}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-medium ${
                    r.variance < 0 ? "text-red-700" : r.variance > 0 ? "text-emerald-700" : ""
                  }`}
                >
                  {r.variance > 0 ? "+" : ""}
                  {r.variance.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right">
                  <FulfilmentBadge value={r.variancePct} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FulfilmentBadge({ value }: { value: number }) {
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

export function exportOrderFulfilment(
  kind: ExportKind,
  rows: OrderFulfilmentRow[],
  filters: ReportFiltersState,
) {
  const fileBase = `order_fulfilment_${filters.dateFrom}_to_${filters.dateTo}`;
  if (kind === "excel") {
    exportToExcel(fileBase, "Order vs Fulfilment", columns, rows);
  } else {
    exportToPDF(
      fileBase,
      `Order vs. Fulfilment (${filters.dateFrom} → ${filters.dateTo})`,
      columns,
      rows,
    );
  }
}
