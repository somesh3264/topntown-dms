// src/app/(dashboard)/dashboard/pricing/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the Pricing Margin Management page.
//
// Exports:
//   getPricingMargins()             — fetch all 4 tier rows, sorted by TIER_ORDER
//   updatePricingMargin(tier, pct)  — validate [0,500], update DB, revalidate
//   recalculateAllPrices()          — call fn_recalculate_all_prices() via RPC,
//                                     revalidate products + pricing, return count
//
// Pure types/utils (previewPricing, TIER_META, TIER_ORDER, types) live in
// ./pricing-utils.ts — import from there for use in Client Components.
//
// Table: pricing_margins  (id, tier, margin_pct, base_tier, description, updated_at)
// Stored fn: fn_recalculate_all_prices() → integer (rows updated)
//
// Access: super_admin only (enforced by RLS on pricing_margins table).
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TIER_ORDER } from "./pricing-utils";
import type { PricingTierKey, PricingMargin } from "./pricing-utils";
export type { PricingTierKey, PricingMargin } from "./pricing-utils";

// ─── Internal result type ─────────────────────────────────────────────────────

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

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

// previewPricing lives in ./pricing-utils.ts (not a server action — pure function)
