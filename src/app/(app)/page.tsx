// src/app/(app)/page.tsx
// ---------------------------------------------------------------------------
// Distributor Home screen.
//
// Data: two RPCs — get_distributor_home (KPIs + header) and
// get_todays_deliveries (list underneath). Both are SECURITY INVOKER and
// scope to auth.uid() server-side.
//
// Layout:
//   [greeting + name]
//   [cut-off countdown card]
//   [2x2 KPI grid]
//   [Today's Deliveries list]
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Package,
  Banknote,
  BarChart3,
  Store as StoreIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import HomeLiveBlock from "./_components/HomeLiveBlock";
import KpiTile from "./_components/KpiTile";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

interface HomeRow {
  full_name: string | null;
  deliveries_count: number;
  cash_collected: number | string;
  skus_remaining: number | string;
  stores_on_beat: number;
  cutoff_time: string;
  cutoff_enabled: boolean;
  support_contact: string | null;
}

interface DeliveryRow {
  delivery_id: string;
  store_id: string;
  store_name: string | null;
  item_count: number;
  delivered_at: string;
  total_value: number | string;
}

function formatInr(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export default async function HomePage() {
  const supabase = createClient();

  // Belt-and-braces: layout already redirects unauthenticated, but we check
  // again so RPC calls below never fire with a null auth.uid().
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Parallel fetch — both RPCs are independent.
  const [homeRes, deliveriesRes] = await Promise.all([
    supabase.rpc("get_distributor_home"),
    supabase.rpc("get_todays_deliveries"),
  ]);

  const home = (homeRes.data ?? [])[0] as HomeRow | undefined;
  const deliveries = (deliveriesRes.data ?? []) as DeliveryRow[];

  const fullName = home?.full_name ?? "Distributor";
  const cutoffTime = home?.cutoff_time ?? "14:00";
  const cutoffEnabled = home?.cutoff_enabled ?? true;

  return (
    <div className="px-4 pb-4 pt-1">
      <HomeLiveBlock
        fullName={fullName}
        cutoffTime={cutoffTime}
        cutoffEnabled={cutoffEnabled}
      />

      {/* ── KPI grid (2x2) ──────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <KpiTile
          icon={Package}
          value={String(home?.deliveries_count ?? 0)}
          label="Deliveries"
          iconBg="bg-orange-50"
          iconFg="text-orange-700"
        />
        <KpiTile
          icon={Banknote}
          value={formatInr(home?.cash_collected)}
          label="Cash Collected"
          iconBg="bg-emerald-50"
          iconFg="text-emerald-700"
        />
        <KpiTile
          icon={BarChart3}
          value={String(home?.skus_remaining ?? 0)}
          label="SKUs Remaining"
          iconBg="bg-amber-50"
          iconFg="text-amber-700"
        />
        <KpiTile
          icon={StoreIcon}
          value={String(home?.stores_on_beat ?? 0)}
          label="Stores on Beat"
          iconBg="bg-sky-50"
          iconFg="text-sky-700"
        />
      </div>

      {/* ── Today's Deliveries list ─────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Today's Deliveries</h2>
        </header>

        {deliveries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No deliveries logged yet today.
          </div>
        ) : (
          <ul className="divide-y">
            {deliveries.map((d) => (
              <li
                key={d.delivery_id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {d.store_name ?? "(unnamed store)"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {d.item_count} {d.item_count === 1 ? "item" : "items"} ·{" "}
                    {formatTime(d.delivered_at)}
                  </p>
                </div>
                <span className="ml-3 shrink-0 text-sm font-semibold text-emerald-600 tabular-nums">
                  {formatInr(d.total_value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
