// src/app/(dashboard)/products/new/page.tsx
// ---------------------------------------------------------------------------
// Create a new product SKU.
// Server Component wrapper + client ProductForm component.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductForm } from "../_components/ProductForm";

export const metadata: Metadata = { title: "New Product" };

export default function NewProductPage() {
  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <Link
        href="/dashboard/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Products
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">New SKU</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new product SKU. You can set pricing overrides after saving.
        </p>
      </div>

      {/* ── Form ────────────────────────────────────────────────────────────── */}
      <ProductForm mode="create" />
    </div>
  );
}
