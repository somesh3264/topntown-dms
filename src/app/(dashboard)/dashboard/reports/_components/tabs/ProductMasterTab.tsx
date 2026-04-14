// src/app/(dashboard)/dashboard/reports/_components/tabs/ProductMasterTab.tsx
// ---------------------------------------------------------------------------
// Read-only SKU listing from the products table.
// ---------------------------------------------------------------------------

"use client";

import type { ExportKind } from "../ReportFilters";
import type { ProductMasterRow } from "../../types";
import { exportToExcel, exportToPDF, inr, type ExportColumn } from "../../exports";

interface Props {
  rows: ProductMasterRow[];
  loading?: boolean;
}

const columns: ExportColumn<ProductMasterRow>[] = [
  { header: "Product", key: "name" },
  { header: "Category", key: "category", format: (v) => (v ?? "-") as string },
  { header: "Weight", key: "weight", format: (v) => (v ?? "-") as string },
  { header: "MRP (INR)", key: "mrp", align: "right", format: (v) => inr(v) },
  { header: "Tax Rate", key: "taxRate", align: "right", format: (v) => `${Number(v).toFixed(2)}%` },
  { header: "Active", key: "isActive", format: (v) => (v ? "Yes" : "No") },
];

export function ProductMasterTab({ rows, loading }: Props) {
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
            <EmptyRow colSpan={columns.length} text="No products configured." />
          ) : (
            rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t ${r.isActive ? "" : "text-muted-foreground"}`}
              >
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.category ?? "-"}</td>
                <td className="px-3 py-2">{r.weight ?? "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.mrp)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.taxRate.toFixed(2)}%</td>
                <td className="px-3 py-2">{r.isActive ? "Yes" : "No"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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

export function exportProductMaster(kind: ExportKind, rows: ProductMasterRow[]) {
  const fileBase = `product_master_${new Date().toISOString().slice(0, 10)}`;
  if (kind === "excel") {
    exportToExcel(fileBase, "Product Master", columns, rows);
  } else {
    exportToPDF(fileBase, "Product Master", columns, rows);
  }
}
