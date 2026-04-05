// src/app/(dashboard)/products/_components/ProductListClient.tsx
// ---------------------------------------------------------------------------
// Client Component — owns search, category filter, and status toggle state.
// Renders the product table with interactive controls.
// ---------------------------------------------------------------------------

"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { Search, Pencil, PowerOff, Power } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deactivateProduct, updateProduct } from "../actions";
import type { Product, ProductCategory } from "../actions";
import { toast } from "@/hooks/use-toast";

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES: ProductCategory[] = [
  "Bread",
  "Biscuits",
  "Cakes",
  "Rusk",
  "Other",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProductListClientProps {
  products: Product[];
  categoryDistributorMap: Record<string, { name: string; exclusive: boolean }>;
  initialSearch: string;
  initialCategory: string;
  initialStatus: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductListClient({
  products,
  categoryDistributorMap,
  initialSearch,
  initialCategory,
  initialStatus,
}: ProductListClientProps) {
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState(initialCategory);
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase());

      const matchCategory = category === "all" || p.category === category;

      const matchStatus =
        status === "all" ||
        (status === "active" && p.is_active) ||
        (status === "inactive" && !p.is_active);

      return matchSearch && matchCategory && matchStatus;
    });
  }, [products, search, category, status]);

  // ── Deactivate handler ─────────────────────────────────────────────────────
  async function handleDeactivate(product: Product) {
    if (!confirm(`Deactivate "${product.name}"? It will be hidden from orders and delivery screens.`))
      return;

    setLoadingId(product.id);
    startTransition(async () => {
      const result = await deactivateProduct(product.id);
      if (result.success) {
        toast({ title: "Product deactivated", variant: "warning" as any });
      } else {
        toast({ title: "Failed to deactivate", description: result.error, variant: "destructive" });
      }
      setLoadingId(null);
    });
  }

  // ── Reactivate handler ─────────────────────────────────────────────────────
  async function handleReactivate(product: Product) {
    setLoadingId(product.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", product.name);
      fd.append("category", product.category);
      fd.append("mrp", product.mrp.toString());
      fd.append("weight_size", product.weight_size);
      fd.append("tax_rate", product.tax_rate.toString());
      fd.append("is_active", "on");

      const result = await updateProduct(product.id, fd);
      if (result.success) {
        toast({ title: "Product reactivated", variant: "success" as any });
      } else {
        toast({ title: "Failed to reactivate", description: result.error, variant: "destructive" });
      }
      setLoadingId(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* ── Filters toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="all">All Status</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
      </div>

      {/* ── Result count ─────────────────────────────────────────────────────── */}
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
        <span className="font-medium text-foreground">{products.length}</span> SKUs
      </p>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>MRP (₹)</TableHead>
              <TableHead>Weight / Size</TableHead>
              <TableHead>Tax %</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Distributor</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No products found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => {
                const distInfo = categoryDistributorMap[product.category];
                const isLoading = loadingId === product.id;

                return (
                  <TableRow
                    key={product.id}
                    className={cn(!product.is_active && "opacity-50 bg-muted/30")}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/products/${product.id}`}
                        className="hover:underline text-primary"
                      >
                        {product.name}
                      </Link>
                    </TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell>₹{product.mrp.toFixed(2)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.weight_size || "—"}
                    </TableCell>
                    <TableCell>{product.tax_rate}%</TableCell>
                    <TableCell>
                      {product.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {distInfo ? (
                        <div className="flex items-center gap-1.5">
                          <Badge variant={distInfo.exclusive ? "info" : "outline"}>
                            {distInfo.name}
                          </Badge>
                          {distInfo.exclusive && (
                            <span className="text-[10px] uppercase tracking-widest text-blue-600 font-semibold">
                              Exclusive
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                        >
                          <Link href={`/dashboard/products/${product.id}`}>
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Link>
                        </Button>

                        {product.is_active ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => handleDeactivate(product)}
                            className="text-destructive hover:bg-destructive/10 border-destructive/30"
                          >
                            <PowerOff className="h-3.5 w-3.5 mr-1" />
                            {isLoading ? "Saving…" : "Deactivate"}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => handleReactivate(product)}
                            className="text-green-600 hover:bg-green-50 border-green-300"
                          >
                            <Power className="h-3.5 w-3.5 mr-1" />
                            {isLoading ? "Saving…" : "Reactivate"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
