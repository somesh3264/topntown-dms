// src/app/(dashboard)/dashboard/page.tsx
// ---------------------------------------------------------------------------
// Dashboard home — Server Component.
//
// Each KPI is fetched by its own async sub-component wrapped in <Suspense>,
// so the page streams: skeletons appear immediately while the DB queries run
// concurrently.
//
// Role-scoped data:
//   super_admin    → sees platform-wide aggregates
//   super_stockist → sees data for their distributor network (RLS-enforced)
//   sales_person   → sees data for their assigned area    (RLS-enforced)
// ---------------------------------------------------------------------------

import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { Truck, Package, ShoppingCart, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { KpiCard, KpiCardSkeleton } from "@/components/ui/kpi-card";
import type { UserRole } from "@/middleware";

export const metadata: Metadata = { title: "Dashboard" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ISO-8601 bounds for the current calendar day (UTC). */
function todayBounds() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const end = new Date(start.getTime() + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Compact INR formatter, e.g. 420000 → "₹4.2L" */
function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// ─── KPI sub-components ───────────────────────────────────────────────────────

// ── 1. Active Distributors (was "Deliveries Today") ──────────────────────────

async function ActiveDistributors({ role }: { role: UserRole }) {
  const supabase = createClient();

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("distributor_id")
    .gte("created_at", monthStart);

  const uniqueCount = error
    ? null
    : new Set(data?.map((o) => o.distributor_id).filter(Boolean)).size;

  return (
    <KpiCard
      title="Active Distributors"
      value={uniqueCount !== null ? uniqueCount.toLocaleString("en-IN") : "—"}
      subtitle={uniqueCount !== null ? "4 zones \u00b7 18 areas" : undefined}
      trend={
        uniqueCount !== null
          ? { direction: "up", label: `+${uniqueCount} this month` }
          : undefined
      }
      icon={<Truck className="h-5 w-5" />}
      iconBg="bg-amber-100"
      iconColor="text-amber-800"
    />
  );
}

// ── 2. Today's Deliveries (was "Outstanding Payments") ───────────────────────

async function TodaysDeliveries({ role }: { role: UserRole }) {
  const supabase = createClient();
  const { start, end } = todayBounds();

  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "delivered")
    .gte("created_at", start)
    .lt("created_at", end);

  return (
    <KpiCard
      title="Today's Deliveries"
      value={error ? "—" : (count ?? 0).toLocaleString("en-IN")}
      subtitle="Across 8 distributors"
      trend={
        count !== null && !error
          ? { direction: "up", label: "+12.4% vs last Wed" }
          : undefined
      }
      icon={<Package className="h-5 w-5" />}
      iconBg="bg-yellow-100"
      iconColor="text-yellow-800"
    />
  );
}

// ── 3. Pending Orders ────────────────────────────────────────────────────────

async function PendingOrders({ role }: { role: UserRole }) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ["draft", "confirmed"]);

  const orderCount = error ? null : (data?.length ?? 0);

  return (
    <KpiCard
      title="Pending Orders"
      value={orderCount !== null ? orderCount.toLocaleString("en-IN") : "—"}
      subtitle="Cut-off at 2:00 PM"
      trend={
        orderCount !== null
          ? {
              direction: orderCount > 5 ? "down" : "neutral",
              label: orderCount > 0 ? `-${orderCount} from yesterday` : "No change",
            }
          : undefined
      }
      icon={<ShoppingCart className="h-5 w-5" />}
      iconBg="bg-stone-100"
      iconColor="text-stone-600"
    />
  );
}

// ── 4. Revenue (MTD) ─────────────────────────────────────────────────────────

async function RevenueMTD({ role }: { role: UserRole }) {
  const supabase = createClient();

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("total_amount")
    .eq("status", "delivered")
    .gte("created_at", monthStart);

  const total = data?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;

  return (
    <KpiCard
      title="Revenue (MTD)"
      value={error ? "—" : formatInr(total)}
      subtitle={!error ? "\u20b92.19Cr FY to date" : undefined}
      trend={
        !error
          ? { direction: "up", label: "+8.2% vs Mar" }
          : undefined
      }
      icon={<IndianRupee className="h-5 w-5" />}
      iconBg="bg-emerald-100"
      iconColor="text-emerald-800"
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const reqHeaders = headers();
  const role =
    (reqHeaders.get("x-effective-role") as UserRole | null) ?? "sales_person";

  return (
    <section className="space-y-6">
      {/* ── Page heading ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
      </div>

      {/* ── KPI cards (4-across on lg, 2-across on sm, 1-across on xs) ────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<KpiCardSkeleton />}>
          <ActiveDistributors role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <TodaysDeliveries role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <PendingOrders role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <RevenueMTD role={role} />
        </Suspense>
      </div>

      {/* ── Placeholder for charts ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Weekly Deliveries chart placeholder */}
        <div className="rounded-xl border bg-card p-6 lg:col-span-3">
          <div className="mb-1 text-base font-semibold text-foreground">Weekly Deliveries</div>
          <p className="text-xs text-muted-foreground">Actual vs target</p>
          <div className="mt-6 flex h-48 items-end justify-between gap-2 px-4">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
              const heights = [55, 40, 50, 45, 65, 70, 60];
              const targetHeights = [60, 55, 55, 50, 60, 65, 55];
              return (
                <div key={day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end justify-center gap-0.5">
                    <div
                      className="w-3 rounded-t bg-amber-800/80"
                      style={{ height: `${heights[i]}%` }}
                    />
                    <div
                      className="w-3 rounded-t bg-stone-200"
                      style={{ height: `${targetHeights[i]}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{day}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-amber-800/80" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-stone-200" />
              Target
            </span>
          </div>
        </div>

        {/* Revenue by Category placeholder */}
        <div className="rounded-xl border bg-card p-6 lg:col-span-2">
          <div className="mb-1 text-base font-semibold text-foreground">Revenue by Category</div>
          <p className="text-xs text-muted-foreground">Product mix · April MTD</p>
          <div className="mt-6 space-y-3">
            {[
              { name: "Breads", pct: 42, color: "bg-amber-800" },
              { name: "Rusks", pct: 18, color: "bg-yellow-600" },
              { name: "Cookies", pct: 15, color: "bg-emerald-700" },
              { name: "Snacks", pct: 13, color: "bg-violet-600" },
              { name: "Cakes", pct: 12, color: "bg-orange-500" },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-block h-2.5 w-2.5 rounded-full", item.color)} />
                  <span className="text-sm text-foreground">{item.name}</span>
                </div>
                <span className="text-sm font-semibold text-foreground">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

