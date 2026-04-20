// src/lib/orders.ts
// ---------------------------------------------------------------------------
// Shared order helpers used by both the public /api/orders/submit route
// (distributor-initiated orders from the app) and the dashboard server
// actions (super_admin / sales_person placing orders on a distributor's
// behalf). Keeping one source of truth avoids the two paths drifting — the
// most dangerous kind of drift here is price calculation, which must always
// follow the same 3-step hierarchy:
//
//   Step A — Party-specific price override   (price_overrides for the tier)
//   Step B — Product's tier column            (distributor_price / ss_price / retailer_price)
//   Step C — MRP fallback                     (products.mrp)
//
// Callers pass in the *order-placing party's* user_id (the distributor, not
// the caller); this is what makes the override lookup consistent whether
// the order comes from the distributor's app or is entered for them by a
// dashboard user.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Tier → price-column + override-tier mapping ─────────────────────────────

export type OrderPlacingRole = "distributor" | "super_stockist" | "retailer";

export const ROLE_PRICING_MAP: Record<
  OrderPlacingRole,
  { priceTierColumn: string; overrideTier: string }
> = {
  super_stockist: { priceTierColumn: "ss_price", overrideTier: "super_stockist" },
  distributor: { priceTierColumn: "distributor_price", overrideTier: "distributor" },
  retailer: { priceTierColumn: "retailer_price", overrideTier: "retailer" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RequestedOrderItem {
  productId: string;
  quantity: number;
}

export interface ResolvedOrderItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  /** Internal audit field; strip before inserting into order_items. */
  price_source: "override" | "tier_price" | "mrp_fallback";
}

export type ResolvePricesResult =
  | { ok: true; items: ResolvedOrderItem[]; totalAmount: number }
  | {
      ok: false;
      error:
        | { code: "PRODUCTS_FETCH"; message: string }
        | { code: "PRODUCT_NOT_FOUND"; productId: string }
        | { code: "PRODUCT_INACTIVE"; productId: string; productName: string };
    };

// ─── resolveUnitPrices ────────────────────────────────────────────────────────

/**
 * Resolve unit prices for a list of (productId, quantity) items.
 *
 * @param admin        Service-role Supabase client (bypasses RLS so we can
 *                     read price_overrides and inactive-flag atomically).
 * @param orderPartyId user_id of the party the order is FOR (the distributor
 *                     whose price_overrides apply). NOT the dashboard user.
 * @param role         The pricing tier to use ("distributor" for all
 *                     dashboard-placed orders since they're always for a
 *                     distributor).
 * @param requested    Raw items from the caller.
 *
 * Returns either the fully-resolved list + total, or a structured error.
 * Errors come back as data rather than exceptions because every single one
 * of them has a user-facing message; surfacing them as throws would force
 * every caller to implement the same try/catch.
 */
export async function resolveOrderPrices(
  admin: SupabaseClient<any>,
  orderPartyId: string,
  role: OrderPlacingRole,
  requested: RequestedOrderItem[],
): Promise<ResolvePricesResult> {
  if (!requested || requested.length === 0) {
    return { ok: true, items: [], totalAmount: 0 };
  }

  const pricingConfig = ROLE_PRICING_MAP[role];
  const productIds = requested.map((i) => i.productId);
  const today = new Date().toISOString().slice(0, 10);

  // Batch-fetch products so we can check active state + read all four price
  // columns (distributor_price / ss_price / retailer_price / mrp) once.
  const { data: products, error: productsErr } = await admin
    .from("products")
    .select("id, name, is_active, mrp, distributor_price, ss_price, retailer_price")
    .in("id", productIds);

  if (productsErr || !products) {
    return {
      ok: false,
      error: {
        code: "PRODUCTS_FETCH",
        message: productsErr?.message ?? "Could not load products.",
      },
    };
  }

  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

  // Validate every requested product exists and is orderable.
  for (const item of requested) {
    const product = productMap.get(item.productId);
    if (!product) {
      return {
        ok: false,
        error: { code: "PRODUCT_NOT_FOUND", productId: item.productId },
      };
    }
    if (!product.is_active) {
      return {
        ok: false,
        error: {
          code: "PRODUCT_INACTIVE",
          productId: item.productId,
          productName: product.name,
        },
      };
    }
  }

  // Step A — per-party overrides. Newest-first; we keep the most recent per
  // product (the DB already orders them desc, so first-wins is the newest).
  const { data: overrides } = await admin
    .from("price_overrides")
    .select("product_id, price")
    .eq("user_id", orderPartyId)
    .eq("tier", pricingConfig.overrideTier as any)
    .in("product_id", productIds as any)
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });

  const overrideMap = new Map<string, number>();
  for (const o of (overrides ?? []) as any[]) {
    if (!overrideMap.has(o.product_id)) overrideMap.set(o.product_id, o.price);
  }

  // Steps B + C — tier column, then MRP.
  const items: ResolvedOrderItem[] = requested.map((item) => {
    const product = productMap.get(item.productId)!;
    const overridePrice = overrideMap.get(item.productId);
    const tierPrice: number | null = product[pricingConfig.priceTierColumn] ?? null;
    const mrpPrice: number = product.mrp;
    const unitPrice = overridePrice ?? tierPrice ?? mrpPrice;

    return {
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: unitPrice,
      price_source:
        overridePrice != null
          ? "override"
          : tierPrice != null
            ? "tier_price"
            : "mrp_fallback",
    };
  });

  const totalAmount = parseFloat(
    items.reduce((s, i) => s + i.quantity * i.unit_price, 0).toFixed(2),
  );

  return { ok: true, items, totalAmount };
}

// ─── Lightweight validators reused by both order-entry paths ─────────────────

/**
 * Validate the raw item list structure. Returns a human-readable message on
 * failure, or `null` if the input is well-formed.
 */
export function validateRequestedItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return "Order must contain at least one item.";
  }
  for (const item of items as any[]) {
    if (!item || typeof item !== "object") {
      return "Every item must be an object with productId + quantity.";
    }
    if (!item.productId || typeof item.productId !== "string") {
      return "Every item must have a valid productId.";
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return `Quantity for product ${item.productId} must be a positive integer.`;
    }
  }
  return null;
}
