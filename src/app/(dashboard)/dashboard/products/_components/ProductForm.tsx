// src/app/(dashboard)/products/_components/ProductForm.tsx
// ---------------------------------------------------------------------------
// Reusable Product Form — works in both create and edit modes.
// Client Component — handles validation, tax-rate warning, and submission.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { createProduct, updateProduct } from "../actions";
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

interface ProductFormProps {
  mode: "create" | "edit";
  product?: Product;
  /** Called after successful save in edit mode */
  onSaved?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductForm({ mode, product, onSaved }: ProductFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Controlled fields ──────────────────────────────────────────────────────
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState<ProductCategory>(
    product?.category ?? "Bread"
  );
  const [mrp, setMrp] = useState(product?.mrp?.toString() ?? "");
  const [weightSize, setWeightSize] = useState(product?.weight_size ?? "");
  const [taxRate, setTaxRate] = useState(product?.tax_rate?.toString() ?? "0");
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Track original tax rate for warning
  const originalTaxRate = product?.tax_rate?.toString() ?? "0";

  // ── Client-side validation ─────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required.";
    const mrpNum = parseFloat(mrp);
    if (isNaN(mrpNum) || mrpNum < 0) errs.mrp = "Enter a valid MRP.";
    const taxNum = parseFloat(taxRate);
    if (isNaN(taxNum) || taxNum < 0 || taxNum > 100)
      errs.taxRate = "Tax rate must be 0–100.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    // Business rule: show a warning toast if tax rate changed
    const taxChanged =
      mode === "edit" && taxRate !== originalTaxRate;

    if (taxChanged) {
      const confirmed = window.confirm(
        `⚠️ Tax rate change (${originalTaxRate}% → ${taxRate}%) will apply to all future orders for this SKU. Existing orders are unaffected. Proceed?`
      );
      if (!confirmed) return;
    }

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("category", category);
    fd.append("mrp", mrp);
    fd.append("weight_size", weightSize.trim());
    fd.append("tax_rate", taxRate);
    fd.append("is_active", isActive ? "on" : "off");

    startTransition(async () => {
      if (mode === "create") {
        const result = await createProduct(fd);
        if (result.success && result.data?.id) {
          toast({ title: "Product created!", variant: "success" as any });
          router.push(`/dashboard/products/${result.data.id}`);
        } else {
          toast({
            title: "Failed to create product",
            description: result.error,
            variant: "destructive",
          });
        }
      } else {
        const result = await updateProduct(product!.id, fd);
        if (result.success) {
          toast({ title: "Product saved!", variant: "success" as any });
          onSaved?.();
          if (taxChanged) {
            toast({
              title: "Tax rate updated",
              description: "Change applies to forward orders only.",
              variant: "warning" as any,
            });
          }
        } else {
          toast({
            title: "Failed to save",
            description: result.error,
            variant: "destructive",
          });
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Product Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Whole Wheat Bread 400g"
          className={cn(errors.name && "border-destructive")}
          disabled={isPending}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name}</p>
        )}
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <Label htmlFor="category">
          Category <span className="text-destructive">*</span>
        </Label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ProductCategory)}
          disabled={isPending}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* MRP + Weight row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="mrp">
            MRP (₹) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="mrp"
            type="number"
            min="0"
            step="0.01"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
            placeholder="0.00"
            className={cn(errors.mrp && "border-destructive")}
            disabled={isPending}
          />
          {errors.mrp && (
            <p className="text-xs text-destructive">{errors.mrp}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="weight_size">Weight / Size</Label>
          <Input
            id="weight_size"
            value={weightSize}
            onChange={(e) => setWeightSize(e.target.value)}
            placeholder="e.g. 400g or 6-pack"
            disabled={isPending}
          />
        </div>
      </div>

      {/* Tax rate */}
      <div className="space-y-1.5">
        <Label htmlFor="tax_rate">
          Tax Rate (%) <span className="text-destructive">*</span>
        </Label>
        {mode === "edit" && taxRate !== originalTaxRate && (
          <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Tax rate change applies forward only — existing orders are unaffected.
          </div>
        )}
        <Input
          id="tax_rate"
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
          placeholder="0"
          className={cn(errors.taxRate && "border-destructive")}
          disabled={isPending}
        />
        {errors.taxRate && (
          <p className="text-xs text-destructive">{errors.taxRate}</p>
        )}
      </div>

      {/* Active toggle */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Active SKU</p>
          <p className="text-xs text-muted-foreground">
            Inactive SKUs are hidden from orders and delivery screens.
          </p>
        </div>
        <Switch
          id="is_active"
          checked={isActive}
          onCheckedChange={setIsActive}
          disabled={isPending}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Saving…"
            : mode === "create"
            ? "Create SKU"
            : "Save Changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.push("/dashboard/products")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
