// src/app/(dashboard)/dashboard/pricing/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the Pricing Margin Management page.
//
// Exports:
//   getPricingMargins()             — fetch all 4 tier rows, sorted by TIER_ORDER
//   updatePricingMargin(tier, pct)  — validate [0,500], update DB, revalidate
//   recalculateAllPrices()          — call fn_recalculate_all_prices() via RPC,
//                                     revalidate products + pricing, return count
//   previewPricing(fsp, margins?)   — pure calc, no DB write
//
// Table: pricing_margins  (id, tier, margin_pct, base_tier, description, updated_at)
// Stored fn: fn_recalculate_all_prices() → integer (rows updated)
//
// Access: super_admin only (enforced by RLS on pricing_margins table).
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PricingTierKey = "super_stockist" | "distributor" | "retailer" | "mrp";

export interface PricingMargin {
  id: string;
  tier: PricingTierKey;
  margin_pct: number;
  base_tier: string | null;
  description: string | null;
  updated_at: string;
}

export interface PricingPreview {
  fsp: number;
  ss_price: number;
  distributor_price: number;
  retailer_price: number;
  mrp: number;
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Ordered display config (used by the client component) ─────────────────────

export const TIER_META: Record<
  PricingTierKey,
  { label: string; basePriceLabel: string; color: string }
> = {
  super_stockist: {
    label: "Super Stockist",
    basePriceLabel: "Factory Selling Price",
    color: "blue",
  },
  distributor: {
    label: "Distributor",
    basePriceLabel: "Factory Selling Price",
    color: "violet",
  },
  retailer: {
    label: "Retailer",
    basePriceLabel: "SS Purchase Price",
    color: "orange",
  },
  mrp: {
    label: "MRP (Consumer)",
    basePriceLabel: "Retailer Price",
    color: "red",
  },
};

export const TIER_ORDER: PricingTierKey[] = [
  "super_stockist",
  "distributor",
  "retailer",
  "mrp",
];

// ─── Server Actions ───────────────────────────────────────────────────────────

/**
 * Fetch all four pricing margin rows, ordered by TIER_ORDER.
 */
export async function getPricingMargins(): Promise<PricingMargin[]> {
  const supabase = createClient();

  const { data, error } = await (supabase as any)
    .from("pricing_margins")
    .select("id, tier, margin_pct, base_tier, description, updated_at")
    .order("tier");

  if (error) {
    console.error("[getPricingMargins]", error.message);
    return [];
  }

  // Return in canonical display order
  const map = new Map((data ?? []).map((r: any) => [r.tier, r as PricingMargin]));
  return TIER_ORDER.map((t) => map.get(t)).filter(Boolean) as PricingMargin[];
}

/**
 * Update the margin % for a single tier.
 * Validates that pct is in [0, 500].
 */
export async function updatePricingMargin(
  tier: PricingTierKey,
  marginPct: number
): Promise<ActionResult> {
  if (isNaN(marginPct) || marginPct < 0 || marginPct > 500) {
    return { success: false, error: "Margin must be between 0% and 500%." };
  }

  const supabase = createClient();

  const { error } = await (supabase as any)
    .from("pricing_margins")
    .update({
      margin_pct: parseFloat(marginPct.toFixed(3)),
      updated_at: new Date().toISOString(),
    })
    .eq("tier", tier);

  if (error) {
    console.error("[updatePricingMargin]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/pricing");
  return { success: true };
}

/**
 * Calls the fn_recalculate_all_prices() Postgres function via RPC.
 * Returns the number of products updated.
 * Revalidates the products list so cached data refreshes.
 */
export async function recalculateAllPrices(): Promise<ActionResult<{ count: number }>> {
  const supabase = createClient();

  const { data, error } = await (supabase as any).rpc("fn_recalculate_all_prices");

  if (error) {
    console.error("[recalculateAllPrices]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard/pricing");

  return { success: true, data: { count: (data as number) ?? 0 } };
}

/**
 * Pure synchronous calculation — no DB reads or writes.
 *
 * Price chain (mirrors fn_auto_price_recalc trigger):
 *   ss_price          = fsp           × (1 + ss%   / 100)
 *   distributor_price = fsp           × (1 + dist% / 100)
 *   retailer_price    = ss_price      × (1 + retail% / 100)
 *   mrp               = retailer_price × (1 + mrp%  / 100)
 *
 * @param fsp     Factory Selling Price
 * @param margins Margin percentages keyed by PricingTierKey.  When omitted
 *                all margins default to 0 so callers can render a skeleton
 *                preview before the DB fetch completes.
 */
export function previewPricing(
  fsp: number,
  margins?: Partial<Record<PricingTierKey, number>>
): PricingPreview {
  const m = margins ?? {};
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const ss_price          = round2(fsp            * (1 + (m.super_stockist ?? 0) / 100));
  const distributor_price = round2(fsp            * (1 + (m.distributor    ?? 0) / 100));
  const retailer_price    = round2(ss_price        * (1 + (m.retailer       ?? 0) / 100));
  const mrp               = round2(retailer_price  * (1 + (m.mrp            ?? 0) / 100));

  return { fsp, ss_price, distributor_price, retailer_price, mrp };
}
