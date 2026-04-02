// src/app/(app)/page.tsx
// ---------------------------------------------------------------------------
// Distributor home — mobile-first PWA landing screen.
// Shows pending orders, outstanding balance, and quick-action buttons.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Home",
};

export default async function AppHomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TODO: replace with real queries scoped to this distributor
  // const { data: pendingOrders } = await supabase
  //   .from("orders")
  //   .select("id, status, total, created_at")
  //   .eq("distributor_id", user?.id)
  //   .eq("status", "pending")
  //   .order("created_at", { ascending: false });

  return (
    <div className="space-y-4 p-4">
      {/* Greeting */}
      <section className="rounded-xl bg-brand-600 p-5 text-white shadow-md">
        <p className="text-sm opacity-80">Welcome back,</p>
        <p className="mt-0.5 text-xl font-bold truncate">{user?.email}</p>
      </section>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Pending Orders", value: "—" },
          { label: "Outstanding Balance", value: "—" },
          { label: "Last Order", value: "—" },
          { label: "Credit Limit", value: "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Place Order", href: "/app/orders/new" },
            { label: "View Orders", href: "/app/orders" },
            { label: "Payments", href: "/app/payments" },
            { label: "Products", href: "/app/products" },
          ].map((action) => (
            <a
              key={action.href}
              href={action.href}
              className="flex items-center justify-center rounded-xl border bg-card px-4 py-5 text-sm font-medium shadow-sm hover:bg-accent active:scale-95 transition-transform"
            >
              {action.label}
            </a>
          ))}
        </div>
      </section>

      {/* TODO: recent orders list */}
    </div>
  );
}
