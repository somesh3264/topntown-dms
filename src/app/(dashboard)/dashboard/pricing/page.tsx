// src/app/(dashboard)/dashboard/pricing/page.tsx
// ---------------------------------------------------------------------------
// Pricing Margin Management — Server Component (super_admin only).
//
// Fetches current margin rows server-side and passes them to the client
// component.  The sidebar already gates this route for super_admin; RLS
// on pricing_margins additionally blocks any direct DB access.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { getPricingMargins } from "./actions";
import { PricingMarginsClient } from "./_components/PricingMarginsClient";

export const metadata: Metadata = {
  title: "Pricing Margins | TopNTown DMS",
};

export default async function PricingPage() {
  const margins = await getPricingMargins();

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Pricing Margin Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure global markup percentages for each tier in the distribution chain.
          Changes take effect for new products immediately; use{" "}
          <span className="font-medium text-foreground">Recalculate All Products</span> to
          propagate updates to existing catalogue items.
        </p>
      </div>

      {/* Pricing chain info banner */}
      <div className="mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span className="font-semibold text-foreground text-sm">Pricing Chain:</span>
        <span>FSP</span>
        <span className="text-muted-foreground/60">→</span>
        <span>SS Price <span className="text-blue-600">(FSP + SS%)</span></span>
        <span className="text-muted-foreground/60">→</span>
        <span>Distributor <span className="text-violet-600">(FSP + Dist%)</span></span>
        <span className="text-muted-foreground/60">→</span>
        <span>Retailer <span className="text-orange-600">(SS Price + Retailer%)</span></span>
        <span className="text-muted-foreground/60">→</span>
        <span>MRP <span className="text-red-600">(Retailer + MRP%)</span></span>
      </div>

      {margins.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No pricing margins found. Run the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">pricing_schema_v2.sql</code>{" "}
            migration to seed the default values.
          </p>
        </div>
      ) : (
        <PricingMarginsClient initialMargins={margins} />
      )}
    </div>
  );
}
