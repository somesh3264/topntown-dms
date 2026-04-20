// src/app/(app)/stock/page.tsx
// ---------------------------------------------------------------------------
// Distributor Stock Balance screen.
//
// Data: get_stock_balance() RPC — returns one row per product the distributor
// has dispatched allocations for, with allocated / delivered / remaining
// quantities already summed. "Dispatched" gate means billed-but-not-picked-up
// stock is NOT shown here (matches Home's SKUs Remaining tile).
//
// Layout:
//   [title + subtitle]
//   [brown summary card — total alloc / delivered / remaining]
//   [per-SKU cards with progress bar]
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stock" };
export const dynamic = "force-dynamic";

interface StockRow {
  product_id: string;
  product_name: string | null;
  sku_code: string | null;
  category: string | null;
  allocated_qty: number | string;
  delivered_qty: number | string;
  remaining_qty: number | string;
}

function toInt(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pctDelivered(allocated: number, delivered: number): number {
  if (allocated <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((delivered / allocated) * 100)));
}

export default async function StockPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_stock_balance");
  const rows = ((data ?? []) as StockRow[]).map((r) => ({
    ...r,
    allocated: toInt(r.allocated_qty),
    delivered: toInt(r.delivered_qty),
    remaining: toInt(r.remaining_qty),
  }));

  const totalAllocated = rows.reduce((acc, r) => acc + r.allocated, 0);
  const totalDelivered = rows.reduce((acc, r) => acc + r.delivered, 0);
  const totalRemaining = rows.reduce((acc, r) => acc + r.remaining, 0);

  return (
    <div className="px-4 pb-4 pt-3">
      {/* ── Title ──────────────────────────────────────────────────────── */}
      <header className="mb-5 px-1">
        <h1 className="text-2xl font-bold tracking-tight">Stock Balance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Allocated – Delivered = Remaining
        </p>
      </header>

      {/* ── Summary card ───────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-2xl bg-brand-700 px-5 py-5 text-center text-white shadow-sm">
        <div>
          <p className="text-2xl font-bold tabular-nums">{totalAllocated}</p>
          <p className="mt-0.5 text-xs text-white/80">Allocated</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{totalDelivered}</p>
          <p className="mt-0.5 text-xs text-white/80">Delivered</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{totalRemaining}</p>
          <p className="mt-0.5 text-xs text-white/80">Remaining</p>
        </div>
      </div>

      {/* ── Per-SKU cards ──────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-12 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h2 className="mt-3 text-base font-medium">No stock allocated</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Once an order is picked up from the factory, your allocation will
            appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const pct = pctDelivered(r.allocated, r.delivered);
            return (
              <li
                key={r.product_id}
                className="rounded-2xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
                      <Package className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">
                        {r.product_name ?? "(unnamed)"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.sku_code ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-bold tabular-nums">
                      {r.remaining}
                    </p>
                    <p className="text-xs text-muted-foreground">left</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1.5 w-full rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct}% delivered`}
                  />
                </div>

                {/* Alloc / Del (pct) */}
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Alloc: {r.allocated}</span>
                  <span>
                    Del: {r.delivered} ({pct}%)
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
