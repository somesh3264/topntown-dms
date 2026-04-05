// src/app/(dashboard)/products/[id]/page.tsx
// ---------------------------------------------------------------------------
// Edit Product page.
// Split into two main sections:
//   1. Product details form (name, category, MRP, weight, tax, active status)
//   2. Pricing Engine — tabbed interface:
//        Tab 1 — Base Price
//        Tab 2 — Distributor Overrides
//        Tab 3 — Retailer Overrides
//        Tab 4 — Discount Slabs
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  getProduct,
  getPriceOverrides,
  getDiscountSlabs,
  getActiveDistributors,
} from "../actions";
import { ProductForm } from "../_components/ProductForm";
import { PricingEngine } from "../_components/PricingEngine";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const product = await getProduct(params.id);
  return { title: product ? `Edit: ${product.name}` : "Product Not Found" };
}

export default async function EditProductPage({
  params,
}: {
  params: { id: string };
}) {
  const [product, overrides, slabs, distributors] = await Promise.all([
    getProduct(params.id),
    getPriceOverrides(params.id),
    getDiscountSlabs(params.id),
    getActiveDistributors(),
  ]);

  if (!product) notFound();

  const distributorOverrides = overrides.filter((o) => o.tier === "distributor");
  const retailerOverrides = overrides.filter((o) => o.tier === "retailer");

  return (
    <div className="max-w-5xl space-y-8">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <Link
        href="/dashboard/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Products
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
            {product.is_active ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {product.category} · SKU ID: {product.id}
          </p>
        </div>
      </div>

      {/* ── Section 1: Product Details ──────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold mb-5">Product Details</h2>
        <ProductForm mode="edit" product={product} />
      </section>

      {/* ── Section 2: Pricing Engine ───────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-base font-semibold">Pricing Engine</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Override hierarchy: Retailer price &gt; Distributor price &gt; Base price
          </p>
        </div>
        <PricingEngine
          product={product}
          distributorOverrides={distributorOverrides}
          retailerOverrides={retailerOverrides}
          discountSlabs={slabs}
          distributors={distributors}
        />
      </section>
    </div>
  );
}
