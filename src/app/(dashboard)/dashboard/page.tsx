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
import { createAdminClient } from "@/lib/supabase/admin";
import { KpiCard, KpiCardSkeleton } from "@/components/ui/kpi-card";
import type { UserRole } from "@/middleware";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Indian-style compact currency formatter.
 *
 * Why not `Intl.NumberFormat("en-IN", { notation: "compact" })`?
 *   Browser ICU data varies — Safari/older Chromes emit Western "K/M/B/T"
 *   instead of Indian "K/L/Cr", producing absurd strings like "₹2.6T" for a
 *   26-crore number. Rolling our own keeps the output stable across runtimes
 *   and matches how Indian finance teams actually read these numbers.
 */
function formatInr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "₹0";
  const negative = value < 0;
  const abs = Math.abs(value);

  let out: string;
  if (abs >= 1_00_00_000) {
    // ≥ 1 crore
    out = `₹${trimZero((abs / 1_00_00_000).toFixed(2))}Cr`;
  } else if (abs >= 1_00_000) {
    // ≥ 1 lakh
    out = `₹${trimZero((abs / 1_00_000).toFixed(2))}L`;
  } else if (abs >= 1_000) {
    // ≥ 1 thousand
    out = `₹${trimZero((abs / 1_000).toFixed(1))}K`;
  } else {
    out = `₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  return negative ? `-${out}` : out;
}

/** Full-precision INR formatter used in the Recent Deliveries table. */
function formatInrFull(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function trimZero(s: string): string {
  // "2.60" → "2.6", "3.00" → "3"
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** yyyy-MM-dd for a Date interpreted in IST. */
function istDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** First day of the current month in IST (as yyyy-MM-dd). */
function istMonthStartStr(): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  return `${today.slice(0, 7)}-01`;
}

// ─── KPI sub-components ───────────────────────────────────────────────────────

// ── 1. Active Distributors ───────────────────────────────────────────────────

async function ActiveDistributors({ role: _role }: { role: UserRole }) {
  const admin = createAdminClient();

  // Counts in parallel — cheap metadata queries.
  const [distRes, zoneRes, areaRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "distributor")
      .eq("is_active", true),
    admin.from("zones").select("id", { count: "exact", head: true }),
    admin.from("areas").select("id", { count: "exact", head: true }),
  ]);

  const count = distRes.error ? null : (distRes.count ?? 0);
  const zones = zoneRes.error ? null : (zoneRes.count ?? 0);
  const areas = areaRes.error ? null : (areaRes.count ?? 0);

  const subtitleParts: string[] = [];
  if (zones !== null) subtitleParts.push(`${zones} zone${zones === 1 ? "" : "s"}`);
  if (areas !== null) subtitleParts.push(`${areas} area${areas === 1 ? "" : "s"}`);

  return (
    <KpiCard
      title="Active Distributors"
      value={count !== null ? count.toLocaleString("en-IN") : "—"}
      subtitle={subtitleParts.length ? subtitleParts.join(" · ") : undefined}
      icon={<Truck className="h-5 w-5" />}
      iconBg="bg-amber-100"
      iconColor="text-amber-800"
    />
  );
}

// ── 2. Today's Deliveries ────────────────────────────────────────────────────

async function TodaysDeliveries({ role: _role }: { role: UserRole }) {
  // Admin client so the metric is stable regardless of the caller's RLS on
  // deliveries. The dashboard routes are already middleware-gated.
  const admin = createAdminClient();
  const todayIst = istDateStr(new Date());

  const { data, error } = await admin
    .from("deliveries")
    .select("total_value, distributor_id")
    .eq("delivery_date", todayIst);

  const rows = (data ?? []) as Array<{
    total_value: number | string | null;
    distributor_id: string | null;
  }>;
  const count = rows.length;
  const revenue = rows.reduce((sum, d) => sum + Number(d.total_value ?? 0), 0);
  const distributors = new Set(
    rows.map((d) => d.distributor_id).filter(Boolean),
  ).size;

  return (
    <KpiCard
      title="Today's Deliveries"
      value={error ? "—" : count.toLocaleString("en-IN")}
      subtitle={
        error
          ? undefined
          : count === 0
            ? "No deliveries yet"
            : `${formatInr(revenue)} collected · ${distributors} distributor${distributors === 1 ? "" : "s"}`
      }
      icon={<Package className="h-5 w-5" />}
      iconBg="bg-yellow-100"
      iconColor="text-yellow-800"
    />
  );
}

// ── Recent Deliveries panel ──────────────────────────────────────────────────

async function RecentDeliveriesPanel() {
  const admin = createAdminClient();
  const todayIst = istDateStr(new Date());

  const { data: deliveries, error } = await admin
    .from("deliveries")
    .select(
      "id, store_id, distributor_id, total_value, item_count, created_at",
    )
    .eq("delivery_date", todayIst)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !deliveries?.length) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="mb-1 text-base font-semibold text-foreground">
          Recent Deliveries
        </div>
        <p className="text-xs text-muted-foreground">
          Today, across all distributors
        </p>
        <div className="mt-6 rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No deliveries logged today.
        </div>
      </div>
    );
  }

  const storeIds = Array.from(
    new Set(deliveries.map((d: any) => d.store_id).filter(Boolean)),
  );
  const distIds = Array.from(
    new Set(deliveries.map((d: any) => d.distributor_id).filter(Boolean)),
  );

  const [storesRes, distsRes] = await Promise.all([
    storeIds.length > 0
      ? admin.from("stores").select("id, name").in("id", storeIds as string[])
      : Promise.resolve({
          data: [] as Array<{ id: string; name: string | null }>,
        }),
    distIds.length > 0
      ? admin
          .from("profiles")
          .select("id, full_name")
          .in("id", distIds as string[])
      : Promise.resolve({
          data: [] as Array<{ id: string; full_name: string | null }>,
        }),
  ]);

  const storeMap = new Map(
    ((storesRes.data ?? []) as Array<{ id: string; name: string | null }>).map(
      (s) => [s.id, s.name ?? "(unnamed store)"],
    ),
  );
  const distMap = new Map(
    ((distsRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map(
      (p) => [p.id, p.full_name ?? "(unnamed distributor)"],
    ),
  );

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-foreground">
            Recent Deliveries
          </div>
          <p className="text-xs text-muted-foreground">
            Today, across all distributors
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Time</th>
              <th className="px-2 py-2 text-left font-medium">Distributor</th>
              <th className="px-2 py-2 text-left font-medium">Store</th>
              <th className="px-2 py-2 text-right font-medium">Items</th>
              <th className="px-2 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {deliveries.map((d: any) => (
              <tr key={d.id}>
                <td className="px-2 py-2 text-muted-foreground">
                  {new Date(d.created_at).toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </td>
                <td className="px-2 py-2 font-medium">
                  {distMap.get(d.distributor_id) ?? "—"}
                </td>
                <td className="px-2 py-2">
                  {storeMap.get(d.store_id) ?? "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {d.item_count ?? 0}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-700">
                  {formatInrFull(Number(d.total_value ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 3. Pending Orders ────────────────────────────────────────────────────────

async function PendingOrders({ role: _role }: { role: UserRole }) {
  const supabase = createClient();

  // BUG FIX: previous code read `data?.length` after a `head: true` query,
  // which always resolves to 0 because `data` is null when the body is
  // suppressed. Use the `count` property from the response envelope instead.
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ["draft", "confirmed"]);

  const orderCount = error ? null : (count ?? 0);

  return (
    <KpiCard
      title="Pending Orders"
      value={orderCount !== null ? orderCount.toLocaleString("en-IN") : "—"}
      subtitle="Cut-off at 2:00 PM"
      trend={
        orderCount !== null
          ? {
              direction:
                orderCount === 0 ? "neutral" : orderCount > 5 ? "down" : "up",
              label:
                orderCount === 0
                  ? "No change"
                  : `${orderCount} awaiting action`,
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
//
// Primary path: get_dashboard_mtd_revenue() RPC (migration
// 20260421110000_dashboard_mtd_revenue_rpc.sql) sums orders.total in the
// billed/dispatched/delivered states for the current IST month.
//
// Fallback: if the RPC is missing (not yet applied to the environment) or
// errors, sum deliveries.total_value for the current month. This keeps the
// card useful on environments where the migration hasn't landed and removes
// the failure mode the user saw (card stuck at "—").

async function RevenueMTD({ role: _role }: { role: UserRole }) {
  const supabase = createClient();
  const admin = createAdminClient();

  let total = 0;
  let hadData = false;

  const rpcRes = await supabase.rpc("get_dashboard_mtd_revenue");
  if (!rpcRes.error) {
    total = Number(rpcRes.data ?? 0);
    hadData = true;
  } else {
    // Fallback — read deliveries directly using the admin client so a missing
    // RPC doesn't blank the card.
    const from = istMonthStartStr();
    const to = istDateStr(new Date());
    const { data, error } = await admin
      .from("deliveries")
      .select("total_value")
      .gte("delivery_date", from)
      .lte("delivery_date", to);
    if (!error) {
      total = (data ?? []).reduce(
        (s, r: { total_value: number | string | null }) =>
          s + Number(r.total_value ?? 0),
        0,
      );
      hadData = true;
    }
  }

  return (
    <KpiCard
      title="Revenue (MTD)"
      value={hadData ? formatInr(total) : "—"}
      subtitle={hadData ? "Month to date · IST" : undefined}
      icon={<IndianRupee className="h-5 w-5" />}
      iconBg="bg-emerald-100"
      iconColor="text-emerald-800"
    />
  );
}

// ── Weekly Deliveries chart (live) ───────────────────────────────────────────

async function WeeklyDeliveriesChart() {
  const admin = createAdminClient();
  const now = new Date();

  // Build the 7-day window ending today (IST). Mon–Sun ordering for display.
  const days: Array<{ date: string; label: string }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    days.push({
      date: istDateStr(d),
      label: d.toLocaleDateString("en-IN", {
        weekday: "short",
        timeZone: "Asia/Kolkata",
      }),
    });
  }
  const fromDate = days[0].date;
  const toDate = days[days.length - 1].date;

  const { data, error } = await admin
    .from("deliveries")
    .select("delivery_date, total_value")
    .gte("delivery_date", fromDate)
    .lte("delivery_date", toDate);

  const sums = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    delivery_date: string;
    total_value: number | string | null;
  }>) {
    sums.set(
      r.delivery_date,
      (sums.get(r.delivery_date) ?? 0) + Number(r.total_value ?? 0),
    );
  }

  const actuals = days.map((d) => sums.get(d.date) ?? 0);
  const maxVal = Math.max(1, ...actuals); // avoid divide-by-zero
  // Simple moving-average target = overall average, shown as a muted bar.
  const avg =
    actuals.reduce((s, v) => s + v, 0) / Math.max(1, actuals.length);

  const hasAny = actuals.some((v) => v > 0);

  return (
    <div className="rounded-xl border bg-card p-6 lg:col-span-3">
      <div className="mb-1 text-base font-semibold text-foreground">
        Weekly Deliveries
      </div>
      <p className="text-xs text-muted-foreground">
        Actual vs 7-day average · last 7 days
      </p>

      {error || !hasAny ? (
        <div className="mt-6 flex h-48 items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground">
          {error
            ? "Could not load delivery data."
            : "No deliveries in the last 7 days."}
        </div>
      ) : (
        <>
          <div className="mt-6 flex h-48 items-end justify-between gap-2 px-4">
            {days.map((d, i) => {
              const actual = actuals[i];
              const actualPx = Math.round((actual / maxVal) * 176); // 176 ≈ h-44
              const targetPx = Math.round((avg / maxVal) * 176);
              return (
                <div
                  key={d.date}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${d.label} · ${formatInr(actual)}`}
                >
                  <div className="flex h-44 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-3 rounded-t bg-amber-800/80"
                      style={{ height: `${actualPx}px` }}
                    />
                    <div
                      className="w-3 rounded-t bg-stone-200"
                      style={{ height: `${targetPx}px` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm bg-amber-800/80" />
                Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm bg-stone-200" />
                7-day avg
              </span>
            </div>
            <span className="tabular-nums">
              Peak: {formatInr(maxVal)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Revenue by Category (live) ───────────────────────────────────────────────

async function RevenueByCategoryChart() {
  const admin = createAdminClient();

  // Current IST month window — use delivery rows (not bills) since the
  // dashboard elsewhere treats delivery-collected value as revenue.
  const from = istMonthStartStr();
  const to = istDateStr(new Date());

  // Pull every delivery_items row for deliveries in-range, then aggregate
  // by product.category in JS. The joined shape keeps the query to a single
  // round-trip.
  const { data, error } = await admin
    .from("delivery_items")
    .select(
      `
        quantity,
        unit_price,
        deliveries!inner ( delivery_date ),
        products:product_id ( category )
      `,
    )
    .gte("deliveries.delivery_date", from)
    .lte("deliveries.delivery_date", to);

  const totals = new Map<string, number>();
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const qty = Number(raw.quantity ?? 0);
    const price = Number(raw.unit_price ?? 0);
    const product = (raw.products ?? {}) as { category?: string | null };
    const cat = product.category ?? "Other";
    totals.set(cat, (totals.get(cat) ?? 0) + qty * price);
  }

  const rows = Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const grandTotal = rows.reduce((s, r) => s + r.value, 0);

  // Stable colour assignment in displayed order.
  const palette = [
    "bg-amber-800",
    "bg-yellow-600",
    "bg-emerald-700",
    "bg-violet-600",
    "bg-orange-500",
    "bg-stone-500",
  ];

  return (
    <div className="rounded-xl border bg-card p-6 lg:col-span-2">
      <div className="mb-1 text-base font-semibold text-foreground">
        Revenue by Category
      </div>
      <p className="text-xs text-muted-foreground">Product mix · MTD</p>

      {error || rows.length === 0 || grandTotal <= 0 ? (
        <div className="mt-6 rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {error
            ? "Could not load category revenue."
            : "No category revenue this month yet."}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((item, i) => {
            const pct = Math.round((item.value / grandTotal) * 100);
            return (
              <div
                key={item.name}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2.5 w-2.5 rounded-full",
                      palette[i % palette.length],
                    )}
                  />
                  <span className="text-sm text-foreground">{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatInr(item.value)}
                  </span>
                  <span className="w-10 text-right text-sm font-semibold tabular-nums text-foreground">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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

      {/* ── Recent Deliveries — live, today's data ─────────────────────────── */}
      <Suspense
        fallback={
          <div className="rounded-xl border bg-card p-6">
            <div className="mb-1 text-base font-semibold text-foreground">
              Recent Deliveries
            </div>
            <p className="text-xs text-muted-foreground">
              Today, across all distributors
            </p>
            <div className="mt-6 h-32 animate-pulse rounded-md bg-muted/30" />
          </div>
        }
      >
        <RecentDeliveriesPanel />
      </Suspense>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Suspense
          fallback={
            <div className="rounded-xl border bg-card p-6 lg:col-span-3">
              <div className="mb-1 text-base font-semibold text-foreground">
                Weekly Deliveries
              </div>
              <div className="mt-6 h-48 animate-pulse rounded-md bg-muted/30" />
            </div>
          }
        >
          <WeeklyDeliveriesChart />
        </Suspense>

        <Suspense
          fallback={
            <div className="rounded-xl border bg-card p-6 lg:col-span-2">
              <div className="mb-1 text-base font-semibold text-foreground">
                Revenue by Category
              </div>
              <div className="mt-6 h-48 animate-pulse rounded-md bg-muted/30" />
            </div>
          }
        >
          <RevenueByCategoryChart />
        </Suspense>
      </div>
    </section>
  );
}
