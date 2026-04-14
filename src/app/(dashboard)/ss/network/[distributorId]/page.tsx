// src/app/(dashboard)/ss/network/[distributorId]/page.tsx
// ---------------------------------------------------------------------------
// Distributor drilldown for SS — read-only.
//
// Sections:
//   - Header: name, contact, zone/area, status
//   - Payment summary (4 cards): billed / delivered / paid / outstanding
//   - Recent orders (10)
//   - Recent deliveries (10)
//
// The SS cannot edit anything — there are no action buttons.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Receipt,
  Truck,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { getDistributorOverview } from "../actions";
import { NotSuperStockistError } from "../../_lib/scope";
import { formatInr, formatIstDate, formatIstDateTime } from "../../_lib/format";

export const metadata: Metadata = { title: "Distributor Detail" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: { distributorId: string };
}

export default async function DistributorDetailPage({ params }: PageProps) {
  let result;
  try {
    result = await getDistributorOverview(params.distributorId);
  } catch (err) {
    if (err instanceof NotSuperStockistError) redirect("/dashboard");
    throw err;
  }

  if (result.error?.includes("not part of your network")) {
    redirect("/ss/network");
  }
  if (!result.overview) notFound();

  const { distributor, recentOrders, recentDeliveries, paymentSummary } = result.overview;

  return (
    <div className="p-6">
      <Link
        href="/ss/network"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to network
      </Link>

      {/* Header */}
      <header className="mb-6 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">{distributor.name}</h1>
              <StatusBadge status={distributor.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {distributor.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {distributor.phone}
                </span>
              )}
              {distributor.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {distributor.email}
                </span>
              )}
              {(distributor.zone || distributor.area) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {[distributor.zone, distributor.area].filter(Boolean).join(" / ")}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Payment summary */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Payment summary</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            icon={<Receipt className="h-4 w-4" />}
            label="Total billed"
            value={formatInr(paymentSummary.totalBilled)}
          />
          <SummaryCard
            icon={<Truck className="h-4 w-4" />}
            label="Total delivered"
            value={formatInr(paymentSummary.totalDelivered)}
          />
          <SummaryCard
            icon={<Wallet className="h-4 w-4" />}
            label="Total paid"
            value={formatInr(paymentSummary.totalPaid)}
            sub={
              paymentSummary.lastPaymentAt
                ? `Last: ${formatIstDate(paymentSummary.lastPaymentAt)}`
                : "No payments yet"
            }
          />
          <SummaryCard
            icon={<AlertCircle className="h-4 w-4" />}
            label="Outstanding"
            value={formatInr(paymentSummary.outstanding)}
            tone={paymentSummary.outstanding > 0 ? "warning" : "success"}
          />
        </div>
      </section>

      {/* Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Orders */}
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">Recent orders</h2>
            <span className="text-xs text-muted-foreground">last 10</span>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyRow message="No orders yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 font-mono text-xs">{o.orderNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatIstDate(o.orderDate)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {o.status ?? "pending"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.itemCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInr(o.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Deliveries */}
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">Recent deliveries</h2>
            <span className="text-xs text-muted-foreground">last 10</span>
          </div>
          {recentDeliveries.length === 0 ? (
            <EmptyRow message="No deliveries yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Delivered at</th>
                  <th className="px-3 py-2 text-left font-medium">Store</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentDeliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatIstDateTime(d.deliveredAt)}
                    </td>
                    <td className="px-3 py-2">{d.storeName ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.itemCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInr(d.totalValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Internal components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return status === "active" ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Active
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      Inactive
    </span>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning";
}) {
  const valueClass =
    tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{message}</div>;
}
