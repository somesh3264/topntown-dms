// src/app/(dashboard)/ss/payments/actions.ts
// ---------------------------------------------------------------------------
// Server actions for SS → Payment Tracking.
//
// Payment model: the Super Stockist pays Top N Town up front at order time.
// Each payment row is stored in `ss_payments`:
//
//   id | super_stockist_id | order_id (nullable) | amount | method | status
//   reference_number | paid_at | note | created_at
//
// Outstanding = Σ bill.total_amount (net of distributor payments we routed
// through the SS) − Σ ss_payments.amount (status = 'confirmed').
//
// Actions:
//   - getPaymentOverview() .... totals + outstanding for header card
//   - listPayments(filters) ... paginated payment history
//   - logPaymentAtOrderTime(input)  server action called from "Log payment" form
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSsScope, scopeToDistributors, NotSuperStockistError } from "../_lib/scope";

export type SsPaymentStatus = "pending" | "confirmed" | "failed" | "refunded";
export type SsPaymentMethod = "upi" | "bank_transfer" | "cheque" | "cash" | "other";

export interface SsPaymentRow {
  id: string;
  paidAt: string;
  amount: number;
  method: SsPaymentMethod;
  status: SsPaymentStatus;
  orderId: string | null;
  orderNumber: string | null;
  referenceNumber: string | null;
  note: string | null;
}

export interface PaymentOverview {
  totalOrderedValue: number;
  totalPaid: number;
  totalPending: number;
  outstanding: number;
  lastPaymentAt: string | null;
  paymentsCount: number;
}

export interface OpenOrderOption {
  id: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  distributor: string;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export async function getPaymentOverview(): Promise<{
  overview: PaymentOverview;
  isImpersonating: boolean;
  error?: string;
}> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    const admin = createAdminClient();

    // Sum of orders routed through this SS's network.
    let ordersQ = admin.from("orders").select("total_amount");
    ordersQ = scopeToDistributors(ordersQ, scope, "distributor_id");
    const ordersRes = await ordersQ;

    // Payments history for this SS.
    const paymentsRes = await admin
      .from("ss_payments")
      .select("amount, status, paid_at")
      .eq("super_stockist_id", scope.ssProfile.id)
      .order("paid_at", { ascending: false });

    const totalOrderedValue = (ordersRes.data ?? []).reduce(
      (a, r) => a + num((r as { total_amount?: number | string }).total_amount),
      0,
    );

    let totalPaid = 0;
    let totalPending = 0;
    let lastPaymentAt: string | null = null;
    for (const p of paymentsRes.data ?? []) {
      const row = p as {
        amount: number | string;
        status: SsPaymentStatus;
        paid_at: string | null;
      };
      if (row.status === "confirmed") totalPaid += num(row.amount);
      else if (row.status === "pending") totalPending += num(row.amount);
      if (row.status === "confirmed" && !lastPaymentAt && row.paid_at) {
        lastPaymentAt = row.paid_at;
      }
    }

