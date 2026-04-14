// src/app/(dashboard)/dashboard/reports/_components/ReportsShell.tsx
// ---------------------------------------------------------------------------
// Client-side shell for the reports module — owns the active tab, the
// shared filter state, the per-tab row cache, and wires the Generate /
// Export buttons to each tab's action + exporter.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  fetchInventoryReport,
  fetchOrderFulfilmentReport,
  fetchProductMasterReport,
  fetchSalesReport,
  fetchTaxGstReport,
} from "../actions";
import type {
  InventoryRow,
  OrderFulfilmentRow,
  ProductMasterRow,
  ReportFilterOptions,
  ReportFiltersState,
  ReportTabId,
  SalesRow,
  SalesSummary,
  TaxGstRow,
  TaxGstSummary,
} from "../types";
import { ReportFilters, type ExportKind } from "./ReportFilters";
import { InventoryTab, exportInventory } from "./tabs/InventoryTab";
import { SalesTab, exportSales } from "./tabs/SalesTab";
import { OrderFulfilmentTab, exportOrderFulfilment } from "./tabs/OrderFulfilmentTab";
import { TaxGstTab, exportTaxGst } from "./tabs/TaxGstTab";
import { ProductMasterTab, exportProductMaster } from "./tabs/ProductMasterTab";

interface Props {
  options: ReportFilterOptions;
}

const TABS: Array<{ id: ReportTabId; label: string }> = [
  { id: "inventory", label: "Inventory" },
  { id: "sales", label: "Sales" },
  { id: "order-fulfilment", label: "Order vs. Fulfilment" },
  { id: "tax-gst", label: "Tax / GST" },
  { id: "product-master", label: "Product Master" },
];

export function ReportsShell({ options }: Props) {
  const [active, setActive] = useState<ReportTabId>("inventory");
  const [filters, setFilters] = useState<ReportFiltersState>(() => defaultFilters());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-tab row caches — exporting should work without re-running the query.
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
  const [salesRows, setSalesRows] = useState<SalesRow[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [orderFulRows, setOrderFulRows] = useState<OrderFulfilmentRow[]>([]);
  const [taxRows, setTaxRows] = useState<TaxGstRow[]>([]);
  const [taxSummary, setTaxSummary] = useState<TaxGstSummary | null>(null);
  const [productRows, setProductRows] = useState<ProductMasterRow[]>([]);

  // Switching to a date-less tab (Product Master) should set the filter UI
  // appropriately but we keep the underlying dates intact for the other tabs.
  const showDateFilter = active !== "product-master";
  const showProductFilter = active !== "product-master";

  // When switching into the Tax tab, default the date range to the current
  // financial (calendar) month if not yet customized.
  const effectiveFilters = useMemo<ReportFiltersState>(() => {
    if (active === "tax-gst" && filters.__taxDefaulted !== true) {
      const { from, to } = currentMonthRange();
      return { ...filters, dateFrom: from, dateTo: to, __taxDefaulted: true };
    }
    return filters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Persist the Tax default back once.
  useMemoOnceWhen(
    active === "tax-gst" && !filters.__taxDefaulted,
    () => setFilters(effectiveFilters),
  );

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (active === "inventory") {
        const res = await fetchInventoryReport(filters);
        if (res.error) setError(res.error);
        setInventoryRows(res.rows);
      } else if (active === "sales") {
        const res = await fetchSalesReport(filters);
        if (res.error) setError(res.error);
        setSalesRows(res.rows);
        setSalesSummary(res.summary ?? null);
      } else if (active === "order-fulfilment") {
        const res = await fetchOrderFulfilmentReport(filters);
        if (res.error) setError(res.error);
        setOrderFulRows(res.rows);
      } else if (active === "tax-gst") {
        const res = await fetchTaxGstReport(filters);
        if (res.error) setError(res.error);
        setTaxRows(res.rows);
        setTaxSummary(res.summary ?? null);
      } else if (active === "product-master") {
        const res = await fetchProductMasterReport();
        if (res.error) setError(res.error);
        setProductRows(res.rows);
      }
    } finally {
      setBusy(false);
    }
  }, [active, filters]);

  const handleExport = useCallback(
    (kind: ExportKind) => {
      if (active === "inventory") exportInventory(kind, inventoryRows, filters);
      else if (active === "sales") exportSales(kind, salesRows, salesSummary, filters);
      else if (active === "order-fulfilment")
        exportOrderFulfilment(kind, orderFulRows, filters);
      else if (active === "tax-gst") exportTaxGst(kind, taxRows, taxSummary, filters);
      else if (active === "product-master") exportProductMaster(kind, productRows);
    },
    [
      active,
      inventoryRows,
      salesRows,
      salesSummary,
      orderFulRows,
      taxRows,
      taxSummary,
      productRows,
      filters,
    ],
  );

  const rowCount =
    active === "inventory"
      ? inventoryRows.length
      : active === "sales"
        ? salesRows.length
        : active === "order-fulfilment"
          ? orderFulRows.length
          : active === "tax-gst"
            ? taxRows.length
            : productRows.length;

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              active === t.id
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <ReportFilters
        value={filters}
        onChange={setFilters}
        options={options}
        onGenerate={handleGenerate}
        onExport={handleExport}
        busy={busy}
        showProductFilter={showProductFilter}
        showDateFilter={showDateFilter}
        canExport={rowCount > 0}
      />

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Active tab */}
      {active === "inventory" && (
        <InventoryTab rows={inventoryRows} loading={busy} />
      )}
      {active === "sales" && (
        <SalesTab rows={salesRows} summary={salesSummary} loading={busy} />
      )}
      {active === "order-fulfilment" && (
        <OrderFulfilmentTab rows={orderFulRows} loading={busy} />
      )}
      {active === "tax-gst" && (
        <TaxGstTab rows={taxRows} summary={taxSummary} loading={busy} />
      )}
      {active === "product-master" && (
        <ProductMasterTab rows={productRows} loading={busy} />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultFilters(): ReportFiltersState {
  // Default: last 30 days ending today (IST).
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Kolkata" },
  );
  return {
    dateFrom: from,
    dateTo: todayStr,
    zoneId: "all",
    areaId: "all",
    distributorId: "all",
    productId: "all",
  };
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const start = new Date(ist.getFullYear(), ist.getMonth(), 1);
  const end = new Date(ist.getFullYear(), ist.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toLocaleDateString("en-CA");
  return { from: fmt(start), to: fmt(end) };
}

// A tiny "run this effect-ish callback once when the predicate is true" hook.
// (Avoids pulling in useEffect for this single deterministic transition.)
function useMemoOnceWhen(predicate: boolean, cb: () => void) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { if (predicate) cb(); }, [predicate]);
}

// Extend the type here without touching the shared types file. The flag is
// purely client-side UI state, never sent to the server.
declare module "../types" {
  interface ReportFiltersState {
    __taxDefaulted?: boolean;
  }
}
