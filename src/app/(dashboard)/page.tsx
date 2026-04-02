// src/app/(dashboard)/page.tsx
// ---------------------------------------------------------------------------
// Dashboard home — summary cards for Super Admin / SS / Sales Person.
// Server Component: data is fetched directly with the server Supabase client.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const supabase = createClient();

  // ---- Example data fetch (replace with real queries) --------------------
  // const { data: orders } = await supabase
  //   .from("orders")
  //   .select("id, status, total")
  //   .order("created_at", { ascending: false })
  //   .limit(5);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Welcome back — here's what's happening today.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Orders", value: "—" },
          { label: "Pending Dispatch", value: "—" },
          { label: "Active Distributors", value: "—" },
          { label: "Revenue (MTD)", value: "—" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border bg-card p-5 shadow-sm"
          >
            <p className="text-sm font-medium text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      {/* TODO: Add charts, recent orders table, activity feed */}
      <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
        Charts and data tables will render here once connected to Supabase.
      </div>
    </section>
  );
}
