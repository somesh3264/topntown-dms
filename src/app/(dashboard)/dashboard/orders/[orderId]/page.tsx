// src/app/(dashboard)/dashboard/orders/[orderId]/page.tsx
// ---------------------------------------------------------------------------
// Order detail — line items, status, customer, and (for super_admin) a
// manual "Generate Bill" action.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getOrderDetail,
  getOrderFormContext,
} from "../../../orders/actions";
import { isOrderEditableByAdmin } from "../../../orders/status";
import { formatInr, formatIstDate, formatIstDateTime } from "../../../ss/_lib/format";
import GenerateBillButton from "./_components/GenerateBillButton";
import BillCard from "./_components/BillCard";
import OrderItemsSection from "./_components/OrderItemsSection";
import MarkPickedUpButton from "./_components/MarkPickedUpButton";

export const metadata: Metadata = { title: "Order Detail" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: { orderId: string };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  const canGenerateBill = role === "super_admin";
  // Super admin and sales person can edit order line items from the dashboard.
  // (The server action re-checks the role — this gate is purely for UI.)
  const canEditItems = role === "super_admin" || role === "sales_person";
  // Only super_admin retains pickup capability on this screen; dispatch_manager
  // does it from /dashboard/dispatch. Sales person no longer marks pickup —
  // that moved to the factory-gate role.
  const canMarkPickup = role === "super_admin";

  const order = await getOrderDetail(params.orderId);
  if (!order) notFound();

  // Only load the product catalog when the viewer is actually allowed to
  // edit — saves a DB round-trip for distributors and SS viewing their own
  // orders. getOrderFormContext also enforces the role check server-side.
  const orderFormContext = canEditItems ? await getOrderFormContext() : null;

  return (
    <div className="p-6">
      <Link
        href="/dashboard/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <header className="mb-6 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">
                {order.distributor_name ?? "(unnamed distributor)"}
              </h1>
              <StatusBadge status={order.status} />
            </div>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground md:grid-cols-3">
              <span>
                <span className="text-xs uppercase tracking-wide">Order date</span>
                <br />
                <span className="text-foreground">{formatIstDate(order.order_date)}</span>
              </span>
              <span>
                <span className="text-xs uppercase tracking-wide">Placed at</span>
                <br />
                <span className="text-foreground">{formatIstDateTime(order.created_at)}</span>
              </span>
              <span>
                <span className="text-xs uppercase tracking-wide">Order ID</span>
                <br />
                <span className="font-mono text-xs text-foreground">{order.id}</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Order total
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatInr(order.total_amount)}
              </div>
            </div>
            {canGenerateBill && order.status === "confirmed" && (
              <GenerateBillButton orderId={order.id} />
            )}

            {/* Mark-as-picked-up action. Visible to super_admin + sales_person
                while the order is still in the editable window. Once clicked,
                status flips to 'dispatched', the timestamp is captured, and
                the edit-items flow across the whole page auto-locks via
                isOrderEditableByAdmin. */}
            {canMarkPickup && isOrderEditableByAdmin(order.status) && (
              <MarkPickedUpButton orderId={order.id} />
            )}

            {/* Post-pickup readout: once dispatched, show when + by whom. */}
            {order.picked_up_at && (
              <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                <PackageCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>
                  Picked up{" "}
                  <span className="text-foreground">
                    {formatIstDateTime(order.picked_up_at)}
                  </span>
                  {order.picked_up_by_name && (
                    <> · by {order.picked_up_by_name}</>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Bill card — shown once the order is billed ───────────────────── */}
      {order.status === "billed" && order.bill && (
        <BillCard bill={order.bill} canRetryPdf={canGenerateBill} />
      )}

      {/* Fallback: order marked billed but bill row not found (stale cache,
          partial generation). Keeps the UX honest rather than silently
          hiding the state. */}
      {order.status === "billed" && !order.bill && (
        <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          This order is marked as billed, but the bill record could not be
          located. Refresh in a moment; if the issue persists, contact support.
        </section>
      )}

      <OrderItemsSection
        orderId={order.id}
        orderStatus={order.status}
        initialItems={order.items}
        canEdit={canEditItems}
        products={orderFormContext?.products}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    confirmed: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    dispatched: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
    delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    billed: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };
  const cls = config[status] ?? "bg-muted text-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
