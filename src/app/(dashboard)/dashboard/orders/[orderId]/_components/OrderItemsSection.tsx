// src/app/(dashboard)/dashboard/orders/[orderId]/_components/OrderItemsSection.tsx
// ---------------------------------------------------------------------------
// Order-detail line items section with an optional edit mode.
//
// View mode (default)
//   Renders the existing read-only table exactly as before.
//
// Edit mode (super_admin / sales_person)
//   Swaps the table for a ProductPicker + qty editor. On Save we POST the
//   line items via updateOrderItems(). For billed orders, the server also
//   regenerates the bill so the PDF reflects the new items.
//
// Keeping this a single component (rather than two separate read/edit
// components) avoids duplicating the heading + totals chrome and makes the
// "click Edit → mutate → click Save" loop feel seamless.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateOrderItems,
  type OrderItemRow,
  type ProductOption,
} from "../../../../orders/actions";
import { isOrderEditableByAdmin } from "../../../../orders/status";
import ProductPicker from "../../new/_components/ProductPicker";

function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function makeKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface OrderItemsSectionProps {
  orderId: string;
  orderStatus: string;
  initialItems: OrderItemRow[];
  /** When true, shows the "Edit items" button. */
  canEdit: boolean;
  /** Product catalog for the picker. Only passed when canEdit is true. */
  products?: ProductOption[];
}

interface DraftLine {
  key: string;
  productId: string;
  quantity: number;
  /** The original unit price, if the line existed before edit began.
   *  We keep it just for display — the server re-resolves on save. */
  originalUnitPrice?: number;
}

