// src/app/(dashboard)/orders/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the Orders section of the Dashboard.
//
// triggerBillGeneration(orderId):
//   Super Admin–only manual trigger to generate a bill for a specific order.
//   Calls the shared generateBillForOrder() routine (same logic as the cron)
//   rather than hitting the cron endpoint directly, so there's no HTTP
//   round-trip and no need for CRON_SECRET on the client.
//
// Business rules enforced:
//   • Only super_admin may call triggerBillGeneration.
//   • The order must be in 'confirmed' status (not already billed).
//   • The session is verified server-side via Supabase auth.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBillForOrder } from "@/lib/billing";

// ─── Action result helper ─────────────────────────────────────────────────────

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── triggerBillGeneration ────────────────────────────────────────────────────

/**
 * triggerBillGeneration(orderId)
 *
 * Manually generates a bill for a single confirmed order.
 * Intended for use from the Super Admin orders dashboard (e.g. a "Generate Bill"
 * button on the order detail page) when the nightly cron was missed or an
 * order needs to be billed outside the normal window.
 *
 * @param orderId — UUID of the order to bill
 */
export async function triggerBillGeneration(
  orderId: string
): Promise<ActionResult<{ billId: string; billNumber: string }>> {
  // ── Auth guard — super_admin only ─────────────────────────────────────────
  const cookieStore = cookies();
  const roleCookie = cookieStore.get("user_role")?.value;

  // Fast-path cookie check
  if (roleCookie && roleCookie !== "super_admin") {
    return { success: false, error: "Forbidden: Super Admin access required." };
  }

  // Verify session with Supabase (authoritative)
  const supabaseAuth = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (!user || authError) {
    return { success: false, error: "Unauthorized: No active session." };
  }

  // Double-check role from DB
  const { data: profile, error: profileErr } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    return { success: false, error: "Could not verify user role." };
  }

  if ((profile as any).role !== "super_admin") {
    return { success: false, error: "Forbidden: Super Admin access required." };
  }

  // ── Validate orderId ───────────────────────────────────────────────────────
  if (!orderId || typeof orderId !== "string") {
    return { success: false, error: "Invalid orderId." };
  }

  // ── Run bill generation via admin client ───────────────────────────────────
  const admin = createAdminClient();
  const result = await generateBillForOrder(admin, orderId);

  if (!result.success) {
    console.error(`[triggerBillGeneration] Failed for order ${orderId}:`, result.error);
    return { success: false, error: result.error };
  }

  // ── Revalidate dashboard order pages ──────────────────────────────────────
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);

  return {
    success: true,
    data: {
      billId: result.billId!,
      billNumber: result.billNumber!,
    },
  };
}

// ─── getOrders ────────────────────────────────────────────────────────────────

/**
 * getOrders(filters?)
 *
 * Fetches orders for the dashboard orders list.
 * Super Admin sees all orders; other roles are scoped by RLS.
 *
 * @param filters.status  — filter by order status
 * @param filters.date    — filter by order_date (ISO "YYYY-MM-DD")
 */
export interface OrderRow {
  id: string;
  distributor_id: string;
  distributor_name: string | null;
  order_date: string;
  status: string;
  total_amount: number;
  created_at: string;
}

export async function getOrders(filters?: {
  status?: string;
  date?: string;
}): Promise<OrderRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("orders")
    .select("id, distributor_id, order_date, status, total_amount, created_at, profiles(full_name)")
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.date) {
    query = query.eq("order_date", filters.date);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getOrders]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    distributor_id: row.distributor_id,
    distributor_name: row.profiles?.full_name ?? null,
    order_date: row.order_date,
    status: row.status,
    total_amount: row.total_amount,
    created_at: row.created_at,
  }));
}

// ─── getOrderDetail ───────────────────────────────────────────────────────────

export interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface OrderDetail {
  id: string;
  distributor_id: string;
  distributor_name: string | null;
  order_date: string;
  status: string;
  total_amount: number;
  created_at: string;
  items: OrderItemRow[];
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = createClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, distributor_id, order_date, status, total_amount, created_at, profiles(full_name)")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    console.error("[getOrderDetail]", orderErr?.message);
    return null;
  }

  const { data: items, error: itemsErr } = await supabase
    .from("order_items")
    .select("id, product_id, quantity, unit_price, products(name)")
    .eq("order_id", orderId);

  if (itemsErr) {
    console.error("[getOrderDetail] items:", itemsErr.message);
    return null;
  }

  return {
    id: (order as any).id,
    distributor_id: (order as any).distributor_id,
    distributor_name: (order as any).profiles?.full_name ?? null,
    order_date: (order as any).order_date,
    status: (order as any).status,
    total_amount: (order as any).total_amount,
    created_at: (order as any).created_at,
    items: (items ?? []).map((item: any) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.products?.name ?? null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: parseFloat((item.quantity * item.unit_price).toFixed(2)),
    })),
  };
}
