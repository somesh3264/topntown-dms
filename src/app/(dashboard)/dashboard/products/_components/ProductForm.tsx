// src/app/(dashboard)/products/_components/ProductForm.tsx
// ---------------------------------------------------------------------------
// Reusable Product Form — works in both create and edit modes.
// Client Component — handles validation, tax-rate warning, and submission.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, IndianRupee, Lock } from "lucide-react";
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
  "Cookies",
  "Pastries",
  "Sandwiches",
  "Pav & Buns",
  "Namkeen & Snacks",
  "Toast & Crackers",
  "Other",
];

// ─── HSN presets (auto-fill on category change) ────────────────────────────────

const CATEGORY_HSN: Partial<Record<ProductCategory, string>> = {
  "Bread":              "19059010",
  "Biscuits":           "19053100",
  "Cookies":            "19053100",
  "Cakes":              "19059090",
  "Pastries":           "19059090",
  "Rusk":               "19054000",
  "Toast & Crackers":   "19054000",
  "Sandwiches":         "21069099",
  "Pav & Buns":         "19059010",
  "Namkeen & Snacks":   "21069099",
};

// ─── GST presets by category ──────────────────────────────────────────────────

const CATEGORY_GST: Partial<Record<ProductCategory, number>> = {
  "Bread":              0,
  "Pav & Buns":         0,
  "Biscuits":           18,
  "Cookies":            18,
  "Cakes":              18,
  "Pastries":           18,
  "Rusk":               5,
  "Toast & Crackers":   5,
  "Sandwiches":         12,
  "Namkeen & Snacks":   12,
};

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

  // ── Core fields ────────────────────────────────────────────────────────────
  const [name,       setName]       = useState(product?.name ?? "");
  const [category,   setCategory]   = useState<ProductCategory>(product?.category ?? "Bread");
  const [weightSize, setWeightSize] = useState(product?.weight_size ?? "");
  const [taxRate,    setTaxRate]    = useState(product?.tax_rate?.toString() ?? "0");
  const [isActive,   setIsActive]   = useState(product?.is_active ?? true);

  // ── New identifier fields ──────────────────────────────────────────────────
  const [skuCode,     setSkuCode]     = useState(product?.sku_code ?? "");
  const [subCategory, setSubCategory] = useState(product?.sub_category ?? "");
  const [unit,        setUnit]        = useState(product?.unit ?? "Piece");
  const [hsnCode,     setHsnCode]     = useState(product?.hsn_code ?? "");

  // ── Pricing fields ─────────────────────────────────────────────────────────
  const [fsp, setFsp] = useState(product?.factory_selling_price?.toString() ?? "");
  // Legacy MRP: only shown / required when FSP is absent
  const [mrp, setMrp] = useState(product?.mrp?.toString() ?? "");

  // Read-only derived prices (populated from saved product; live updates after FSP save)
  const [derivedPrices, setDerivedPrices] = useState({
    ss_price:          product?.ss_price          ?? null,
    distributor_price: product?.distributor_price ?? null,
    retailer_price:    product?.retailer_price    ?? null,
    mrp:               product?.mrp               ?? null,
  });

  const hasFsp = fsp.trim() !== "" && !isNaN(parseFloat(fsp));

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Track original tax rate for warning
  const originalTaxRate = product?.tax_rate?.toString() ?? "0";

  // ── Category change: auto-fill HSN + GST ──────────────────────────────────
  function handleCategoryChange(cat: ProductCategory) {
    setCategory(cat);
    // Always overwrite HSN + GST from the preset table when the user picks a new category.
    const preset = CATEGORY_HSN[cat];
    if (preset) setHsnCode(preset);
    const gst = CATEGORY_GST[cat];
    if (gst !== undefined) setTaxRate(gst.toString());
  }

  // ── Client-side validation ─────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required.";
    const fspNum = fsp ? parseFloat(fsp) : null;
    if (fspNum !== null && (isNaN(fspNum) || fspNum < 0))
      errs.fsp = "Enter a valid Factory Selling Price.";
    if (!hasFsp) {
      const mrpNum = parseFloat(mrp);
      if (isNaN(mrpNum) || mrpNum < 0) errs.mrp = "Enter a valid MRP (or set a Factory Selling Price).";
    }
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
    const taxChanged = mode === "edit" && taxRate !== originalTaxRate;
    if (taxChanged) {
      const confirmed = window.confirm(
        `⚠️ Tax rate change (${originalTaxRate}% → ${taxRate}%) will apply to all future orders for this SKU. Existing orders are unaffected. Proceed?`
      );
      if (!confirmed) return;
    }

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("category", category);
    fd.append("weight_size", weightSize.trim());
    fd.append("tax_rate", taxRate);
    fd.append("is_active", isActive ? "on" : "off");
    fd.append("sku_code", skuCode.trim());
    fd.append("sub_category", subCategory.trim());
    fd.append("unit", unit.trim());
    fd.append("hsn_code", hsnCode.trim());
    if (hasFsp) fd.append("factory_selling_price", fsp.trim());
    else         fd.append("mrp", mrp.trim());

    startTransition(async () => {
      if (mode === "create") {
        const result = await createProduct(fd);
        if (result.success && result.data?.id) {
          toast({ title: "Product created!", variant: "success" as any });
          router.push(`/dashboard/products/${result.data.id}`);
        } else {
          toast({ title: "Failed to create product", description: result.error, variant: "destructive" });
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
          toast({ title: "Failed to save", description: result.error, variant: "destructive" });
        }
      }
    });
  }

  const INR = (n: number | null | undefined) =>
    n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(n);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Section 1: Identity ──────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product Identity</h3>

        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="name">Product Name <span className="text-destructive">*</span></Label>
          <Input
            id="name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Whole Wheat Bread 400g"
            className={cn(errors.name && "border-destructive")} disabled={isPending}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>

        {/* SKU Code + Unit */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sku_code">SKU Code</Label>
            <Input id="sku_code" value={skuCode} onChange={(e) => setSkuCode(e.target.value)}
              placeholder="e.g. BRD-WWB-400" disabled={isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit">Unit</Label>
            <select
              id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={isPending}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
            >
              {["Piece", "Pack", "Dozen", "Box", "Carton", "Kg", "Litre"].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Category + Sub-category */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="category">Category <span className="text-destructive">*</span></Label>
            <select
              id="category" value={category}
              onChange={(e) => handleCategoryChange(e.target.value as ProductCategory)}
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub_category">Sub-category</Label>
            <Input id="sub_category" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}
              placeholder="e.g. Multigrain" disabled={isPending} />
          </div>
        </div>

        {/* Weight / Size */}
        <div className="space-y-1.5">
          <Label htmlFor="weight_size">Weight / Size</Label>
          <Input id="weight_size" value={weightSize} onChange={(e) => setWeightSize(e.target.value)}
            placeholder="e.g. 400g or 6-pack" disabled={isPending} />
        </div>
      </div>

      <div className="border-t" />

      {/* ── Section 2: Tax & Compliance ─────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax &amp; Compliance</h3>

        <div className="grid grid-cols-2 gap-4">
          {/* HSN Code */}
          <div className="space-y-1.5">
            <Label htmlFor="hsn_code">HSN Code</Label>
            <Input id="hsn_code" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)}
              placeholder="e.g. 19059010" disabled={isPending} />
            <p className="text-[11px] text-muted-foreground">Auto-filled from category — edit if needed.</p>
          </div>

          {/* GST Rate */}
          <div className="space-y-1.5">
            <Label htmlFor="tax_rate">GST Rate (%) <span className="text-destructive">*</span></Label>
            {mode === "edit" && taxRate !== originalTaxRate && (
              <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Applies forward only.
              </div>
            )}
            <Input id="tax_rate" type="number" min="0" max="100" step="0.1"
              value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
              placeholder="0" className={cn(errors.taxRate && "border-destructive")} disabled={isPending}
            />
            {errors.taxRate && <p className="text-xs text-destructive">{errors.taxRate}</p>}
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── Section 3: Pricing ──────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</h3>

        {/* FSP */}
        <div className="space-y-1.5">
          <Label htmlFor="fsp">
            Factory Selling Price (₹)
          </Label>
          <div className="relative">
            <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id="fsp" type="number" min="0" step="0.01"
              value={fsp} onChange={(e) => setFsp(e.target.value)}
              placeholder="0.00" className={cn("pl-8", errors.fsp && "border-destructive")}
              disabled={isPending}
            />
          </div>
          {errors.fsp
            ? <p className="text-xs text-destructive">{errors.fsp}</p>
            : <p className="text-[11px] text-muted-foreground">
                Setting FSP lets the system auto-compute SS, Distributor, Retailer, and MRP prices.
              </p>
          }
        </div>

        {/* Derived prices — read-only, shown whenever FSP is set */}
        {hasFsp && (
          <div className="rounded-lg border bg-muted/30 divide-y">
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Super Stockist Price
              </span>
              <span className="font-mono text-sm text-blue-700">{INR(derivedPrices.ss_price)}</span>
            </div>
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Distributor Price
              </span>
              <span className="font-mono text-sm text-violet-700">{INR(derivedPrices.distributor_price)}</span>
            </div>
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Retailer Price
              </span>
              <span className="font-mono text-sm text-orange-700">{INR(derivedPrices.retailer_price)}</span>
            </div>
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> MRP (Consumer)
              </span>
              <span className="font-mono text-sm font-semibold text-red-700">{INR(derivedPrices.mrp)}</span>
            </div>
            <div className="px-4 py-2">
              <p className="text-[11px] text-muted-foreground">
                Auto-computed from FSP using global margins. Update FSP and save to refresh.
              </p>
            </div>
          </div>
        )}

        {/* Legacy MRP — only shown when no FSP */}
        {!hasFsp && (
          <div className="space-y-1.5">
            <Label htmlFor="mrp">MRP (₹) <span className="text-destructive">*</span></Label>
            <p className="text-[11px] text-muted-foreground">Used when Factory Selling Price is not set.</p>
            <div className="relative">
              <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="mrp" type="number" min="0" step="0.01"
                value={mrp} onChange={(e) => setMrp(e.target.value)}
                placeholder="0.00" className={cn("pl-8", errors.mrp && "border-destructive")}
                disabled={isPending}
              />
            </div>
            {errors.mrp && <p className="text-xs text-destructive">{errors.mrp}</p>}
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── Section 4: Status ────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Active SKU</p>
          <p className="text-xs text-muted-foreground">
            Inactive SKUs are hidden from orders and delivery screens.
          </p>
        </div>
        <Switch id="is_active" checked={isActive} onCheckedChange={setIsActive} disabled={isPending} />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create SKU" : "Save Changes"}
        </Button>
        <Button type="button" variant="outline" disabled={isPending}
          onClick={() => router.push("/dashboard/products")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
