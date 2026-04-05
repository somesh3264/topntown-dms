// src/app/(dashboard)/master/category-mapping/page.tsx
// ---------------------------------------------------------------------------
// Category-to-Distributor Exclusivity Mapping (v1.1).
//
// Shows each product category with its assigned exclusive/shared distributor.
// Super Admin can:
//   • Assign a distributor to a category (exclusive or shared).
//   • Toggle exclusivity.
//   • Remove an assignment.
//
// Business rule: "Exclusive" means only this distributor can stock
// products from this category.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCategoryMappings, getActiveDistributors } from "../../products/actions";
import { CategoryMappingClient } from "./_components/CategoryMappingClient";

export const metadata: Metadata = { title: "Category Distributor Mapping" };
export const dynamic = "force-dynamic";

export default async function CategoryMappingPage() {
  const [mappings, distributors] = await Promise.all([
    getCategoryMappings(),
    getActiveDistributors(),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <Link
        href="/dashboard/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Products
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Category → Distributor Mapping
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign distributors to product categories. Mark as{" "}
          <strong>Exclusive</strong> to restrict stocking rights to a single
          distributor.
        </p>
      </div>

      {/* ── Client table ────────────────────────────────────────────────────── */}
      <CategoryMappingClient
        mappings={mappings}
        distributors={distributors}
      />
    </div>
  );
}
