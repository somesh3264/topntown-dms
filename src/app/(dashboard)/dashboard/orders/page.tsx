// src/app/(dashboard)/dashboard/orders/page.tsx
// ---------------------------------------------------------------------------
// Orders — list view.
//
// Server component: gates the route to authenticated users, resolves the
// caller's role (for the "Generate Bill" affordance in the detail page),
// and renders the list using getOrders(). Row-level scoping is enforced by
// Supabase RLS on the `orders` table.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getOrders } from "../../orders/actions";
import { formatInr, formatIstDate } from "../../ss/_lib/format";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type Status = "all" | "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";

const STATUS_TABS: Array<{ value: Status; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "delivered", label: "Delivered" },
  { value: "billed", label: "Billed" },
  { value: "cancelled", label: "Cancelled" },
];

interface PageProps {
  searchParams?: { status?: string; date?: string; q?: string };
}

export default async function OrdersPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", authData.user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  // Super Admin + Sales Person may place orders on behalf of a distributor
  // from the dashboard. Anyone else just sees the list.
  const canPlaceOrder = role === "super_admin" || role === "sales_person";

  const statusFilter = (searchParams?.status as Status) ?? "all";
  const dateFilter = searchParams?.date ?? "";
  const q = (searchParams?.q ?? "").trim().toLowerCase();

  const rawOrders = await getOrders({
    status: statusFilter === "all" ? undefined : (statusFilter as Exclude<Status, "all">),
    date: dateFilter || undefined,
  });

  const orders = q
    ? rawOrders.filter(
        (o) =>
          (o.distributor_name ?? "").toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q),
      )
    : rawOrders;

  const totalValue = orders.reduce((a, o) => a + (o.total_amount ?? 0), 0);

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {role === "super_admin"
              ? "All orders across every zone and distributor."
              : role === "super_stockist"
                ? "Orders from distributors in your network."
                : role === "sales_person"
                  ? "Orders from distributors in your assigned area."
                  : "Your orders."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="rounded-md border bg-card px-3 py-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Shown
            </span>
            <span className="ml-2 font-semibold">{orders.length}</span>
          </div>
          <div className="rounded-md border bg-card px-3 py-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Value
            </span>
            <span className="ml-2 font-semibold tabular-nums">{formatInr(totalValue)}</span>
          </div>
          {canPlaceOrder && (
            <Link
              href="/dashboard/orders/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New order
            </Link>
          )}
        </div>
      </header>

      {/* Status tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b">
        {STATUS_TABS.map((t) => {
          const active = statusFilter === t.value;
          const params = new URLSearchParams();
          if (t.value !== "all") params.set("status", t.value);
          if (dateFilter) params.set("date", dateFilter);
          if (q) params.set("q", q);
          const href = params.toString() ? `?${params.toString()}` : "/dashboard/orders";
          return (
            <Link
              key={t.value}
              href={href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Filter bar (GET form — URL state = source of truth) */}
      <form method="GET" action="/dashboard/orders" className="mb-4 flex flex-wrap items-end gap-3">
        {statusFilter !== "all" && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Date
          <input
            type="date"
            name="date"
            defaultValue={dateFilter}
            className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search distributor or order id
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Type to filter…"
              className="w-full rounded-md border bg-background px-2 py-1.5 pl-7 text-sm text-foreground"
            />
          </div>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
        <Link
          href="/dashboard/orders"
          className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Reset
        </Link>
      </form>

      {/* Table */}
      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-12 text-center">
          <h2 className="text-base font-medium">No orders match these filters</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different status or clear the search.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Order date</th>
                <th className="px-4 py-3 text-left font-medium">Distributor</th>
                <th className="px-4 py-3 text-left font-medium">Order ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <tr key={o.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-2 text-muted-foreground">{formatIstDate(o.order_date)}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/orders/${o.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {o.distributor_name ?? "(unnamed)"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {o.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatInr(o.total_amount ?? 0)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/orders/${o.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
