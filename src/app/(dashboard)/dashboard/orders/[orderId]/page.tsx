// src/app/(dashboard)/dashboard/orders/[orderId]/page.tsx
// ---------------------------------------------------------------------------
// Order detail — line items, status, customer, and (for super_admin) a
// manual "Generate Bill" action.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getOrderDetail } from "../../../orders/actions";
import { formatInr, formatIstDate, formatIstDateTime } from "../../../ss/_lib/format";
import GenerateBillButton from "./_components/GenerateBillButton";

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

  const order = await getOrderDetail(params.orderId);
  if (!order) notFound();

  const subTotal = order.items.reduce((a, i) => a + i.line_total, 0);

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
            {canGenerateBill && order.status === "billed" && (
              <span className="text-xs text-muted-foreground">Already billed</span>
            )}
          </div>
        </div>
      </header>

      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Line items</h2>
          <span className="text-xs text-muted-foreground">
            {order.items.length} item{order.items.length === 1 ? "" : "s"}
          </span>
        </div>

        {order.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            This order has no line items.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Unit price</th>
                <th className="px-4 py-2 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-2">{it.product_name ?? "(unknown)"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatInr(it.unit_price)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatInr(it.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-4 py-2 text-right" colSpan={3}>
                  Sub-total
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatInr(subTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
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