    return {
      overview: {
        totalOrderedValue,
        totalPaid,
        totalPending,
        outstanding: Math.max(0, totalOrderedValue - totalPaid),
        lastPaymentAt,
        paymentsCount: paymentsRes.data?.length ?? 0,
      },
      isImpersonating: scope.isImpersonating,
    };
  } catch (err) {
    return {
      overview: {
        totalOrderedValue: 0,
        totalPaid: 0,
        totalPending: 0,
        outstanding: 0,
        lastPaymentAt: null,
        paymentsCount: 0,
      },
      isImpersonating: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Payment history ─────────────────────────────────────────────────────────

export interface PaymentFilters {
  dateFrom: string;
  dateTo: string;
  status: SsPaymentStatus | "all";
}

export async function listPayments(
  filters: PaymentFilters,
): Promise<{ rows: SsPaymentRow[]; error?: string }> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    const admin = createAdminClient();

    let q = admin
      .from("ss_payments")
      .select(
        `
          id, amount, method, status, paid_at, reference_number, note, order_id,
          orders:order_id ( order_number )
        `,
      )
      .eq("super_stockist_id", scope.ssProfile.id)
      .gte("paid_at", `${filters.dateFrom}T00:00:00+05:30`)
      .lte("paid_at", `${filters.dateTo}T23:59:59.999+05:30`)
      .order("paid_at", { ascending: false });

    if (filters.status !== "all") q = q.eq("status", filters.status);

    const { data, error } = await q;
    if (error) throw error;

    const rows: SsPaymentRow[] = (data ?? []).map((raw) => {
      const r = raw as {
        id: string;
        amount: number | string;
        method: SsPaymentMethod;
        status: SsPaymentStatus;
        paid_at: string;
        reference_number: string | null;
        note: string | null;
        order_id: string | null;
        orders: { order_number?: string | null } | null;
      };
      return {
        id: r.id,
        paidAt: r.paid_at,
        amount: num(r.amount),
        method: r.method,
        status: r.status,
        orderId: r.order_id,
        orderNumber: r.orders?.order_number ?? null,
        referenceNumber: r.reference_number,
        note: r.note,
      };
    });

    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Open orders awaiting payment ────────────────────────────────────────────

export async function listOpenOrders(): Promise<{
  rows: OpenOrderOption[];
  error?: string;
}> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    const admin = createAdminClient();

    let q = admin
      .from("orders")
      .select(
        `
          id, order_number, order_date, total_amount, distributor_id,
          profiles:distributor_id ( full_name )
        `,
      )
      .in("status", ["pending", "confirmed", "approved", "ready"])
      .order("order_date", { ascending: false })
      .limit(100);
    q = scopeToDistributors(q, scope, "distributor_id");

    const { data, error } = await q;
    if (error) throw error;

    const rows: OpenOrderOption[] = (data ?? []).map((raw) => {
      const r = raw as {
        id: string;
        order_number: string | null;
        order_date: string;
        total_amount: number | string | null;
        distributor_id: string;
        profiles: { full_name?: string | null } | null;
      };
      return {
        id: r.id,
        orderNumber: r.order_number ?? r.id.slice(0, 8),
        orderDate: r.order_date,
        totalAmount: num(r.total_amount),
        distributor: r.profiles?.full_name ?? "(unnamed)",
      };
    });

    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Logging a payment at order time ─────────────────────────────────────────

export interface LogPaymentInput {
  orderId: string | null;
  amount: number;
  method: SsPaymentMethod;
  referenceNumber?: string;
  paidAt: string; // ISO string
  note?: string;
}

export interface LogPaymentResult {
  ok: boolean;
  paymentId?: string;
  error?: string;
}

export async function logPaymentAtOrderTime(
  input: LogPaymentInput,
): Promise<LogPaymentResult> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    if (scope.isImpersonating) {
      throw new Error(
        "Super admins cannot log SS payments on behalf of a stockist. Switch to an SS account.",
      );
    }

    // Basic validation.
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }
    const validMethods: SsPaymentMethod[] = ["upi", "bank_transfer", "cheque", "cash", "other"];
    if (!validMethods.includes(input.method)) {
      throw new Error("Invalid payment method.");
    }
    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime())) {
      throw new Error("Invalid payment date.");
    }
    if (paidAt.getTime() > Date.now() + 60_000) {
      throw new Error("Payment date cannot be in the future.");
    }

    // If an order is specified, ensure it's part of the SS's network.
    const admin = createAdminClient();
    if (input.orderId) {
      const { data: order, error: ordErr } = await admin
        .from("orders")
        .select("id, distributor_id, total_amount")
        .eq("id", input.orderId)
        .single();
      if (ordErr || !order) throw new Error("Order not found.");
      const o = order as { id: string; distributor_id: string; total_amount: number | string };
      if (!scope.distributorIds.includes(o.distributor_id)) {
        throw new Error("Order is not part of your network.");
      }
    }

    const { data, error } = await admin
      .from("ss_payments")
      .insert({
        super_stockist_id: scope.ssProfile.id,
        order_id: input.orderId,
        amount: input.amount,
        method: input.method,
        status: "pending", // finance team confirms later
        reference_number: input.referenceNumber?.trim() || null,
        paid_at: paidAt.toISOString(),
        note: input.note?.trim() || null,
        logged_by: scope.userId,
      })
      .select("id")
      .single();

    if (error) throw error;

    revalidatePath("/ss/payments");
    return { ok: true, paymentId: (data as { id: string }).id };
  } catch (err) {
    if (err instanceof NotSuperStockistError) {
      return { ok: false, error: "Only super stockists can log payments." };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
