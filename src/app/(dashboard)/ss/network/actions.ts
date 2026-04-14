// src/app/(dashboard)/ss/network/actions.ts
// ---------------------------------------------------------------------------
// Server actions powering the Super Stockist "My Network" pages.
//
//   - listNetwork() ............ rows for the network table
//   - getDistributorOverview() . drilldown panel: orders, deliveries, payments
//
// All queries are scoped through resolveSsScope() — the SS only ever sees
// distributors linked to them via ss_networks.
// ---------------------------------------------------------------------------

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSsScope, assertDistributorInNetwork, type SsScope } from "../_lib/scope";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetworkRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  zone: string | null;
  area: string | null;
  status: "active" | "inactive";
}

export interface NetworkPaymentSummary {
  totalBilled: number;
  totalDelivered: number;
  totalPaid: number;
  outstanding: number;
  lastPaymentAt: string | null;
}

export interface NetworkOrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string | null;
  totalAmount: number;
  itemCount: number;
}

export interface NetworkDeliveryRow {
  id: string;
  deliveredAt: string;
  storeName: string | null;
  itemCount: number;
  totalValue: number;
}

export interface DistributorOverview {
  distributor: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    zone: string | null;
    area: string | null;
    status: "active" | "inactive";
  };
  recentOrders: NetworkOrderRow[];
  recentDeliveries: NetworkDeliveryRow[];
  paymentSummary: NetworkPaymentSummary;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function loadNetworkProfiles(scope: SsScope) {
  if (scope.distributorIds.length === 0) return [] as NetworkRow[];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(
      `
        id,
        full_name,
        phone,
        email,
        is_active,
        zones:zone_id ( name ),
        areas:area_id ( name )
      `,
    )
    .in("id", scope.distributorIds)
    .order("full_name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((p) => {
    const r = p as {
      id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      is_active: boolean | null;
      zones: { name?: string | null } | null;
      areas: { name?: string | null } | null;
    };
    return {
      id: r.id,
      name: r.full_name ?? "(unnamed)",
      phone: r.phone,
      email: r.email,
      zone: r.zones?.name ?? null,
      area: r.areas?.name ?? null,
      status: r.is_active === false ? "inactive" : "active",
    } as NetworkRow;
  });
}

// ─── Public actions ──────────────────────────────────────────────────────────

