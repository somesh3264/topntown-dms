// src/app/(dashboard)/products/_components/PricingEngine.tsx
// ---------------------------------------------------------------------------
// Pricing Engine — 4-tab Client Component.
//
// Tab 1 — Base Price        : single price field, applied when no override.
// Tab 2 — Distributor Overrides : per-distributor price table.
// Tab 3 — Retailer Overrides    : per-retailer price table.
// Tab 4 — Discount Slabs        : quantity/value slabs with %.
//
// Business rules enforced:
//   • Override hierarchy displayed: Retailer > Distributor > Base price.
//   • Slabs can target distributor or retailer tier.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  updateBasePrice,
  upsertPriceOverride,
  deletePriceOverride,
  upsertDiscountSlab,
  deleteDiscountSlab,
} from "../actions";
import type {
  Product,
  PriceOverride,
  DiscountSlab,
  PricingTier,
  SlabType,
  Distributor,
} from "../actions";
import { toast } from "@/hooks/use-toast";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PricingEngineProps {
  product: Product;
  distributorOverrides: PriceOverride[];
  retailerOverrides: PriceOverride[];
  discountSlabs: DiscountSlab[];
  distributors: Distributor[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PricingEngine({
  product,
  distributorOverrides,
  retailerOverrides,
  discountSlabs,
  distributors,
}: PricingEngineProps) {
  return (
    <Tabs defaultValue="base" className="w-full">
      <TabsList className="mb-2">
        <TabsTrigger value="base">Base Price</TabsTrigger>
        <TabsTrigger value="distributor">
          Distributor Overrides
          {distributorOverrides.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">
              {distributorOverrides.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="retailer">
          Retailer Overrides
          {retailerOverrides.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">
              {retailerOverrides.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="slabs">
          Discount Slabs
          {discountSlabs.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">
              {discountSlabs.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      {/* Tab 1 — Base Price */}
      <TabsContent value="base">
        <BasePriceTab product={product} />
      </TabsContent>

      {/* Tab 2 — Distributor Overrides */}
      <TabsContent value="distributor">
        <OverridesTab
          productId={product.id}
          tier="distributor"
          overrides={distributorOverrides}
          distributors={distributors}
        />
      </TabsContent>

      {/* Tab 3 — Retailer Overrides */}
      <TabsContent value="retailer">
        <OverridesTab
          productId={product.id}
          tier="retailer"
          overrides={retailerOverrides}
          distributors={[]} // retailers aren't in the distributors list; use free-text userId for now
        />
      </TabsContent>

      {/* Tab 4 — Discount Slabs */}
      <TabsContent value="slabs">
        <DiscountSlabsTab productId={product.id} slabs={discountSlabs} />
      </TabsContent>
    </Tabs>
  );
}

// ─── Tab 1: Base Price ────────────────────────────────────────────────────────

function BasePriceTab({ product }: { product: Product }) {
  const [price, setPrice] = useState(
    (product as any).base_price?.toString() ?? ""
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const num = parseFloat(price);
    if (isNaN(num) || num < 0) {
      toast({ title: "Invalid price", description: "Enter a valid non-negative price.", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const result = await updateBasePrice(product.id, num);
      if (result.success) {
        toast({ title: "Base price saved!", variant: "success" as any });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <div className="max-w-sm space-y-4">
      <div className="rounded-md bg-muted/40 border px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Price hierarchy reminder</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Retailer override (highest priority)</li>
          <li>Distributor override</li>
          <li>Base price (fallback — set here)</li>
        </ol>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="base_price">Base Price (₹)</Label>
        <Input
          id="base_price"
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          MRP: ₹{product.mrp.toFixed(2)} — base price should be ≤ MRP.
        </p>
      </div>

      <Button onClick={handleSave} disabled={isPending} className="gap-2">
        <Save className="h-4 w-4" />
        {isPending ? "Saving…" : "Save Base Price"}
      </Button>
    </div>
  );
}

// ─── Tab 2 & 3: Overrides ────────────────────────────────────────────────────

interface OverridesTabProps {
  productId: string;
  tier: PricingTier;
  overrides: PriceOverride[];
  distributors: Distributor[];
}

function OverridesTab({ productId, tier, overrides, distributors }: OverridesTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [freeUserId, setFreeUserId] = useState(""); // fallback for retailer tier
  const [overridePrice, setOverridePrice] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isDistributor = tier === "distributor";
  const label = isDistributor ? "Distributor" : "Retailer";

  function openAddDialog() {
    setSelectedUserId("");
    setFreeUserId("");
    setOverridePrice("");
    setEffectiveFrom(new Date().toISOString().split("T")[0]);
    setDialogOpen(true);
  }

  async function handleSave() {
    const userId = isDistributor ? selectedUserId : freeUserId;
    if (!userId.trim()) {
      toast({ title: `Select a ${label.toLowerCase()}`, variant: "destructive" });
      return;
    }
    const price = parseFloat(overridePrice);
    if (isNaN(price) || price < 0) {
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      const result = await upsertPriceOverride(
        productId,
        tier,
        userId.trim(),
        price,
        effectiveFrom
      );
      if (result.success) {
        toast({ title: "Override saved!", variant: "success" as any });
        setDialogOpen(false);
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    });
  }

  async function handleDelete(overrideId: string) {
    if (!confirm("Remove this price override?")) return;
    setDeletingId(overrideId);
    startTransition(async () => {
      const result = await deletePriceOverride(overrideId, productId);
      if (result.success) {
        toast({ title: "Override removed", variant: "success" as any });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Set individual prices per {label.toLowerCase()}. These override the base price.
        </p>
        <Button size="sm" onClick={openAddDialog} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Override
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label} Name / ID</TableHead>
              <TableHead>Override Price (₹)</TableHead>
              <TableHead>Effective From</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-20 text-center text-muted-foreground text-sm">
                  No overrides set. Base price will be used for all {label.toLowerCase()}s.
                </TableCell>
              </TableRow>
            ) : (
              overrides.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.user_name ?? o.user_id}
                  </TableCell>
                  <TableCell>₹{o.price.toFixed(2)}</TableCell>
                  <TableCell>
                    {new Date(o.effective_from).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deletingId === o.id}
                      onClick={() => handleDelete(o.id)}
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Add Override Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add {label} Override</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Distributor selector or free-text for retailer */}
            {isDistributor ? (
              <div className="space-y-1.5">
                <Label>Select Distributor</Label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Choose distributor —</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name ?? d.id}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Retailer User ID</Label>
                <Input
                  value={freeUserId}
                  onChange={(e) => setFreeUserId(e.target.value)}
                  placeholder="Paste retailer user UUID…"
                />
                <p className="text-xs text-muted-foreground">
                  You can find user IDs on the Users page.
                </p>
              </div>
            )}

            {/* Price */}
            <div className="space-y-1.5">
              <Label>Override Price (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={overridePrice}
                onChange={(e) => setOverridePrice(e.target.value)}
                placeholder="0.00"
              />
            </div>

            {/* Effective from */}
            <div className="space-y-1.5">
              <Label>Effective From</Label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 4: Discount Slabs ────────────────────────────────────────────────────

interface DiscountSlabsTabProps {
  productId: string;
  slabs: DiscountSlab[];
}

function DiscountSlabsTab({ productId, slabs }: DiscountSlabsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slabType, setSlabType] = useState<SlabType>("quantity");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [applicableTier, setApplicableTier] = useState<PricingTier>("distributor");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openAddDialog() {
    setSlabType("quantity");
    setMinValue("");
    setMaxValue("");
    setDiscountPct("");
    setApplicableTier("distributor");
    setDialogOpen(true);
  }

  async function handleSave() {
    const min = parseFloat(minValue);
    const max = maxValue.trim() === "" ? null : parseFloat(maxValue);
    const pct = parseFloat(discountPct);

    if (isNaN(min) || min < 0) {
      toast({ title: "Enter a valid min value", variant: "destructive" });
      return;
    }
    if (max !== null && (isNaN(max) || max < min)) {
      toast({ title: "Max must be greater than min", variant: "destructive" });
      return;
    }
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast({ title: "Discount % must be 0–100", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      const result = await upsertDiscountSlab(productId, {
        slab_type: slabType,
        min_value: min,
        max_value: max,
        discount_percent: pct,
        applicable_tier: applicableTier,
      });
      if (result.success) {
        toast({ title: "Slab added!", variant: "success" as any });
        setDialogOpen(false);
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    });
  }

  async function handleDelete(slabId: string) {
    if (!confirm("Remove this discount slab?")) return;
    setDeletingId(slabId);
    startTransition(async () => {
      const result = await deleteDiscountSlab(slabId, productId);
      if (result.success) {
        toast({ title: "Slab removed", variant: "success" as any });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Slabs apply discounts based on order quantity or total value.
        </p>
        <Button size="sm" onClick={openAddDialog} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Slab
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Min</TableHead>
              <TableHead>Max</TableHead>
              <TableHead>Discount %</TableHead>
              <TableHead>Applies To</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slabs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground text-sm">
                  No discount slabs configured.
                </TableCell>
              </TableRow>
            ) : (
              slabs.map((slab) => (
                <TableRow key={slab.id}>
                  <TableCell>
                    <Badge variant={slab.slab_type === "quantity" ? "info" : "secondary"}>
                      {slab.slab_type === "quantity" ? "Qty" : "Value"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {slab.slab_type === "quantity"
                      ? `${slab.min_value} units`
                      : `₹${slab.min_value}`}
                  </TableCell>
                  <TableCell>
                    {slab.max_value === null
                      ? "∞"
                      : slab.slab_type === "quantity"
                      ? `${slab.max_value} units`
                      : `₹${slab.max_value}`}
                  </TableCell>
                  <TableCell className="font-medium text-green-700">
                    {slab.discount_percent}%
                  </TableCell>
                  <TableCell>
                    <Badge variant={slab.applicable_tier === "distributor" ? "default" : "outline"}>
                      {slab.applicable_tier === "distributor" ? "Distributor" : "Retailer"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deletingId === slab.id}
                      onClick={() => handleDelete(slab.id)}
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Add Slab Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Discount Slab</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Slab type */}
            <div className="space-y-1.5">
              <Label>Slab Type</Label>
              <div className="flex gap-3">
                {(["quantity", "value"] as SlabType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="slab_type"
                      value={t}
                      checked={slabType === t}
                      onChange={() => setSlabType(t)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm capitalize">{t}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {slabType === "quantity"
                  ? "Discount triggers when units ordered fall in range."
                  : "Discount triggers when order value falls in range."}
              </p>
            </div>

            {/* Min / Max */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  Min {slabType === "quantity" ? "Units" : "Value (₹)"}
                </Label>
                <Input
                  type="number"
                  min="0"
                  step={slabType === "quantity" ? "1" : "0.01"}
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Max {slabType === "quantity" ? "Units" : "Value (₹)"}{" "}
                  <span className="text-muted-foreground">(blank = ∞)</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step={slabType === "quantity" ? "1" : "0.01"}
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="∞"
                />
              </div>
            </div>

            {/* Discount % */}
            <div className="space-y-1.5">
              <Label>Discount (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>

            {/* Applicable tier */}
            <div className="space-y-1.5">
              <Label>Applies To</Label>
              <select
                value={applicableTier}
                onChange={(e) => setApplicableTier(e.target.value as PricingTier)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="distributor">Distributor</option>
                <option value="retailer">Retailer</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Add Slab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
