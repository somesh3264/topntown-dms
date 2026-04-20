// src/app/(dashboard)/dashboard/orders/new/_components/NewOrderClient.tsx
// ---------------------------------------------------------------------------
// Client form for placing an order on behalf of a distributor.
//
// Form state
//   • distributorId     — the order's target distributor
//   • orderDate         — defaults to today; super_admin may edit
//   • lines             — { productId, quantity }[]; at least one non-empty
//
// Behaviour
//   • Each line has a searchable product picker (reuses the MultiSelect's
//     panel + search UX, but in single-select mode via a native approach).
//   • Unit price shown per line is an *informational preview* using the
//     product's distributor_price (or MRP fallback). The server re-resolves
//     prices on submit so any per-distributor override is applied there.
//   • Subtotal is computed live from the preview prices.
//   • Submit calls createOrderForDistributor. On success we push to the new
//     order's detail page.
// ---------------------------------------------------------------------------

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createOrderForDistributor,
  type DistributorOption,
  type ProductOption,
} from "../../../../orders/actions";
import ProductPicker from "./ProductPicker";

interface NewOrderClientProps {
  distributors: DistributorOption[];
  products: ProductOption[];
  callerRole: "super_admin" | "sales_person";
}

interface LineItem {
  /** Local id for list keying — not sent to the server. */
  key: string;
  productId: string;
  quantity: number;
}

function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function makeKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function NewOrderClient({
  distributors,
  products,
  callerRole,
}: NewOrderClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [distributorId, setDistributorId] = useState<string>("");
  const [orderDate, setOrderDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<LineItem[]>([
    { key: makeKey(), productId: "", quantity: 1 },
  ]);

  const productIndex = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  function updateLine(key: string, patch: Partial<LineItem>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }
  function addLine() {
    setLines((prev) => [...prev, { key: makeKey(), productId: "", quantity: 1 }]);
  }

  // Live preview price — server is authoritative, but this lets the user
  // see approximately what each line will cost.
  function previewUnitPrice(productId: string): number {
    const p = productIndex.get(productId);
    if (!p) return 0;
    return p.distributor_price ?? p.mrp;
  }

  const subtotal = lines.reduce((sum, l) => {
    if (!l.productId || l.quantity <= 0) return sum;
    return sum + previewUnitPrice(l.productId) * l.quantity;
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!distributorId) {
      setErrorMsg("Select a distributor.");
      return;
    }
    // Drop empty lines before validation — forgiving UX for users who left
    // an extra blank row lying around.
    const cleaned = lines
      .filter((l) => l.productId && l.quantity > 0)
      .map((l) => ({ productId: l.productId, quantity: l.quantity }));
    if (cleaned.length === 0) {
      setErrorMsg("Add at least one line item with a product and quantity.");
      return;
    }
    // No duplicate products — if the user wants more of the same item, they
    // should bump the quantity. Collapsing silently on submit would hide
    // the mistake; easier to flag explicitly.
    const seen = new Set<string>();
    for (const l of cleaned) {
      if (seen.has(l.productId)) {
        setErrorMsg("A product appears twice — combine the lines.");
        return;
      }
      seen.add(l.productId);
    }

    startTransition(async () => {
      const result = await createOrderForDistributor({
        distributorId,
        orderDate: callerRole === "super_admin" ? orderDate : undefined,
        items: cleaned,
      });
      if (!result.success) {
        setErrorMsg(result.error ?? "Could not create order.");
        return;
      }
      // If the auto-bill step hit a warning (e.g. Edge Function not
      // deployed), flash it to the user. The order itself was created —
      // they'll see the warning banner on the detail page next to the
      // bill card / retry button.
      if (result.data?.billWarning) {
        // Deliberately non-fatal: we still navigate. The detail page
        // surfaces the retry affordance via BillCard.
        console.warn("[NewOrderClient] bill warning:", result.data.billWarning);
      }
      router.push(`/dashboard/orders/${result.data!.orderId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Top row: distributor + date ───────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="distributor">Distributor</Label>
          <select
            id="distributor"
            value={distributorId}
            onChange={(e) => setDistributorId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            required
          >
            <option value="">Select a distributor…</option>
            {distributors.map((d) => {
              const scope = [d.zone_name, d.area_name].filter(Boolean).join(" / ");
              return (
                <option key={d.id} value={d.id}>
                  {d.full_name ?? "(unnamed)"} {d.phone ? `— ${d.phone}` : ""}
                  {scope ? ` — ${scope}` : ""}
                </option>
              );
            })}
          </select>
          <p className="text-xs text-muted-foreground">
            {distributors.length === 0
              ? "No active distributors found. Add one in User Management first."
              : `${distributors.length} active distributor${distributors.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="order-date">Order date</Label>
          <Input
            id="order-date"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            disabled={callerRole !== "super_admin"}
          />
          <p className="text-xs text-muted-foreground">
            {callerRole === "super_admin"
              ? "Editable — pick any date (used for back-dated entries)."
              : "Today's date (only Super Admin can change)."}
          </p>
        </div>
      </div>

      {/* ── Line items ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Line items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add line
          </Button>
        </div>

        <div className="divide-y">
          {lines.map((line, idx) => {
            const product = line.productId ? productIndex.get(line.productId) : null;
            const unit = line.productId ? previewUnitPrice(line.productId) : 0;
            const lineTotal = unit * (line.quantity || 0);

            return (
              <div
                key={line.key}
                className="grid grid-cols-12 items-start gap-3 px-4 py-3"
              >
                {/* Product picker */}
                <div className="col-span-12 md:col-span-6">
                  <Label
                    htmlFor={`line-${line.key}-product`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Product #{idx + 1}
                  </Label>
                  <div className="mt-1">
                    <ProductPicker
                      id={`line-${line.key}-product`}
                      products={products}
                      value={line.productId}
                      onChange={(id) => updateLine(line.key, { productId: id })}
                      excludeIds={lines
                        .filter((l) => l.key !== line.key && l.productId)
                        .map((l) => l.productId)}
                    />
                  </div>
                </div>

                {/* Quantity */}
                <div className="col-span-4 md:col-span-2">
                  <Label
                    htmlFor={`line-${line.key}-qty`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Qty
                  </Label>
                  <Input
                    id={`line-${line.key}-qty`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(line.key, {
                        quantity: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>

                {/* Unit price (read-only preview) */}
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Unit price
                  </Label>
                  <div className="mt-1 h-10 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm tabular-nums">
                    {product ? formatInr(unit) : "—"}
                  </div>
                </div>

                {/* Line total */}
                <div className="col-span-3 md:col-span-1">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Total
                  </Label>
                  <div className="mt-1 h-10 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm font-medium tabular-nums">
                    {product ? formatInr(lineTotal) : "—"}
                  </div>
                </div>

                {/* Remove */}
                <div className="col-span-1 flex items-end justify-end">
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 1}
                    title={lines.length <= 1 ? "Keep at least one line" : "Remove line"}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-destructive/70 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Remove line item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            Subtotal (preview — final price resolved server-side)
          </span>
          <span className="text-base font-semibold tabular-nums">
            {formatInr(subtotal)}
          </span>
        </div>
      </div>

      {/* ── Validation errors ─────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/orders")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Create order
        </Button>
      </div>
    </form>
  );
}
