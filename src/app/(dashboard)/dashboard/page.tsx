// src/app/(dashboard)/page.tsx
// ---------------------------------------------------------------------------
// Dashboard home — Server Component.
//
// Each KPI is fetched by its own async sub-component wrapped in <Suspense>,
// so the page streams: skeletons appear immediately while the DB queries run
// concurrently.  This gives the "loading skeleton while data fetches" UX
// without any client-side fetch or useEffect.
//
// Role-scoped data:
//   super_admin    → sees platform-wide aggregates
//   super_stockist → sees data for their distributor network (RLS-enforced)
//   sales_person   → sees data for their assigned area    (RLS-enforced)
//
// NOTE: The fill-rate and active-stores queries are best-effort with the
// current schema (only `orders` is fully typed).  Replace the placeholder
// queries with your own once the stores / inventory tables are added and
// types are regenerated with `npx supabase gen types typescript`.
// ---------------------------------------------------------------------------

import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { Truck, CreditCard, Store, BarChart2 } from "lucide-react";
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
// Each is an async Server Component.  Wrap each in <Suspense> to enable
// streaming and show a skeleton while the DB query is in-flight.

// ── 1. Deliveries Today ───────────────────────────────────────────────────────

async function DeliveriesToday({ role }: { role: UserRole }) {
  const supabase = createClient();
  const { start, end } = todayBounds();

  // RLS policies enforce row-level scoping for non-SA roles automatically.
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "delivered")
    .gte("created_at", start)
    .lt("created_at", end);

  return (
    <KpiCard
      title="Deliveries Today"
      value={error ? "—" : (count ?? 0).toLocaleString("en-IN")}
      trend={
        count !== null && !error
          ? { direction: "up", label: `${count} completed`, qualifier: "today" }
          : undefined
      }
      icon={<Truck className="h-4 w-4" />}
    />
  );
}

// ── 2. Outstanding Payments ───────────────────────────────────────────────────

async function OutstandingPayments({ role }: { role: UserRole }) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("orders")
    .select("total_amount, status")
    .in("status", ["draft", "confirmed"]);

  const total = data?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;
  const orderCount = data?.length ?? 0;

  return (
    <KpiCard
      title="Outstanding Payments"
      value={error ? "—" : formatInr(total)}
      trend={
        !error
          ? {
              direction: orderCount > 0 ? "down" : "neutral",
              label: `${orderCount} order${orderCount !== 1 ? "s" : ""}`,
              qualifier: "pending",
            }
          : undefined
      }
      icon={<CreditCard className="h-4 w-4" />}
    />
  );
}

// ── 3. Active Stores ──────────────────────────────────────────────────────────
// Proxy: count distinct distributor_ids with an order in the current month.
// Replace with a direct `stores` table query once that table exists.

async function ActiveStores({ role }: { role: UserRole }) {
  const supabase = createClient();

  // Start-of-current-month in UTC
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
      title="Active Stores"
      value={uniqueCount !== null ? uniqueCount.toLocaleString("en-IN") : "—"}
      trend={
        uniqueCount !== null
          ? {
              direction: "up",
              label: `${uniqueCount} stores`,
              qualifier: "ordering this month",
            }
          : undefined
      }
      icon={<Store className="h-4 w-4" />}
    />
  );
}

// ── 4. Fill Rate ──────────────────────────────────────────────────────────────
// delivered ÷ (delivered + cancelled) over the trailing 30 days.

async function FillRate({ role }: { role: UserRole }) {
  const supabase = createClient();

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("status")
    .in("status", ["delivered", "cancelled"])
    .gte("created_at", since);

  let value = "—";
  let direction: "up" | "down" | "neutral" = "neutral";
  let label = "no data";

  if (!error && data && data.length > 0) {
    const delivered = data.filter((o) => o.status === "delivered").length;
    const rate = Math.round((delivered / data.length) * 100);
    value = `${rate}%`;
    direction = rate >= 90 ? "up" : rate >= 70 ? "neutral" : "down";
    label = `${rate}% fulfilled`;
  }

  return (
    <KpiCard
      title="Fill Rate"
      value={value}
      trend={
        value !== "—"
          ? { direction, label, qualifier: "last 30 days" }
          : undefined
      }
      icon={<BarChart2 className="h-4 w-4" />}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // Read the effective role forwarded by middleware so KPI sub-components
  // can pass it to their queries (RLS handles the actual filtering).
  const reqHeaders = headers();
  const role =
    (reqHeaders.get("x-effective-role") as UserRole | null) ?? "sales_person";

  return (
    <section className="space-y-6">
      {/* ── Page heading ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back — here&apos;s what&apos;s happening today.
        </p>
      </div>

      {/* ── KPI cards (4-across on lg, 2-across on sm, 1-across on xs) ────── */}
      {/*
        Each card is wrapped in its own <Suspense> so they stream independently.
        If one DB query is slow the others still render when ready.
      */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<KpiCardSkeleton />}>
          <DeliveriesToday role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <OutstandingPayments role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <ActiveStores role={role} />
        </Suspense>

        <Suspense fallback={<KpiCardSkeleton />}>
          <FillRate role={role} />
        </Suspense>
      </div>

      {/* ── Placeholder for charts / activity feed ────────────────────────── */}
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Charts and activity feed are coming in the next sprint.
      </div>
    </section>
  );
}
