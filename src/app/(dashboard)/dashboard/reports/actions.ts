// src/app/(dashboard)/dashboard/reports/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the Super Admin reports module.
//
// Each action:
//   1. Resolves the caller's scope (super_admin / SS / SP / distributor).
//   2. Builds a Supabase query scoped to that role's distributor set.
//   3. Applies the shared filters (date range, zone, area, distributor, SKU).
//   4. Returns rows + an optional summary in a uniform envelope.
//
// No query returns row objects the client shouldn't see — the scope filter
// is always applied server-side.
// ---------------------------------------------------------------------------

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyDistributorScope,
  resolveReportScope,
} from "./rbac";
import type {
  InventoryRow,
  OrderFulfilmentRow,
  ProductMasterRow,
  ReportFilterOptions,
  ReportFiltersState,
  ReportResponse,
  SalesRow,
  SalesSummary,
  TaxGstRow,
  TaxGstSummary,
} from "./types";

// ─── Lookup options for the filter bar ────────────────────────────────────────

export async function fetchFilterOptions(): Promise<ReportFilterOptions> {
  const supabase = createClient();
  const scope = await resolveReportScope(supabase);
  const admin = createAdminClient();

  const [zonesRes, areasRes, productsRes] = await Promise.all([
    admin.from("zones").select("id, name").order("name"),
    admin.from("areas").select("id, name, zone_id").order("name"),
    admin.from("products").select("id, name").eq("is_active", true).order("name"),
  ]);

  // Distributors — scoped by role.
  let distQuery = admin
    .from("profiles")
    .select("id, full_name, area_id")
    .eq("role", "distributor")
    .eq("is_active", true)
    .order("full_name");
  distQuery = applyDistributorScope(distQuery, scope, "id");

  const { data: dists } = await distQuery;

  return {
    zones: (zonesRes.data ?? []).map((z) => ({
      id: (z as { id: string }).id,
      label: (z as { name: string }).name,
    })),
    areas: (areasRes.data ?? []).map((a) => ({
      id: (a as { id: string }).id,
      label: (a as { name: string }).name,
      parentId: (a as { zone_id: string | null }).zone_id,
    })),
    distributors: (dists ?? []).map((d) => ({
      id: (d as { id: string }).id,
      label: (d as { full_name: string | null }).full_name ?? "(unnamed)",
      parentId: (d as { area_id: string | null }).area_id,
    })),
    products: (productsRes.data ?? []).map((p) => ({
      id: (p as { id: string }).id,
      label: (p as { name: string }).name,
    })),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIstDateString(iso: string): string {
  const d = new Date(iso);
  // en-CA gives yyyy-MM-dd
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Returns ISO timestamps for the inclusive date range interpreted in IST. */
function istDayBounds(dateFrom: string, dateTo: string): { fromIso: string; toIso: string } {
  // Start of dateFrom 00:00 IST, end of dateTo 23:59:59.999 IST.
  const fromIso = new Date(`${dateFrom}T00:00:00+05:30`).toISOString();
  const toIso = new Date(`${dateTo}T23:59:59.999+05:30`).toISOString();
  return { fromIso, toIso };
}

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── 1. INVENTORY REPORT ──────────────────────────────────────────────────────
//
// stock_allocations ← bills (for date scope) and profile/product joins.
// Columns: Distributor | Zone | Area | Product | Allocated | Delivered | Remaining | Fill %

export async function fetchInventoryReport(
  filters: ReportFiltersState,
): Promise<ReportResponse<InventoryRow>> {
  try {
    const supabase = createClient();
    const scope = await resolveReportScope(supabase);
    const admin = createAdminClient();

    const { fromIso, toIso } = istDayBounds(filters.dateFrom, filters.dateTo);

    let q = admin
      .from("stock_allocations")
      .select(
        `
          id,
          allocated_qty,
          delivered_qty,
          distributor_id,
          product_id,
          bills!inner ( bill_date ),
          profiles:distributor_id (
            full_name,
            zone_id,
            area_id,
            zones:zone_id ( name ),
            areas:area_id ( name )
          ),
          products:product_id ( name )
        `,
      )
      .gte("bills.bill_date", filters.dateFrom)
      .lte("bills.bill_date", filters.dateTo);

    q = applyDistributorScope(q, scope, "distributor_id");

    if (filters.distributorId !== "all") q = q.eq("distributor_id", filters.distributorId);
    if (filters.productId !== "all") q = q.eq("product_id", filters.productId);

    const { data, error } = await q;
    if (error) throw error;

    // Aggregate by (distributor, product).
    const map = new Map<string, InventoryRow>();
    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const distributorId = raw.distributor_id as string;
      const productId = raw.product_id as string;
      const key = `${distributorId}|${productId}`;

      const profile = (raw.profiles ?? {}) as {
        full_name?: string | null;
        zones?: { name?: string | null } | null;
        areas?: { name?: string | null } | null;
        zone_id?: string | null;
        area_id?: string | null;
      };
      const product = (raw.products ?? {}) as { name?: string | null };

      // Filter by zone/area at the app layer (post-join) — simpler than nested filters.
      if (filters.zoneId !== "all" && profile.zone_id !== filters.zoneId) continue;
      if (filters.areaId !== "all" && profile.area_id !== filters.areaId) continue;

      const allocated = num(raw.allocated_qty);
      const delivered = num(raw.delivered_qty);

      const existing = map.get(key);
      if (existing) {
        existing.allocated += allocated;
        existing.delivered += delivered;
      } else {
        map.set(key, {
          distributorId,
          distributor: profile.full_name ?? "(unnamed)",
          zone: profile.zones?.name ?? "-",
          area: profile.areas?.name ?? "-",
          productId,
          product: product.name ?? "-",
          allocated,
          delivered,
          remaining: 0,
          fillRatePct: 0,
        });
      }
    }

    const rows = Array.from(map.values()).map((r) => {
      r.remaining = Math.max(0, r.allocated - r.delivered);
      r.fillRatePct = r.allocated > 0 ? (r.delivered / r.allocated) * 100 : 0;
      return r;
    });
    rows.sort(
      (a, b) =>
        a.distributor.localeCompare(b.distributor) || a.product.localeCompare(b.product),
    );

    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 2. SALES REPORT ──────────────────────────────────────────────────────────

export async function fetchSalesReport(
  filters: ReportFiltersState,
): Promise<ReportResponse<SalesRow, SalesSummary>> {
  try {
    const supabase = createClient();
    const scope = await resolveReportScope(supabase);
    const admin = createAdminClient();

    const { fromIso, toIso } = istDayBounds(filters.dateFrom, filters.dateTo);

    let q = admin
      .from("delivery_items")
      .select(
        `
          quantity,
          unit_price,
          deliveries!inner (
            id,
            delivered_at,
            distributor_id,
            store_id,
            stores:store_id ( name ),
            profiles:distributor_id (
              full_name,
              zone_id,
              area_id,
              zones:zone_id ( name ),
              areas:area_id ( name )
            )
          ),
          products:product_id ( id, name )
        `,
      )
      .gte("deliveries.delivered_at", fromIso)
      .lte("deliveries.delivered_at", toIso);

    q = applyDistributorScope(q, scope, "deliveries.distributor_id");

    if (filters.distributorId !== "all") {
      q = q.eq("deliveries.distributor_id", filters.distributorId);
    }
    if (filters.productId !== "all") q = q.eq("product_id", filters.productId);

    const { data, error } = await q;
    if (error) throw error;

    const rows: SalesRow[] = [];
    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const delivery = (raw.deliveries ?? {}) as {
        id?: string;
        delivered_at?: string;
        distributor_id?: string;
        store_id?: string;
        stores?: { name?: string | null } | null;
        profiles?: {
          full_name?: string | null;
          zone_id?: string | null;
          area_id?: string | null;
          zones?: { name?: string | null } | null;
          areas?: { name?: string | null } | null;
        } | null;
      };
      const product = (raw.products ?? {}) as { id?: string; name?: string | null };
      const dp = delivery.profiles ?? {};

      if (filters.zoneId !== "all" && dp.zone_id !== filters.zoneId) continue;
      if (filters.areaId !== "all" && dp.area_id !== filters.areaId) continue;

      const qty = num(raw.quantity);
      const unitPrice = num(raw.unit_price);
      const deliveredAt = delivery.delivered_at ?? "";

      rows.push({
        deliveredAt,
        date: deliveredAt ? toIstDateString(deliveredAt) : "-",
        zone: dp.zones?.name ?? "-",
        area: dp.areas?.name ?? "-",
        distributorId: delivery.distributor_id ?? "",
        distributor: dp.full_name ?? "(unnamed)",
        storeId: delivery.store_id ?? "",
        store: delivery.stores?.name ?? "-",
        productId: product.id ?? "",
        product: product.name ?? "-",
        qty,
        unitPrice,
        total: qty * unitPrice,
      });
    }
    rows.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));

    const storesSet = new Set(rows.map((r) => r.storeId));
    const deliveriesSet = new Set(
      rows.map((r) => `${r.distributorId}|${r.storeId}|${r.deliveredAt}`),
    );

    const summary: SalesSummary = {
      totalDeliveries: deliveriesSet.size,
      totalRevenue: rows.reduce((a, r) => a + r.total, 0),
      totalUnits: rows.reduce((a, r) => a + r.qty, 0),
      uniqueStores: storesSet.size,
    };

    return { rows, summary };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 3. ORDER vs. FULFILMENT ─────────────────────────────────────────────────
//
// Compares:
//   - Ordered  = orders.order_items.quantity (or order total)
//   - Allocated = stock_allocations.allocated_qty
//   - Delivered = stock_allocations.delivered_qty (authoritative)
// Grouped by (distributor, product).

export async function fetchOrderFulfilmentReport(
  filters: ReportFiltersState,
): Promise<ReportResponse<OrderFulfilmentRow>> {
  try {
    const supabase = createClient();
    const scope = await resolveReportScope(supabase);
    const admin = createAdminClient();

    // Ordered (from order_items + orders within the date window).
    let orderedQ = admin
      .from("order_items")
      .select(
        `
          quantity,
          product_id,
          orders!inner ( id, distributor_id, order_date ),
          products:product_id ( name )
        `,
      )
      .gte("orders.order_date", filters.dateFrom)
      .lte("orders.order_date", filters.dateTo);
    orderedQ = applyDistributorScope(orderedQ, scope, "orders.distributor_id");
    if (filters.distributorId !== "all") orderedQ = orderedQ.eq("orders.distributor_id", filters.distributorId);
    if (filters.productId !== "all") orderedQ = orderedQ.eq("product_id", filters.productId);

    // Allocated + delivered (from stock_allocations joined through bills for date scope).
    let allocQ = admin
      .from("stock_allocations")
      .select(
        `
          allocated_qty,
          delivered_qty,
          product_id,
          distributor_id,
          bills!inner ( bill_date ),
          profiles:distributor_id (
            full_name,
            zone_id,
            area_id,
            zones:zone_id ( name ),
            areas:area_id ( name )
          ),
          products:product_id ( name )
        `,
      )
      .gte("bills.bill_date", filters.dateFrom)
      .lte("bills.bill_date", filters.dateTo);
    allocQ = applyDistributorScope(allocQ, scope, "distributor_id");
    if (filters.distributorId !== "all") allocQ = allocQ.eq("distributor_id", filters.distributorId);
    if (filters.productId !== "all") allocQ = allocQ.eq("product_id", filters.productId);

    const [orderedRes, allocRes] = await Promise.all([orderedQ, allocQ]);
    if (orderedRes.error) throw orderedRes.error;
    if (allocRes.error) throw allocRes.error;

    const map = new Map<string, OrderFulfilmentRow>();

    // Seed with allocation rows — they carry the zone/area metadata.
    for (const raw of (allocRes.data ?? []) as Array<Record<string, unknown>>) {
      const distributorId = raw.distributor_id as string;
      const productId = raw.product_id as string;
      const key = `${distributorId}|${productId}`;

      const profile = (raw.profiles ?? {}) as {
        full_name?: string | null;
        zone_id?: string | null;
        area_id?: string | null;
        zones?: { name?: string | null } | null;
        areas?: { name?: string | null } | null;
      };
      const product = (raw.products ?? {}) as { name?: string | null };

      if (filters.zoneId !== "all" && profile.zone_id !== filters.zoneId) continue;
      if (filters.areaId !== "all" && profile.area_id !== filters.areaId) continue;

      const existing = map.get(key);
      const allocated = num(raw.allocated_qty);
      const delivered = num(raw.delivered_qty);

      if (existing) {
        existing.allocated += allocated;
        existing.delivered += delivered;
      } else {
        map.set(key, {
          distributorId,
          distributor: profile.full_name ?? "(unnamed)",
          zone: profile.zones?.name ?? "-",
          area: profile.areas?.name ?? "-",
          productId,
          product: product.name ?? "-",
          ordered: 0,
          allocated,
          delivered,
          variance: 0,
          variancePct: 0,
        });
      }
    }

    // Fold in ordered quantities.
    for (const raw of (orderedRes.data ?? []) as Array<Record<string, unknown>>) {
      const order = (raw.orders ?? {}) as { distributor_id?: string };
      const distributorId = order.distributor_id ?? "";
      const productId = raw.product_id as string;
      const key = `${distributorId}|${productId}`;
      const qty = num(raw.quantity);

      const existing = map.get(key);
      if (existing) {
        existing.ordered += qty;
      } else {
        // If we only have an order (no allocation yet — e.g. cancellations), synthesize.
        const product = (raw.products ?? {}) as { name?: string | null };
        map.set(key, {
          distributorId,
          distributor: "(no allocation)",
          zone: "-",
          area: "-",
          productId,
          product: product.name ?? "-",
          ordered: qty,
          allocated: 0,
          delivered: 0,
          variance: 0,
          variancePct: 0,
        });
      }
    }

    const rows = Array.from(map.values()).map((r) => {
      r.variance = r.delivered - r.ordered;
      r.variancePct = r.ordered > 0 ? (r.delivered / r.ordered) * 100 : 0;
      return r;
    });
    rows.sort(
      (a, b) =>
        a.distributor.localeCompare(b.distributor) || a.product.localeCompare(b.product),
    );

    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 4. TAX / GST REPORT ─────────────────────────────────────────────────────

export async function fetchTaxGstReport(
  filters: ReportFiltersState,
): Promise<ReportResponse<TaxGstRow, TaxGstSummary>> {
  try {
    const supabase = createClient();
    const scope = await resolveReportScope(supabase);
    const admin = createAdminClient();

    let q = admin
      .from("bill_items")
      .select(
        `
          allocated_qty,
          unit_price,
          tax_amount,
          product_id,
          bills!inner (
            id,
            bill_number,
            bill_date,
            distributor_id,
            profiles:distributor_id (
              full_name,
              zone_id,
              area_id
            )
          ),
          products:product_id ( id, name, tax_rate )
        `,
      )
      .gte("bills.bill_date", filters.dateFrom)
      .lte("bills.bill_date", filters.dateTo);

    q = applyDistributorScope(q, scope, "bills.distributor_id");
    if (filters.distributorId !== "all") q = q.eq("bills.distributor_id", filters.distributorId);
    if (filters.productId !== "all") q = q.eq("product_id", filters.productId);

    const { data, error } = await q;
    if (error) throw error;

    const rows: TaxGstRow[] = [];
    const billSet = new Set<string>();

    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const bill = (raw.bills ?? {}) as {
        id?: string;
        bill_number?: string;
        bill_date?: string;
        distributor_id?: string;
        profiles?: {
          full_name?: string | null;
          zone_id?: string | null;
          area_id?: string | null;
        } | null;
      };
      const product = (raw.products ?? {}) as {
        id?: string;
        name?: string | null;
        tax_rate?: number | string | null;
      };
      const bp = bill.profiles ?? {};

      if (filters.zoneId !== "all" && bp.zone_id !== filters.zoneId) continue;
      if (filters.areaId !== "all" && bp.area_id !== filters.areaId) continue;

      const qty = num(raw.allocated_qty);
      const unitPrice = num(raw.unit_price);
      const taxableValue = qty * unitPrice;
      const taxAmount = num(raw.tax_amount);

      rows.push({
        billDate: bill.bill_date ?? "-",
        billNumber: bill.bill_number ?? "-",
        distributorId: bill.distributor_id ?? "",
        distributor: bp.full_name ?? "(unnamed)",
        productId: product.id ?? "",
        product: product.name ?? "-",
        taxRate: num(product.tax_rate),
        taxableValue,
        taxAmount,
        total: taxableValue + taxAmount,
      });
      if (bill.id) billSet.add(bill.id);
    }
    rows.sort((a, b) => b.billDate.localeCompare(a.billDate));

    const summary: TaxGstSummary = {
      taxableValue: rows.reduce((a, r) => a + r.taxableValue, 0),
      taxAmount: rows.reduce((a, r) => a + r.taxAmount, 0),
      grandTotal: rows.reduce((a, r) => a + r.total, 0),
      billCount: billSet.size,
    };

    return { rows, summary };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 5. PRODUCT MASTER (read-only SKU listing) ───────────────────────────────

export async function fetchProductMasterReport(): Promise<ReportResponse<ProductMasterRow>> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("products")
      .select("id, name, category, mrp, weight, tax_rate, is_active")
      .order("name");

    if (error) throw error;

    const rows: ProductMasterRow[] = (data ?? []).map((p) => {
      const r = p as {
        id: string;
        name: string;
        category: string | null;
        mrp: number | string;
        weight: string | null;
        tax_rate: number | string;
        is_active: boolean;
      };
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        mrp: num(r.mrp),
        weight: r.weight,
        taxRate: num(r.tax_rate),
        isActive: r.is_active,
      };
    });

    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}
