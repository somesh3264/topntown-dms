// src/app/(dashboard)/dashboard/pricing/pricing-utils.ts
// ---------------------------------------------------------------------------
// Pure (non-server) types, constants and helpers for the Pricing module.
// Safe to import in both Server Components and Client Components.
// ---------------------------------------------------------------------------

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

// ─── Display config ───────────────────────────────────────────────────────────

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

// ─── Pure calculation ─────────────────────────────────────────────────────────

/**
 * Pure synchronous calculation — no DB reads or writes.
 *
 * Price chain (mirrors fn_auto_price_recalc trigger):
 *   ss_price          = fsp            × (1 + ss%    / 100)
 *   distributor_price = fsp            × (1 + dist%  / 100)
 *   retailer_price    = ss_price       × (1 + retail%/ 100)
 *   mrp               = retailer_price × (1 + mrp%   / 100)
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
