// src/app/(dashboard)/products/page.tsx
// ---------------------------------------------------------------------------
// Product List — Server Component.
// Renders a searchable, filterable table of all SKUs for Super Admin.
// Deactivated SKUs are shown greyed-out with an "Inactive" badge.
// No delete button — deactivate only (business rule).
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getProducts, getCategoryMappings } from "./actions";
import { ProductListClient } from "./_components/ProductListClient";

export const metadata: Metadata = { title: "Products" };

// Force dynamic so search params are always fresh
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; status?: string };
}) {
  const [products, mappings] = await Promise.all([
    getProducts(),
    getCategoryMappings(),
  ]);

  // Build a map: category → first exclusive distributor name (for badge)
  const categoryDistributorMap: Record<string, { name: string; exclusive: boolean }> = {};
  for (const m of mappings) {
    if (!categoryDistributorMap[m.category]) {
      categoryDistributorMap[m.category] = {
        name: m.distributor_name ?? "Unknown",
        exclusive: m.is_exclusive,
      };
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage SKUs, pricing, and availability across all categories.
          </p>
        </div>
        <Link
          href="/dashboard/products/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" />
          New SKU
        </Link>
      </div>

      {/* ── Client-side interactive table ───────────────────────────────────── */}
      <ProductListClient
        products={products}
        categoryDistributorMap={categoryDistributorMap}
        initialSearch={searchParams.q ?? ""}
        initialCategory={searchParams.category ?? "all"}
        initialStatus={searchParams.status ?? "all"}
      />
    </div>
  );
}
