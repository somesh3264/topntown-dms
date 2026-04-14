// src/app/(dashboard)/ss/payments/page.tsx
// ---------------------------------------------------------------------------
// SS → Payment Tracking
//
// Server shell: gates access to super_stockist, fetches the overview + open
// orders up front, and renders the client for history / log-payment.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertCircle, Clock, Landmark, Wallet } from "lucide-react";
import { getPaymentOverview, listOpenOrders } from "./actions";
import { NotSuperStockistError } from "../_lib/scope";
import PaymentsClient from "./_components/PaymentsClient";
import { defaultDateRange, formatInr, formatIstDate } from "../_lib/format";

export const metadata: Metadata = { title: "Payment Tracking" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  let overview;
  let openOrders;
  try {
    [overview, openOrders] = await Promise.all([getPaymentOverview(), listOpenOrders()]);
  } catch (err) {
    if (err instanceof NotSuperStockistError) redirect("/dashboard");
    throw err;
  }

  const { from, to } = defaultDateRange(60);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Payment Tracking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log payments to Top N Town at the time of order and review your payment history.
        </p>
      </header>

      {overview.isImpersonating && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
          You&rsquo;re viewing this page as a super admin. Payment logging is disabled — log in
          as a super stockist to record a payment.
        </div>
      )}

      {overview.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          Could not load overview: {overview.error}
        </div>
      )}

      {/* Outstanding balance card — the headline metric. */}
      <section className="mb-6 grid gap-3 md:grid-cols-4">
        <OutstandingCard amount={overview.overview.outstanding} />
        <SmallCard
          icon={<Landmark className="h-4 w-4" />}
          label="Total ordered"
          value={formatInr(overview.overview.totalOrderedValue)}
        />
        <SmallCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total paid"
          value={formatInr(overview.overview.totalPaid)}
          sub={
            overview.overview.lastPaymentAt
              ? `Last: ${formatIstDate(overview.overview.lastPaymentAt)}`
              : "No confirmed payments"
          }
        />
        <SmallCard
          icon={<Clock className="h-4 w-4" />}
          label="Pending confirmation"
          value={formatInr(overview.overview.totalPending)}
          sub={`${overview.overview.paymentsCount} payment${
            overview.overview.paymentsCount === 1 ? "" : "s"
          } logged`}
        />
      </section>

      <PaymentsClient
        openOrders={openOrders.rows}
        canLogPayment={!overview.isImpersonating}
        defaultFrom={from}
        defaultTo={to}
        openOrdersError={openOrders.error}
      />
    </div>
  );
}

// ─── Internal components ──────────────────────────────────────────────────────

function OutstandingCard({ amount }: { amount: number }) {
  const hasBalance = amount > 0;
  return (
    <div
      className={`rounded-lg border p-4 md:col-span-1 ${
        hasBalance
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
          : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20"
      }`}
    >
      <div
        className={`flex items-center gap-2 text-xs uppercase tracking-wide ${
          hasBalance
            ? "text-amber-700 dark:text-amber-400"
            : "text-emerald-700 dark:text-emerald-400"
        }`}
      >
        <AlertCircle className="h-4 w-4" />
        Outstanding balance
      </div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          hasBalance
            ? "text-amber-700 dark:text-amber-300"
            : "text-emerald-700 dark:text-emerald-300"
        }`}
      >
        {formatInr(amount)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {hasBalance ? "Owed to Top N Town." : "All orders settled."}
      </div>
    </div>
  );
}

function SmallCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