export async function listNetwork(): Promise<{
  rows: NetworkRow[];
  totalCount: number;
  ssName: string | null;
  isImpersonating: boolean;
  error?: string;
}> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    const rows = await loadNetworkProfiles(scope);
    return {
      rows,
      totalCount: rows.length,
      ssName: scope.ssProfile.full_name,
      isImpersonating: scope.isImpersonating,
    };
  } catch (err) {
    return {
      rows: [],
      totalCount: 0,
      ssName: null,
      isImpersonating: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Drilldown for one distributor. Returns 10 most recent orders, 10 most recent
 * deliveries, and a payment summary. Read-only.
 */
export async function getDistributorOverview(
  distributorId: string,
): Promise<{ overview: DistributorOverview | null; error?: string }> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    assertDistributorInNetwork(scope, distributorId);

    const admin = createAdminClient();

    const profileQ = admin
      .from("profiles")
      .select(
        `
          id, full_name, phone, email, is_active,
          zones:zone_id ( name ),
          areas:area_id ( name )
        `,
      )
      .eq("id", distributorId)
      .single();

    const ordersQ = admin
      .from("orders")
      .select(
        `
          id, order_number, order_date, status, total_amount,
          order_items ( id )
        `,
      )
      .eq("distributor_id", distributorId)
      .order("order_date", { ascending: false })
      .limit(10);

    const deliveriesQ = admin
      .from("deliveries")
      .select(
        `
          id, delivered_at, store_id,
          stores:store_id ( name ),
          delivery_items ( quantity, unit_price )
        `,
      )
      .eq("distributor_id", distributorId)
      .order("delivered_at", { ascending: false })
      .limit(10);

    // Payment summary uses bills + deliveries + payments.
    const billsTotalQ = admin
      .from("bills")
      .select("total_amount")
      .eq("distributor_id", distributorId);

    const deliveriesValueQ = admin
      .from("delivery_items")
      .select("quantity, unit_price, deliveries!inner ( distributor_id )")
      .eq("deliveries.distributor_id", distributorId);

    const paymentsQ = admin
      .from("payments")
      .select("amount, paid_at")
      .eq("distributor_id", distributorId)
      .order("paid_at", { ascending: false });

    const [profileRes, ordersRes, deliveriesRes, billsRes, dvalRes, paymentsRes] =
      await Promise.all([profileQ, ordersQ, deliveriesQ, billsTotalQ, deliveriesValueQ, paymentsQ]);

    if (profileRes.error || !profileRes.data) {
      throw profileRes.error ?? new Error("Distributor not found");
    }
    if (ordersRes.error) throw ordersRes.error;
    if (deliveriesRes.error) throw deliveriesRes.error;

    const profile = profileRes.data as {
      id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      is_active: boolean | null;
      zones: { name?: string | null } | null;
      areas: { name?: string | null } | null;
    };

    const recentOrders: NetworkOrderRow[] = (ordersRes.data ?? []).map((o) => {
      const r = o as {
        id: string;
        order_number: string | null;
        order_date: string | null;
        status: string | null;
        total_amount: number | string | null;
        order_items: Array<{ id: string }> | null;
      };
      return {
        id: r.id,
        orderNumber: r.order_number ?? r.id.slice(0, 8),
        orderDate: r.order_date ?? "",
        status: r.status,
        totalAmount: num(r.total_amount),
        itemCount: r.order_items?.length ?? 0,
      };
    });

    const recentDeliveries: NetworkDeliveryRow[] = (deliveriesRes.data ?? []).map((d) => {
      const r = d as {
        id: string;
        delivered_at: string | null;
        store_id: string | null;
        stores: { name?: string | null } | null;
        delivery_items: Array<{ quantity: number | string; unit_price: number | string }> | null;
      };
      const items = r.delivery_items ?? [];
      const totalValue = items.reduce((a, it) => a + num(it.quantity) * num(it.unit_price), 0);
      return {
        id: r.id,
        deliveredAt: r.delivered_at ?? "",
        storeName: r.stores?.name ?? null,
        itemCount: items.length,
        totalValue,
      };
    });

    // Payment summary:
    //   billed     = sum of bills.total_amount
    //   delivered  = sum of delivery_items.quantity * unit_price
    //   paid       = sum of payments.amount
    //   outstanding = max(billed, delivered) - paid
    const totalBilled = (billsRes.data ?? []).reduce(
      (a, b) => a + num((b as { total_amount?: number | string }).total_amount),
      0,
    );
    const totalDelivered = (dvalRes.data ?? []).reduce(
      (a, r) =>
        a +
        num((r as { quantity?: number | string }).quantity) *
          num((r as { unit_price?: number | string }).unit_price),
      0,
    );
    const totalPaid = (paymentsRes.data ?? []).reduce(
      (a, p) => a + num((p as { amount?: number | string }).amount),
      0,
    );
    const lastPaymentAt =
      (paymentsRes.data ?? [])[0] != null
        ? (paymentsRes.data?.[0] as { paid_at?: string }).paid_at ?? null
        : null;

    return {
      overview: {
        distributor: {
          id: profile.id,
          name: profile.full_name ?? "(unnamed)",
          phone: profile.phone,
          email: profile.email,
          zone: profile.zones?.name ?? null,
          area: profile.areas?.name ?? null,
          status: profile.is_active === false ? "inactive" : "active",
        },
        recentOrders,
        recentDeliveries,
        paymentSummary: {
          totalBilled,
          totalDelivered,
          totalPaid,
          outstanding: Math.max(0, Math.max(totalBilled, totalDelivered) - totalPaid),
          lastPaymentAt,
        },
      },
    };
  } catch (err) {
    return { overview: null, error: err instanceof Error ? err.message : String(err) };
  }
}