export default function OrderItemsSection({
  orderId,
  orderStatus,
  initialItems,
  canEdit,
  products,
}: OrderItemsSectionProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Draft lines live only while editing. Seeded from initialItems on each
  // edit-mode entry so a Cancel discards changes cleanly.
  const [lines, setLines] = useState<DraftLine[]>(() => seed(initialItems));

  const productIndex = new Map((products ?? []).map((p) => [p.id, p]));

  const subTotalView = initialItems.reduce((a, i) => a + i.line_total, 0);

  function enterEdit() {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLines(seed(initialItems));
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setErrorMsg(null);
  }
  function addLine() {
    setLines((prev) => [...prev, { key: makeKey(), productId: "", quantity: 1 }]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function handleSave() {
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleaned = lines
      .filter((l) => l.productId && l.quantity > 0)
      .map((l) => ({ productId: l.productId, quantity: l.quantity }));

    if (cleaned.length === 0) {
      setErrorMsg("Order must have at least one line item with a product and quantity.");
      return;
    }

    const seen = new Set<string>();
    for (const l of cleaned) {
      if (seen.has(l.productId)) {
        setErrorMsg("A product appears twice — combine the lines.");
        return;
      }
      seen.add(l.productId);
    }

    startTransition(async () => {
      const result = await updateOrderItems({ orderId, items: cleaned });
      if (!result.success) {
        setErrorMsg(result.error ?? "Save failed.");
        return;
      }
      // Compose a success message that matches what actually happened:
      //   • billRegenerated → an existing bill was re-issued
      //   • billGenerated   → a bill was created for the first time
      //                       (auto-bill on admin edit of confirmed order)
      //   • neither         → items updated but no bill movement
      //   • billWarning     → the bill step failed but the items saved
      let msg: string;
      if (result.data?.billWarning) {
        // Keep the items-saved success tone but call out the bill issue
        // so the admin knows to hit Retry PDF on the bill card.
        msg = `Order saved. Bill step had an issue: ${result.data.billWarning}`;
      } else if (result.data?.billRegenerated) {
        msg = "Order saved. Bill regenerated — new PDF is being rendered.";
      } else if (result.data?.billGenerated) {
        msg =
          "Order saved and bill generated. PDF is rendering; Stock Balance is updated.";
      } else {
        msg = "Order saved.";
      }
      setSuccessMsg(msg);
      setEditing(false);
      // Re-run the server component so the updated items + (if newly billed
      // or regenerated) the bill card render immediately.
      router.refresh();
    });
  }

  // ── Derived preview price for the editor ─────────────────────────────────
  // The server is authoritative on price; this is just a UI preview so the
  // user sees approximately what each edited line will cost.
  function previewUnitPrice(line: DraftLine): number {
    if (line.originalUnitPrice != null && line.productId) {
      // If the user hasn't changed the product, use the original unit_price.
      // (When they switch products, fall through to the catalog.)
      const wasOriginalProduct = initialItems.some(
        (it) => it.product_id === line.productId,
      );
      if (wasOriginalProduct) return line.originalUnitPrice;
    }
    const p = line.productId ? productIndex.get(line.productId) : null;
    if (!p) return 0;
    return p.distributor_price ?? p.mrp;
  }

  const subtotalDraft = editing
    ? lines.reduce((sum, l) => {
        if (!l.productId || l.quantity <= 0) return sum;
        return sum + previewUnitPrice(l) * l.quantity;
      }, 0)
    : 0;

  const isBilled = orderStatus === "billed";

  // Edit is allowed only while the order can still be amended server-side.
  // Once dispatched / delivered / cancelled, the stock has physically left
  // the factory (or never will) and we don't let the admin edit items.
  const statusEditable = isOrderEditableByAdmin(orderStatus);
  const canShowEditButton = canEdit && statusEditable;
  const lockedReason = statusEditable
    ? null
    : orderStatus === "dispatched"
      ? "Stock has already been dispatched from the factory. Items can't be changed after pickup."
      : orderStatus === "delivered"
        ? "Order has been delivered. Items are locked."
        : orderStatus === "cancelled"
          ? "Order was cancelled. Items are locked."
          : `Order is in status "${orderStatus}" and can no longer be edited.`;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-medium">Line items</h2>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {(editing ? lines : initialItems).length} item
            {(editing ? lines : initialItems).length === 1 ? "" : "s"}
          </span>

          {canShowEditButton && !editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={enterEdit}
              className="h-7 px-2 text-xs"
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit items
            </Button>
          )}

          {canEdit && !statusEditable && !editing && (
            <span
              title={lockedReason ?? "Locked"}
              className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <Lock className="h-3 w-3" />
              Locked
            </span>
          )}
        </div>
      </div>

      {/* ── Banners ───────────────────────────────────────────────────────── */}
      {canEdit && !statusEditable && lockedReason && (
        <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{lockedReason}</span>
        </div>
      )}
      {isBilled && editing && (
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This order has already been billed. Saving will delete the existing
            bill and regenerate a new one with the updated items — the distributor's
            invoice will reflect the new quantities before pickup.
          </span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-start gap-2 border-b bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && !editing && (
        <div className="flex items-start gap-2 border-b bg-emerald-50 px-4 py-2 text-xs text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      {editing ? (
        <EditBody
          lines={lines}
          products={products ?? []}
          onUpdate={updateLine}
          onRemove={removeLine}
          onAdd={addLine}
          previewUnitPrice={previewUnitPrice}
        />
      ) : (
        <ViewBody items={initialItems} subTotal={subTotalView} />
      )}

      {/* ── Edit footer ───────────────────────────────────────────────────── */}
      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
          <div className="text-sm">
            <span className="text-muted-foreground">
              Subtotal (preview — server re-prices on save)
            </span>
            <span className="ml-2 font-semibold tabular-nums">
              {formatInr(subtotalDraft)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelEdit}
              disabled={pending}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── View body ────────────────────────────────────────────────────────────────

function ViewBody({ items, subTotal }: { items: OrderItemRow[]; subTotal: number }) {
  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        This order has no line items.
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left font-medium">Product</th>
          <th className="px-4 py-2 text-right font-medium">Qty</th>
          <th className="px-4 py-2 text-right font-medium">Unit price</th>
          <th className="px-4 py-2 text-right font-medium">Line total</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {items.map((it) => (
          <tr key={it.id}>
            <td className="px-4 py-2">{it.product_name ?? "(unknown)"}</td>
            <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {formatInr(it.unit_price)}
            </td>
            <td className="px-4 py-2 text-right font-medium tabular-nums">
              {formatInr(it.line_total)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t bg-muted/30 font-medium">
          <td className="px-4 py-2 text-right" colSpan={3}>
            Sub-total
          </td>
          <td className="px-4 py-2 text-right tabular-nums">{formatInr(subTotal)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ─── Edit body ────────────────────────────────────────────────────────────────

function EditBody({
  lines,
  products,
  onUpdate,
  onRemove,
  onAdd,
  previewUnitPrice,
}: {
  lines: DraftLine[];
  products: ProductOption[];
  onUpdate: (key: string, patch: Partial<DraftLine>) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  previewUnitPrice: (line: DraftLine) => number;
}) {
  return (
    <div className="divide-y">
      {lines.map((line, idx) => {
        const unit = line.productId ? previewUnitPrice(line) : 0;
        const lineTotal = unit * (line.quantity || 0);

        return (
          <div
            key={line.key}
            className="grid grid-cols-12 items-start gap-3 px-4 py-3"
          >
            <div className="col-span-12 md:col-span-6">
              <Label
                htmlFor={`edit-line-${line.key}-product`}
                className="text-xs font-medium text-muted-foreground"
              >
                Product #{idx + 1}
              </Label>
              <div className="mt-1">
                <ProductPicker
                  id={`edit-line-${line.key}-product`}
                  products={products}
                  value={line.productId}
                  onChange={(id) => onUpdate(line.key, { productId: id })}
                  excludeIds={lines
                    .filter((l) => l.key !== line.key && l.productId)
                    .map((l) => l.productId)}
                />
              </div>
            </div>
            <div className="col-span-4 md:col-span-2">
              <Label
                htmlFor={`edit-line-${line.key}-qty`}
                className="text-xs font-medium text-muted-foreground"
              >
                Qty
              </Label>
              <Input
                id={`edit-line-${line.key}-qty`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={line.quantity}
                onChange={(e) =>
                  onUpdate(line.key, {
                    quantity: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
            <div className="col-span-4 md:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Unit price
              </Label>
              <div className="mt-1 h-10 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm tabular-nums">
                {line.productId ? formatInr(unit) : "—"}
              </div>
            </div>
            <div className="col-span-3 md:col-span-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Total
              </Label>
              <div className="mt-1 h-10 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm font-medium tabular-nums">
                {line.productId ? formatInr(lineTotal) : "—"}
              </div>
            </div>
            <div className="col-span-1 flex items-end justify-end">
              <button
                type="button"
                onClick={() => onRemove(line.key)}
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
      <div className="px-4 py-3">
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add line
        </Button>
      </div>
    </div>
  );
}

// ─── Seed helper ──────────────────────────────────────────────────────────────

function seed(items: OrderItemRow[]): DraftLine[] {
  if (items.length === 0) {
    return [{ key: makeKey(), productId: "", quantity: 1 }];
  }
  return items.map((it) => ({
    key: makeKey(),
    productId: it.product_id,
    quantity: it.quantity,
    originalUnitPrice: it.unit_price,
  }));
}
