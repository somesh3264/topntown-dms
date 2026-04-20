// src/app/(dashboard)/dashboard/orders/new/page.tsx
// ---------------------------------------------------------------------------
// Dashboard "New Order" page.
//
// Server component: gates access to super_admin / sales_person, pre-loads the
// distributor + product lookups via getOrderFormContext(), and renders the
// client-side NewOrderClient form.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getOrderFormContext } from "../../../orders/actions";
import NewOrderClient from "./_components/NewOrderClient";

export const metadata: Metadata = { title: "New Order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) redirect("/login");

  // Server-side role gate. The context loader does its own role check too,
  // but 404ing up-front is better UX for anyone who clicks a stale link.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (role !== "super_admin" && role !== "sales_person") {
    notFound();
  }

  const { distributors, products, callerRole, error } = await getOrderFormContext();

  return (
    <div className="p-6">
      <Link
        href="/dashboard/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">New Order</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Place an order on behalf of a distributor.
          {callerRole === "super_admin" && (
            <>
              {" "}
              <span className="italic">
                Super Admin: cutoff + one-per-day guards are bypassed.
              </span>
            </>
          )}
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      ) : (
        <NewOrderClient
          distributors={distributors}
          products={products}
          callerRole={(callerRole as "super_admin" | "sales_person") ?? "sales_person"}
        />
      )}
    </div>
  );
}
