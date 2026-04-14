// src/app/(dashboard)/dashboard/reports/page.tsx
// ---------------------------------------------------------------------------
// Reports — Super Admin / SS / SP scoped reporting module.
//
// Tabs:
//   1. Inventory              (stock_allocations)
//   2. Sales                  (delivery_items)
//   3. Order vs. Fulfilment   (orders vs. stock_allocations)
//   4. Tax / GST              (bill_items)
//   5. Product Master         (products — read-only)
//
// Role scoping is enforced inside every server action in actions.ts via
// resolveReportScope() — the client is never trusted to filter.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchFilterOptions } from "./actions";
import { ReportsShell } from "./_components/ReportsShell";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  const role = (profile as { role?: string } | null)?.role;
  // Only staff roles see Reports. Distributors run their own reports via the
  // Android app — the web dashboard is staff-only for this module.
  if (role !== "super_admin" && role !== "super_stockist" && role !== "sales_person") {
    redirect("/dashboard");
  }

  const options = await fetchFilterOptions();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold">Reports</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {role === "super_admin"
          ? "Company-wide reports across every zone and distributor."
          : role === "super_stockist"
            ? "Reports scoped to distributors in your network."
            : "Reports scoped to distributors in your assigned area."}
      </p>
      <ReportsShell options={options} />
    </div>
  );
}
