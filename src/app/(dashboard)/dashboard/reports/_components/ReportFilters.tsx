// src/app/(dashboard)/dashboard/reports/_components/ReportFilters.tsx
// ---------------------------------------------------------------------------
// Shared filter bar used across every report tab.
//
// Controlled component — parent owns the ReportFiltersState, this just emits
// changes and fires the "Generate" / "Export Excel" / "Export PDF" buttons.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import type {
  ReportFilterOptions,
  ReportFiltersState,
} from "../types";

export type ExportKind = "excel" | "pdf";

interface Props {
  value: ReportFiltersState;
  onChange: (next: ReportFiltersState) => void;
  options: ReportFilterOptions;
  onGenerate: () => void;
  onExport: (kind: ExportKind) => void;
  busy?: boolean;
  /** If the current tab has no SKU concept, hide the SKU dropdown. */
  showProductFilter?: boolean;
  /** If the current tab has no date concept (e.g. Product Master), hide dates. */
  showDateFilter?: boolean;
  /** Disable export buttons when there are no rows yet. */
  canExport?: boolean;
}

export function ReportFilters({
  value,
  onChange,
  options,
  onGenerate,
  onExport,
  busy,
  showProductFilter = true,
  showDateFilter = true,
  canExport = true,
}: Props) {
  // Cascade — areas depend on zone, distributors on area.
  const areasForZone = useMemo(() => {
    if (value.zoneId === "all") return options.areas;
    return options.areas.filter((a) => a.parentId === value.zoneId);
  }, [value.zoneId, options.areas]);

  const distributorsForArea = useMemo(() => {
    if (value.areaId === "all") return options.distributors;
    return options.distributors.filter((d) => d.parentId === value.areaId);
  }, [value.areaId, options.distributors]);

  function update<K extends keyof ReportFiltersState>(
    key: K,
    v: ReportFiltersState[K],
  ) {
    const next = { ...value, [key]: v };
    // Cascade resets.
    if (key === "zoneId") {
      next.areaId = "all";
      next.distributorId = "all";
    }
    if (key === "areaId") {
      next.distributorId = "all";
    }
    onChange(next);
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {showDateFilter && (
          <>
            <Field label="From">
              <input
                type="date"
                value={value.dateFrom}
                onChange={(e) => update("dateFrom", e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={value.dateTo}
                onChange={(e) => update("dateTo", e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
          </>
        )}

        <Field label="Zone">
          <select
            value={value.zoneId}
            onChange={(e) => update("zoneId", e.target.value as ReportFiltersState["zoneId"])}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">All zones</option>
            {options.zones.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Area">
          <select
            value={value.areaId}
            onChange={(e) => update("areaId", e.target.value as ReportFiltersState["areaId"])}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">All areas</option>
            {areasForZone.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Distributor">
          <select
            value={value.distributorId}
            onChange={(e) => update("distributorId", e.target.value as ReportFiltersState["distributorId"])}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">All distributors</option>
            {distributorsForArea.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </Field>

        {showProductFilter && (
          <Field label="SKU">
            <select
              value={value.productId}
              onChange={(e) => update("productId", e.target.value as ReportFiltersState["productId"])}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="all">All SKUs</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? "Loading…" : "Generate"}
        </button>
        <button
          type="button"
          onClick={() => onExport("excel")}
          disabled={!canExport || busy}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          Export Excel
        </button>
        <button
          type="button"
          onClick={() => onExport("pdf")}
          disabled={!canExport || busy}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          Export PDF
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
