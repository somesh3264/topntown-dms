// src/lib/billing.ts
// ---------------------------------------------------------------------------
// Bill number generation and core bill-creation logic for Top N Town DMS.
//
// Bill number format:
//   TNT-YYYYMMDD-[INITIALS]-[SEQ]
//
//   • YYYYMMDD  — bill date (IST)
//   • INITIALS  — up to 3 uppercase letters derived from the distributor's
//                 full_name (first letter of each word, max 3 words)
//   • SEQ       — zero-padded 3-digit sequence, incremented per distributor
//                 per day (001, 002, …)
//
// Example:  TNT-20260406-RAM-001
//
// Core bill generation logic (generateBillForOrder) is shared between:
//   • the nightly cron  (src/app/api/cron/generate-bills/route.ts)
//   • the manual trigger (src/app/(dashboard)/orders/actions.ts)
// ---------------------------------------------------------------------------

import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateBillResult {
  success: boolean;
  billId?: string;
  billNumber?: string;
  error?: string;
}

// ─── IST helper ───────────────────────────────────────────────────────────────

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Returns today's date in IST as "YYYYMMDD" for bill_number generation.
 */
export function todayIST(): string {
  const istNow = new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000);
  const y = istNow.getUTCFullYear();
  const m = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(istNow.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Returns today's date in IST as "YYYY-MM-DD" (for SQL date comparisons).
 */
export function todayISODate(): string {
  const istNow = new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000);
  const y = istNow.getUTCFullYear();
  const m = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(istNow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Initials helper ──────────────────────────────────────────────────────────

/**
 * Derives up to 3 uppercase initials from a distributor's full_name.
 * e.g. "Ramesh Kumar Sharma" → "RKS", "Ali" → "ALI", null → "DST"
 */
function deriveInitials(fullName: string | null): string {
  if (!fullName?.trim()) return "DST";
  const words = fullName.trim().toUpperCase().split(/\s+/);
  if (words.length === 1) {
    // Single word: use up to first 3 letters
    return words[0].replace(/[^A-Z]/g, "").slice(0, 3) || "DST";
  }
  return words
    .slice(0, 3)
    .map((w) => w.replace(/[^A-Z]/g, "")[0] ?? "")
    .join("")
    .slice(0, 3) || "DST";
}

// ─── Bill number generation ───────────────────────────────────────────────────

/**
 * generateBillNumber(supabase, distributorId, distributorName, date)
 *
 * Queries the bills table to find how many bills already exist for this
 * distributor on the given date, then returns the next sequential number.
 *
 * @param supabase       — service-role client (bypasses RLS)
 * @param distributorId  — UUID of the distributor
 * @param distributorName — full_name for initials
 * @param dateStr        — "YYYYMMDD" format (defaults to today IST)
 */
export async function generateBillNumber(
  supabase: SupabaseClient<Database>,
  distributorId: string,
  distributorName: string | null,
  dateStr?: string
): Promise<string> {
  const date = dateStr ?? todayIST();
  const initials = deriveInitials(distributorName);
  const prefix = `TNT-${date}-${initials}-`;

  // Count existing bills with this prefix for this distributor today
  const { count, error } = await supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .eq("distributor_id", distributorId)
    .like("bill_number", `${prefix}%`);

  if (error) {
    console.error("[generateBillNumber] Count query failed:", error.message);
    // Fall back to a timestamp-based sequence to avoid collisions
    const fallbackSeq = String(Date.now()).slice(-4);
    return `${prefix}${fallbackSeq}`;
  }

  const nextSeq = String((count ?? 0) + 1).padStart(3, "0");
  return `${prefix}${nextSeq}`;
}

// ─── Core bill generation ─────────────────────────────────────────────────────

/**
 * generateBillForOrder(supabase, orderId)
 *
 * The shared, atomic bill-generation routine.  Called by both:
 *   • the nightly cron (bulk, loops over all confirmed orders)
 *   • the Super Admin manual trigger (single order)
 *
 * Steps performed inside a single logical transaction:
 *   1. Fetch the order + distributor profile + order_items + products
 *   2. Generate a unique bill_number
 *   3. Insert bill row (status = generated)
 *   4. Insert bill_items (unit_price from order_items, tax from products)
 *   5. Insert stock_allocations (allocated_qty = ordered qty, delivered_qty = 0)
 *   6. Update order.status = billed
 *
 * Returns { success, billId, billNumber } on success or { success: false, error }.
 *
 * NOTE: Supabase JS does not yet expose true server-side transactions.
 * We use sequential inserts; failures mid-way are logged and re-thrown
 * so the caller can decide on retry strategy.
 */
export async function generateBillForOrder(
  supabase: SupabaseClient<Database>,
  orderId: string
): Promise<GenerateBillResult> {
  // ── 1. Fetch order ─────────────────────────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, distributor_id, order_date, status, total_amount")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    return { success: false, error: `Order not found: ${orderErr?.message ?? "unknown"}` };
  }

  if (order.status === "billed") {
    return { success: false, error: `Order ${orderId} is already billed.` };
  }

  if (order.status !== "confirmed") {
    return {
      success: false,
      error: `Order ${orderId} has status "${order.status}". Only confirmed orders can be billed.`,
    };
  }

  // ── 2. Fetch distributor profile ──────────────────────────────────────────
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", order.distributor_id)
    .single();

  if (profileErr || !profile) {
    return { success: false, error: `Distributor profile not found: ${profileErr?.message ?? "unknown"}` };
  }

  // ── 3. Fetch order items + product tax rates ───────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from("order_items")
    .select("id, product_id, quantity, unit_price, products(tax_rate)")
    .eq("order_id", orderId);

  if (itemsErr || !items || items.length === 0) {
    return { success: false, error: `No order items found: ${itemsErr?.message ?? "empty order"}` };
  }

  // ── 4. Generate bill number ────────────────────────────────────────────────
  // Use order_date's YYYYMMDD so bills always match their order day,
  // even if the cron runs slightly after midnight.
  const orderDateStr = (order.order_date as string).replace(/-/g, ""); // "YYYY-MM-DD" → "YYYYMMDD"
  const billNumber = await generateBillNumber(
    supabase,
    order.distributor_id,
    profile.full_name,
    orderDateStr
  );

  // ── 5. Insert bill ─────────────────────────────────────────────────────────
  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .insert({
      order_id: orderId,
      distributor_id: order.distributor_id,
      bill_number: billNumber,
      bill_date: order.order_date as string,
      total_amount: order.total_amount as number,
      status: "generated",
    })
    .select("id")
    .single();

  if (billErr || !bill) {
    return { success: false, error: `Failed to insert bill: ${billErr?.message ?? "unknown"}` };
  }

  const billId = (bill as { id: string }).id;

  // ── 6. Insert bill_items ───────────────────────────────────────────────────
  const billItemsPayload = items.map((item) => {
    const taxRate = (item as any).products?.tax_rate ?? 0;
    const lineTotal = (item.quantity as number) * (item.unit_price as number);
    const taxAmount = parseFloat(
      ((lineTotal * (taxRate as number)) / 100).toFixed(2)
    );

    return {
      bill_id: billId,
      product_id: item.product_id as string,
      allocated_qty: item.quantity as number,
      unit_price: item.unit_price as number,
      tax_amount: taxAmount,
    };
  });

  const { error: billItemsErr } = await supabase
    .from("bill_items")
    .insert(billItemsPayload);

  if (billItemsErr) {
    console.error(`[generateBillForOrder] bill_items insert failed for bill ${billId}:`, billItemsErr.message);
    return { success: false, error: `Failed to insert bill_items: ${billItemsErr.message}` };
  }

  // ── 7. Insert stock_allocations ────────────────────────────────────────────
  const allocationsPayload = items.map((item) => ({
    bill_id: billId,
    distributor_id: order.distributor_id,
    product_id: item.product_id as string,
    allocated_qty: item.quantity as number,
    delivered_qty: 0,
  }));

  const { error: allocErr } = await supabase
    .from("stock_allocations")
    .insert(allocationsPayload);

  if (allocErr) {
    console.error(`[generateBillForOrder] stock_allocations insert failed for bill ${billId}:`, allocErr.message);
    return { success: false, error: `Failed to insert stock_allocations: ${allocErr.message}` };
  }

  // ── 8. Update order status to billed ──────────────────────────────────────
  const { error: updateErr } = await supabase
    .from("orders")
    .update({ status: "billed" })
    .eq("id", orderId);

  if (updateErr) {
    console.error(`[generateBillForOrder] order status update failed for ${orderId}:`, updateErr.message);
    return { success: false, error: `Failed to update order status: ${updateErr.message}` };
  }

  return { success: true, billId, billNumber };
}
