// src/app/(dashboard)/ss/network/page.tsx
// ---------------------------------------------------------------------------
// Super Stockist → My Network
//
// Lists the distributors linked to this SS via ss_networks. Each row links
// to /ss/network/[distributorId] for a read-only drilldown. The SS does NOT
// have add/remove controls — network changes go through admin (the empty
// state explains how to request).
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Phone, Mail, MapPin, Users } from "lucide-react";
import { listNetwork } from "./actions";
import { NotSuperStockistError } from "../_lib/scope";

export const metadata: Metadata = { title: "My Network" };
export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  let result;
  try {
    result = await listNetwork();
  } catch (err) {
    if (err instanceof NotSuperStockistError) redirect("/dashboard");
    throw err;
  }

  const { rows, totalCount, ssName, isImpersonating, error } = result;
  const activeCount = rows.filter((r) => r.status === "active").length;

  return (
    <div className="p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My Network</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ssName ? `Distributors linked to ${ssName}.` : "Distributors in your network."}
            {" "}
            Read-only — to add or remove a distributor, contact your administrator.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SummaryPill icon={<Users className="h-4 w-4" />} label="Total" value={totalCount} />
          <SummaryPill label="Active" value={activeCount} tone="success" />
          <SummaryPill label="Inactive" value={totalCount - activeCount} tone="muted" />
        </div>
      </header>

      {isImpersonating && (
        <Banner tone="info">
          You&rsquo;re viewing this page as a super admin. Network rows are populated only for
          actual super stockist accounts.
        </Banner>
      )}

      {error && <Banner tone="error">Could not load network: {error}</Banner>}

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Distributor</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Zone</th>
                <th className="px-4 py-3 text-left font-medium">Area</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/ss/network/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.email && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {r.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {r.phone}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.zone ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.area ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {r.area}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/ss/network/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View
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

// ─── Internal components ──────────────────────────────────────────────────────

function SummaryPill({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone?: "default" | "success" | "muted";
}) {
  const tones: Record<string, string> = {
    default: "bg-muted text-foreground",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    muted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {icon}
      {label}: <span className="font-semibold">{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "inactive" }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Inactive
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-12 text-center">
      <Users className="mx-auto h-10 w-10 text-muted-foreground" />
      <h2 className="mt-3 text-base font-medium">No distributors in your network yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Network changes are managed by Top N Town admin. Submit a request to your administrator
        to add a distributor.
      </p>
    </div>
  );
}

function Banner({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const classes =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
      : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300";
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${classes}`}>{children}</div>
  );
}
