// src/app/(dashboard)/dashboard/reports/types.ts
// ---------------------------------------------------------------------------
// Shared types for the Super Admin reports module.
// ---------------------------------------------------------------------------

export type ReportTabId =
  | "inventory"
  | "sales"
  | "order-fulfilment"
  | "tax-gst"
  | "product-master";

export interface ReportFiltersState {
  /** ISO yyyy-MM-dd inclusive. */
  dateFrom: string;
  /** ISO yyyy-MM-dd inclusive. */
  dateTo: string;
  zoneId: string | "all";
  areaId: string | "all";
  distributorId: string | "all";
  productId: string | "all";
}

export interface LookupOption {
  id: string;
  label: string;
  /** Optional parent id used to cascade (e.g. areas filtered by zone). */
  parentId?: string | null;
}

export interface ReportFilterOptions {
  zones: LookupOption[];
  areas: LookupOption[];          // area.parentId = zone_id
  distributors: LookupOption[];   // distributor.parentId = area_id
  products: LookupOption[];
}

// ─── Row shapes returned by the server actions ────────────────────────────────

export interface InventoryRow {
  distributorId: string;
  distributor: string;
  zone: string;
  area: string;
  productId: string;
  product: string;
  allocated: number;
  delivered: number;
  remaining: number;
  fillRatePct: number;        // 0..100
}

export interface SalesRow {
  deliveredAt: string;        // ISO timestamp
  date: string;               // yyyy-MM-dd (IST) — convenient for group-by
  zone: string;
  area: string;
  distributorId: string;
  distributor: string;
  storeId: string;
  store: string;
  productId: string;
  product: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export type SalesGroupBy = "none" | "date" | "distributor" | "store" | "product";

export interface SalesSummary {
  totalDeliveries: number;
  totalRevenue: number;
  totalUnits: number;
  uniqueStores: number;
}

export interface OrderFulfilmentRow {
  distributorId: string;
  distributor: string;
  zone: string;
  area: string;
  productId: string;
  product: string;
  ordered: number;
  allocated: number;
  delivered: number;
  /** delivered − ordered (negative = under-fulfilled). */
  variance: number;
  /** delivered / ordered * 100, 0..infinity. */
  variancePct: number;
}

export interface TaxGstRow {
  billDate: string;           // yyyy-MM-dd
  billNumber: string;
  distributorId: string;
  distributor: string;
  productId: string;
  product: string;
  taxRate: number;            // %
  taxableValue: number;       // qty * unit_price
  taxAmount: number;
  total: number;              // taxable + tax
}

export interface TaxGstSummary {
  taxableValue: number;
  taxAmount: number;
  grandTotal: number;
  billCount: number;
}

export interface ProductMasterRow {
  id: string;
  name: string;
  category: string | null;
  mrp: number;
  weight: string | null;
  taxRate: number;
  isActive: boolean;
}

// ─── Report responses (uniform envelope) ──────────────────────────────────────

export interface ReportResponse<TRow, TSummary = undefined> {
  rows: TRow[];
  summary?: TSummary;
  error?: string;
}
