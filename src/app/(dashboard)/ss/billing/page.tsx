// src/app/(dashboard)/ss/billing/page.tsx
// ---------------------------------------------------------------------------
// SS → Billing Report
//
// Server shell: gates access, loads the distributor dropdown, and hands off
// to the client for filter + table + xlsx export.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchNetworkDistributorsLite } from "./actions";
import { NotSuperStockistError } from "../_lib/scope";
import BillingClient from "./_components/BillingClient";
import { defaultDateRange } from "../_lib/format";

export const metadata: Metadata = { title: "Billing Report" };
export const dynamic = "force-dynamic";

export default async function BillingReportPage() {
  let distributors;
  try {
    distributors = await fetchNetworkDistributorsLite();
  } catch (err) {
    if (err instanceof NotSuperStockistError) redirect("/dashboard");
    throw err;
  }

  const { from, to } = defaultDateRange(30);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Billing Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoice history for distributors in your network. Filter by date range, distributor,
          and payment status, then export to Excel.
        </p>
      </header>

      <BillingClient
        distributors={distributors.rows}
        defaultFrom={from}
        defaultTo={to}
        loadError={distributors.error}
      />
    </div>
  );
}
