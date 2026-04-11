// src/app/(dashboard)/dashboard/pricing/_components/PricingMarginsClient.tsx
// ---------------------------------------------------------------------------
// Client component for the Pricing Margin Management page.
//
// Layout:
//   • 4 margin cards (Super Stockist, Distributor, Retailer, MRP)
//   • Live pricing preview calculator
//   • Recalculate All Products panel
//
// Access: super_admin only (enforced by page.tsx + RLS).
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { Save, RefreshCw, Calculator, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { updatePricingMargin, recalculateAllPrices } from "../actions";
import { previewPricing, TIER_META, TIER_ORDER } from "../pricing-utils";
import type { PricingMargin, PricingTierKey, PricingPreview } from "../pricing-utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(n);

const TIER_COLOR_MAP: Record<PricingTierKey, string> = {
  super_stockist: "bg-blue-50 border-blue-200",
  distributor:    "bg-violet-50 border-violet-200",
  retailer:       "bg-orange-50 border-orange-200",
  mrp:            "bg-red-50 border-red-200",
};

const TIER_BADGE_MAP: Record<PricingTierKey, string> = {
  super_stockist: "bg-blue-100 text-blue-800",
  distributor:    "bg-violet-100 text-violet-800",
  retailer:       "bg-orange-100 text-orange-800",
  mrp:            "bg-red-100 text-red-800",
};

const PREVIEW_LABEL_MAP: Record<keyof PricingPreview, string> = {
  fsp:               "Factory Selling Price",
  ss_price:          "Super Stockist Price",
  distributor_price: "Distributor Price",
  retailer_price:    "Retailer Price",
  mrp:               "MRP (Consumer)",
};

// ─── Margin Card ──────────────────────────────────────────────────────────────

interface MarginCardProps {
  margin: PricingMargin;
  onSaved: (tier: PricingTierKey, newPct: number) => void;
}

function MarginCard({ margin, onSaved }: MarginCardProps) {
  const meta = TIER_META[margin.tier];
  const [value, setValue] = useState(margin.margin_pct.toString());
  const [isPending, startTransition] = useTransition();

  const isDirty = parseFloat(value) !== margin.margin_pct;

  const handleSave = () => {
    const pct = parseFloat(value);
    if (isNaN(pct) || pct < 0 || pct > 500) {
      toast({ title: "Invalid margin", description: "Enter a value between 0 and 500.", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const result = await updatePricingMargin(margin.tier, pct);
      if (result.success) {
        toast({ title: "Margin saved", description: `${meta.label} margin updated to ${pct}%.` });
        onSaved(margin.tier, pct);
      } else {
        toast({ title: "Save failed", description: result.error, variant: "destructive" });
      }
    });
  };

  return (
    <Card className={`border-2 ${TIER_COLOR_MAP[margin.tier]}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{meta.label}</CardTitle>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE_MAP[margin.tier]}`}>
            {margin.margin_pct}%
          </span>
        </div>
        <CardDescription className="text-xs">
          Base: <span className="font-medium">{meta.basePriceLabel}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {margin.description && (
          <p className="text-xs text-muted-foreground italic">{margin.description}</p>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={`margin-${margin.tier}`} className="text-xs mb-1 block">
              Margin %
            </Label>
            <div className="relative">
              <Input
                id={`margin-${margin.tier}`}
                type="number"
                step="0.001"
                min="0"
                max="500"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="pr-6 text-sm"
                disabled={isPending}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="shrink-0"
          >
            {isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">{isPending ? "Saving…" : "Save"}</span>
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Last updated: {new Date(margin.updated_at).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
          })}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Live Preview ─────────────────────────────────────────────────────────────
//
// previewPricing is a pure synchronous function — no server round-trip needed.
// We call it directly; no useTransition required.

interface LivePreviewProps {
  margins: Record<PricingTierKey, number>;
}

function LivePreview({ margins }: LivePreviewProps) {
  const [fspInput, setFspInput] = useState("100");
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const handleCalculate = useCallback(() => {
    const fsp = parseFloat(fspInput);
    if (isNaN(fsp) || fsp < 0) {
      setInputError("Enter a valid non-negative price.");
      setPreview(null);
      return;
    }
    setInputError(null);
    // Pure synchronous call — no server round-trip, no useTransition needed.
    setPreview(previewPricing(fsp, margins));
  }, [fspInput, margins]);

  // When the parent saves a margin, auto-refresh an existing preview so the
  // displayed numbers never lag behind the new rates.
  useEffect(() => {
    if (preview === null) return;
    const fsp = parseFloat(fspInput);
    if (!isNaN(fsp) && fsp >= 0) {
      setPreview(previewPricing(fsp, margins));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margins]);

  const PREVIEW_ORDER: (keyof PricingPreview)[] = [
    "fsp", "ss_price", "distributor_price", "retailer_price", "mrp",
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Live Pricing Preview</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Enter a Factory Selling Price to see the full pricing chain using current margins.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="fsp-preview" className="text-xs mb-1 block">
              Factory Selling Price (₹)
            </Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">₹</span>
              <Input
                id="fsp-preview"
                type="number"
                step="0.01"
                min="0"
                value={fspInput}
                onChange={(e) => {
                  setFspInput(e.target.value);
                  setPreview(null);
                  setInputError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleCalculate()}
                className={`pl-7 text-sm ${inputError ? "border-destructive" : ""}`}
              />
            </div>
            {inputError && (
              <p className="mt-1 text-[11px] text-destructive">{inputError}</p>
            )}
          </div>
          <Button
            onClick={handleCalculate}
            variant="secondary"
            size="sm"
            className="shrink-0"
          >
            <Calculator className="h-3.5 w-3.5" />
            <span className="ml-1.5">Calculate</span>
          </Button>
        </div>

        {preview ? (
          <div className="rounded-lg border bg-muted/30 divide-y">
            {PREVIEW_ORDER.map((key) => {
              const isInput = key === "fsp";
              const isMrp   = key === "mrp";
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between px-4 py-2.5 ${isMrp ? "bg-red-50/60" : ""}`}
                >
                  <span
                    className={`text-sm ${
                      isInput
                        ? "text-muted-foreground"
                        : isMrp
                        ? "font-semibold text-red-700"
                        : "text-foreground"
                    }`}
                  >
                    {PREVIEW_LABEL_MAP[key]}
                  </span>
                  <span
                    className={`font-mono text-sm font-medium ${isMrp ? "text-red-700" : ""}`}
                  >
                    {INR(preview[key])}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground py-4">
            Enter a price and press Calculate to see the pricing chain.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Recalculate Panel ────────────────────────────────────────────────────────

function RecalculatePanel() {
  const [isPending, startTransition] = useTransition();
  const [lastCount, setLastCount] = useState<number | null>(null);

  const handleRecalculate = () => {
    startTransition(async () => {
      const result = await recalculateAllPrices();
      if (result.success && result.data) {
        setLastCount(result.data.count);
        toast({
          title: "Recalculation complete",
          description: `${result.data.count} product${result.data.count !== 1 ? "s" : ""} updated successfully.`,
        });
      } else {
        toast({
          title: "Recalculation failed",
          description: result.error ?? "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <CardTitle className="text-base text-amber-900">Recalculate All Products</CardTitle>
        </div>
        <CardDescription className="text-xs text-amber-700">
          Applies the current margin settings to every product in the catalogue that has a
          Factory Selling Price set. Existing order items are <strong>not</strong> affected —
          orders lock their prices at booking time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {lastCount !== null && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-xs text-green-700">
              Last run updated <strong>{lastCount}</strong> product{lastCount !== 1 ? "s" : ""}.
            </p>
          </div>
        )}

        <Button
          onClick={handleRecalculate}
          disabled={isPending}
          variant="outline"
          className="w-full border-amber-400 text-amber-800 hover:bg-amber-100"
        >
          {isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isPending ? "Recalculating…" : "Recalculate All Product Prices"}
        </Button>

        <p className="text-[11px] text-muted-foreground">
          Tip: Run this after saving margin changes to propagate the new rates to all products.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Main Client Component ────────────────────────────────────────────────────

interface PricingMarginsClientProps {
  initialMargins: PricingMargin[];
}

export function PricingMarginsClient({ initialMargins }: PricingMarginsClientProps) {
  // Local state so preview calculator responds immediately to saved margins
  const [marginMap, setMarginMap] = useState<Record<PricingTierKey, number>>(
    () =>
      Object.fromEntries(
        initialMargins.map((m) => [m.tier, m.margin_pct])
      ) as Record<PricingTierKey, number>
  );

  const handleSaved = (tier: PricingTierKey, newPct: number) => {
    setMarginMap((prev) => ({ ...prev, [tier]: newPct }));
  };

  // Sort initial margins by canonical display order
  const orderedMargins = TIER_ORDER
    .map((t) => initialMargins.find((m) => m.tier === t))
    .filter(Boolean) as PricingMargin[];

  return (
    <div className="space-y-8">
      {/* ── Margin Cards ── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Global Margin Settings
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {orderedMargins.map((margin) => (
            <MarginCard key={margin.tier} margin={margin} onSaved={handleSaved} />
          ))}
        </div>
      </section>

      <div className="border-t" />

      {/* ── Preview + Recalculate ── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LivePreview margins={marginMap} />
          <RecalculatePanel />
        </div>
      </section>
    </div>
  );
}
