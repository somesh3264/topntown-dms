// src/app/(dashboard)/dashboard/dispatch/page.tsx
// ---------------------------------------------------------------------------
// Dispatch Manager home screen — the factory-gate queue of today's orders
// waiting to be handed over to the distributor.
//
// Visible to: dispatch_manager (landing page), super_admin (fallback).
// One row per pending order; one action per row: "Mark picked up".
//
// Design principles
//   • Single list view — no tabs, no filters, no date picker. Today only.
//   • Large tap targets — the operator is usually on a factory desktop but
//     may be on a tablet.
//   • Row removes itself via router.refresh() after the action returns,
//     so the queue is always up-to-date without page reloads.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatInr, formatIstDate, formatIstDateTime } from "../../ss/_lib/format";
import { getPendingPickups } from "./actions";
import DispatchRow from "./_components/DispatchRow";

export const metadata: Metadata = { title: "Dispatch — Pickups" };
export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  // ── Auth + role guard ──────────────────────────────────────────────────────
  // Middleware already blocks other roles from this route, but we re-check
  // server-side in case of stale cookies / impersonation edge cases.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (role !== "super_admin" && role !== "dispatch_manager") {
    redirect("/dashboard");
  }

  // ── Fetch today's pending pickups ──────────────────────────────────────────
  const { pickups, error } = await getPendingPickups();

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dispatch</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Orders awaiting factory pickup · {formatIstDate(new Date().toISOString())}
          </p>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          Pending{" "}
          <span className="ml-1 text-base font-semibold tabular-nums text-foreground">
            {pickups.length}
          </span>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          Could not load the pickup queue: {error}
        </div>
      )}

      {pickups.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed bg-card p-12 text-center">
          <PackageCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <h2 className="mt-3 text-base font-medium">No pickups pending</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order for today has either been picked up or hasn't been billed
            yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Distributor</th>
                <th className="px-4 py-3 text-left font-medium">Order ID</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Placed</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {pickups.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    {p.distributor_name ?? "(unnamed distributor)"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {p.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatIstDateTime(p.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatInr(p.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DispatchRow orderId={p.id} />
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

function StatusBadge({ status }: { status: "confirmed" | "billed" }) {
  const cls =
    status === "billed"
      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
      : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}
