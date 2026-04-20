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
import { isCutoffPassed } from "@/lib/cutoff";
import {
  resolveOrderPrices,
  validateRequestedItems,
  type RequestedOrderItem,
} from "@/lib/orders";
import { isOrderEditableByAdmin } from "./status";

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
): Promise<ActionResult<{ billId: string; billNumber: string; pdfWarning?: string }>> {
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

  // ── Kick off PDF generation directly ──────────────────────────────────────
  //
  // The nightly cron relies on a Postgres AFTER-INSERT trigger (see
  // 20260415_bill_pdf_cron_hook.sql) that calls the Edge Function via
  // pg_net. That chain depends on several things being in place:
  //   • the trigger migration applied
  //   • pg_net extension enabled
  //   • app.supabase_url + app.service_role_key GUCs configured
  //   • the Edge Function deployed
  //
  // For the manual (super_admin-initiated) path we fire the Edge Function
  // ourselves via a server-side fetch. This means a correctly-deployed
  // Edge Function is the *only* requirement for the manual path — the
  // pg_net / GUC / trigger plumbing is not touched.
  //
  // We await the call (up to ~15s) so that by the time the UI re-renders,
  // bills.pdf_url is likely already populated. If the Edge Function fails
  // or times out, we DON'T fail the parent action — the bill is already
  // created and the UI can offer a retry. We pass the warning back so the
  // admin sees the concrete reason instead of an indefinite "still rendering"
  // spinner.
  const pdfResult = await triggerBillPdfGeneration(result.billId!);
  const pdfWarning = pdfResult.ok ? undefined : pdfResult.message;

  // ── Revalidate dashboard order pages ──────────────────────────────────────
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);

  return {
    success: true,
    data: {
      billId: result.billId!,
      billNumber: result.billNumber!,
      pdfWarning,
    },
  };
}

/**
 * POST to the generate-bill-pdf Edge Function.
 *
 * Previously this was "fire-and-forget" — any failure was logged server-side
 * but the UI had no idea the PDF render had broken, which is what caused the
 * "PDF is still rendering — refresh in a moment" message to sit there forever
 * when the Edge Function wasn't deployed, misconfigured, or crashing.
 *
 * Now we return a structured result so the caller can decide whether to
 * surface the error to the UI or retry. The function still never throws —
 * callers that prefer the old "best effort" semantics can simply ignore the
 * return value.
 *
 * Classification:
 *   • ok: true               → Edge Function accepted the job (pdf_url may or
 *                              may not be written yet; the caller should poll
 *                              bills.pdf_url to know for sure).
 *   • ok: false, reason:...  → something went wrong; `message` is safe to
 *                              show to an admin user as a diagnostic.
 */
async function triggerBillPdfGeneration(
  billId: string,
): Promise<{
  ok: boolean;
  reason?:
    | "not_configured"
    | "timeout"
    | "network_error"
    | "edge_function_error";
  status?: number;
  message?: string;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "[triggerBillPdfGeneration] Missing SUPABASE_URL or SERVICE_ROLE_KEY — skipping PDF trigger.",
    );
    return {
      ok: false,
      reason: "not_configured",
      message:
        "PDF service is not configured on the server (missing SUPABASE_URL / SERVICE_ROLE_KEY).",
    };
  }

  // Abort after 15s so a hung Edge Function doesn't block the server action.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${url}/functions/v1/generate-bill-pdf`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ billId }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error(
        `[triggerBillPdfGeneration] Edge Function responded ${response.status} for bill ${billId}:`,
        bodyText.slice(0, 500),
      );
      // Extract a human-readable message from the JSON body when possible.
      let message = bodyText.slice(0, 300);
      try {
        const asJson = JSON.parse(bodyText);
        if (asJson?.error) message = String(asJson.error);
      } catch {
        /* not JSON — keep raw text */
      }
      // Common deployment-time symptom: a 404 means the Edge Function isn't
      // deployed (or the project URL is wrong). Make that actionable.
      if (response.status === 404) {
        message =
          "The generate-bill-pdf Edge Function isn't deployed. Run `supabase functions deploy generate-bill-pdf --no-verify-jwt` and try again.";
      }
      return {
        ok: false,
        reason: "edge_function_error",
        status: response.status,
        message,
      };
    }
    await response.json().catch(() => undefined);
    return { ok: true };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(
        `[triggerBillPdfGeneration] Edge Function call timed out for bill ${billId} (15s).`,
      );
      return {
        ok: false,
        reason: "timeout",
        message:
          "PDF generation did not respond within 15s. The render may still be in flight — try again in a moment.",
      };
    }
    console.error(
      `[triggerBillPdfGeneration] Edge Function call failed for bill ${billId}:`,
      err?.message ?? err,
    );
    return {
      ok: false,
      reason: "network_error",
      message: err?.message ?? "Unknown network error calling the PDF service.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── getBillPdfUrl ────────────────────────────────────────────────────────────

/**
 * Lightweight polling endpoint: returns the current pdf_url for a given bill,
 * plus the bill row's status. Used by the order-detail BillCard to discover
 * when the Edge Function has finished rendering without requiring the user to
 * hit refresh.
 *
 * Auth: piggybacks on the authenticated order-detail page. We verify the user
 * can see the parent order via RLS, then read bills.pdf_url via the admin
 * client (bills RLS may not allow distributor reads, and even super-admin can
 * race with the page load).
 */
export async function getBillPdfUrl(
  billId: string,
): Promise<{ pdfUrl: string | null; status: string | null }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { pdfUrl: null, status: null };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bills")
    .select("pdf_url, status")
    .eq("id", billId)
    .maybeSingle();
  if (error || !data) {
    return { pdfUrl: null, status: null };
  }
  return {
    pdfUrl: (data as any).pdf_url ?? null,
    status: (data as any).status ?? null,
  };
}

// ─── retryBillPdfGeneration ───────────────────────────────────────────────────

/**
 * Re-invoke the generate-bill-pdf Edge Function for a bill whose pdf_url is
 * still null (or whose PDF the admin wants regenerated). Returns the structured
 * result from the Edge Function trigger so the UI can show the real error.
 *
 * Only super_admin may call this — same guard as triggerBillGeneration.
 */
export async function retryBillPdfGeneration(
  billId: string,
): Promise<ActionResult<{ pdfUrl: string | null }>> {
  // Auth guard — super_admin only.
  const supabaseAuth = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();
  if (!user || authError) {
    return { success: false, error: "Unauthorized: No active session." };
  }
  const { data: profile } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if ((profile as any)?.role !== "super_admin") {
    return { success: false, error: "Forbidden: Super Admin access required." };
  }
  if (!billId) return { success: false, error: "Invalid billId." };

  const result = await triggerBillPdfGeneration(billId);
  if (!result.ok) {
    return {
      success: false,
      error: result.message ?? "PDF generation failed.",
    };
  }

  // The Edge Function writes pdf_url before returning ok=true, so we can
  // return the freshly-populated value (or null if another worker got it).
  const admin = createAdminClient();
  const { data: updated } = await admin
    .from("bills")
    .select("pdf_url, order_id")
    .eq("id", billId)
    .maybeSingle();

  const pdfUrl = (updated as any)?.pdf_url ?? null;
  const orderId = (updated as any)?.order_id;
  if (orderId) {
    revalidatePath(`/dashboard/orders/${orderId}`);
  }
  return { success: true, data: { pdfUrl } };
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

type OrderStatus = "draft" | "confirmed" | "dispatched" | "delivered" | "cancelled" | "billed";

export async function getOrders(filters?: {
  status?: OrderStatus;
  date?: string;
}): Promise<OrderRow[]> {
  const supabase = createClient();

  // NOTE: we no longer embed `profiles(full_name)` here. Once `orders` got a
  // second FK to profiles (picked_up_by_user_id), pgrst's auto-resolution
  // becomes ambiguous and breaks this read. We batch-resolve names below.
  let query = supabase
    .from("orders")
    .select("id, distributor_id, order_date, status, total_amount, created_at")
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

  const rows = (data ?? []) as any[];
  const distributorIds = Array.from(
    new Set(rows.map((r) => r.distributor_id).filter(Boolean)),
  ) as string[];

  const nameMap = new Map<string, string | null>();
  if (distributorIds.length > 0) {
    const admin = createAdminClient();
    const { data: profRows } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", distributorIds);
    for (const p of (profRows ?? []) as any[]) {
      nameMap.set(p.id, p.full_name ?? null);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    distributor_id: row.distributor_id,
    distributor_name: nameMap.get(row.distributor_id) ?? null,
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

export interface OrderBillSummary {
  id: string;
  bill_number: string | null;
  bill_date: string;
  total_amount: number;
  status: string;
  pdf_url: string | null;
}

export interface OrderDetail {
  id: string;
  distributor_id: string;
  distributor_name: string | null;
  order_date: string;
  status: string;
  total_amount: number;
  created_at: string;
  /** ISO timestamp; present once status advanced to 'dispatched'. */
  picked_up_at: string | null;
  /** Full name of the user (admin / SP) who marked pickup, if known. */
  picked_up_by_name: string | null;
  items: OrderItemRow[];
  /**
   * The bill linked to this order, if one has been generated.
   * Populated via a service-role read so the UI can surface it even
   * when bills RLS has not been configured for the caller's role.
   */
  bill: OrderBillSummary | null;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = createClient();

  // ── Orders & items go through the authenticated client so existing RLS
  //    scoping (super_admin/SS/sales_person/distributor) is respected.
  // We pull pickup columns here, but resolve BOTH the distributor name
  // and the picked_up_by name via separate lookups below. pgrst's
  // auto-resolution of `profiles(full_name)` becomes ambiguous once the
  // orders table has more than one FK to profiles (we just added one for
  // picked_up_by_user_id), so we sidestep it entirely with explicit reads.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, distributor_id, order_date, status, total_amount, created_at, picked_up_at, picked_up_by_user_id",
    )
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

  // ── Bill lookup. Uses the admin client intentionally: if bills has RLS
  //    enabled without SELECT policies for the caller's role the billed
  //    order's invoice would be invisible. Since the order itself has
  //    already passed the authenticated visibility check above, surfacing
  //    its bill here is safe. Bill may not exist — not an error.
  const admin = createAdminClient();
  const { data: billRow, error: billErr } = await admin
    .from("bills")
    .select("id, bill_number, bill_date, total_amount, status, pdf_url")
    .eq("order_id", orderId)
    .maybeSingle();

  if (billErr) {
    console.error("[getOrderDetail] bill:", billErr.message);
    // Non-fatal — continue with bill = null so the rest of the page still renders.
  }

  const bill: OrderBillSummary | null = billRow
    ? {
        id: (billRow as any).id,
        bill_number: (billRow as any).bill_number ?? null,
        bill_date: (billRow as any).bill_date,
        total_amount: Number((billRow as any).total_amount ?? 0),
        status: (billRow as any).status,
        pdf_url: (billRow as any).pdf_url ?? null,
      }
    : null;

  // Resolve the two profile names we care about in one round-trip via `in()`.
  // Harmless to include both IDs even when one is the same or null — we just
  // map the result back by id.
  const nameIds = [
    (order as any).distributor_id,
    (order as any).picked_up_by_user_id,
  ].filter(Boolean) as string[];
  const nameMap = new Map<string, string | null>();
  if (nameIds.length > 0) {
    const { data: nameRows } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", nameIds);
    for (const r of (nameRows ?? []) as any[]) {
      nameMap.set(r.id, r.full_name ?? null);
    }
  }

  return {
    id: (order as any).id,
    distributor_id: (order as any).distributor_id,
    distributor_name: nameMap.get((order as any).distributor_id) ?? null,
    order_date: (order as any).order_date,
    status: (order as any).status,
    total_amount: (order as any).total_amount,
    created_at: (order as any).created_at,
    picked_up_at: (order as any).picked_up_at ?? null,
    picked_up_by_name: (order as any).picked_up_by_user_id
      ? (nameMap.get((order as any).picked_up_by_user_id) ?? null)
      : null,
    items: (items ?? []).map((item: any) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.products?.name ?? null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: parseFloat((item.quantity * item.unit_price).toFixed(2)),
    })),
    bill,
  };
}

// ─── Dashboard order placement / editing ─────────────────────────────────────
//
// These actions back the Super Admin / Sales Person flow where an order is
// either placed *for* a distributor or modified after it was placed by the
// distributor's app. They share pricing logic with /api/orders/submit (via
// src/lib/orders.ts) so a dashboard-placed order is priced identically to
// the same order placed from the app.
//
// Role policy
//   • super_admin  — full access; can place/edit any order, bypasses the
//                    daily cutoff and the one-confirmed-order-per-day guard.
//   • sales_person — can place/edit orders for any distributor, but still
//                    respects cutoff + duplicate guards (it's the same
//                    operational reality as a distributor calling them up).
//   • Anyone else  — blocked.
//
// Editing a `billed` order
//   We delete the existing bill row (cascading bill_items + stock_allocations)
//   and the matching PDF in storage, then re-run generateBillForOrder so the
//   new bill reflects the edited line items. The PDF is re-rendered by the
//   Edge Function via the same trigger path as the original.
// -----------------------------------------------------------------------------

export interface DashboardOrderRole {
  callerId: string;
  callerRole: "super_admin" | "sales_person";
}

/**
 * Verify the caller may place / edit orders from the dashboard. Returns the
 * caller's role on success, or a structured error.
 */
async function requireOrderManager(): Promise<
  { ok: true; ctx: DashboardOrderRole } | { ok: false; error: string }
> {
  const supabaseAuth = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();
  if (!user || authError) {
    return { ok: false, error: "Unauthorized: No active session." };
  }
  const { data: profile, error: profErr } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profErr || !profile) {
    return { ok: false, error: "Could not verify user role." };
  }
  const role = (profile as any).role as string;
  if (role !== "super_admin" && role !== "sales_person") {
    return {
      ok: false,
      error: "Only Super Admin or Sales Person can place/edit orders here.",
    };
  }
  return { ok: true, ctx: { callerId: user.id, callerRole: role as any } };
}

// ── requirePickupManager ─────────────────────────────────────────────────────
//
// Narrower guard for the factory-gate pickup action. Only super_admin and
// dispatch_manager can mark an order picked up. Sales Person is deliberately
// excluded — pickup is a factory-floor operation, not a field one.
//
// Kept as a separate helper (rather than widening requireOrderManager) so
// the order placement/editing surface remains locked to super_admin +
// sales_person. Drift between the two is intentional.
// -----------------------------------------------------------------------------

interface PickupManagerCtx {
  callerId: string;
  callerRole: "super_admin" | "dispatch_manager";
}

async function requirePickupManager(): Promise<
  { ok: true; ctx: PickupManagerCtx } | { ok: false; error: string }
> {
  const supabaseAuth = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();
  if (!user || authError) {
    return { ok: false, error: "Unauthorized: No active session." };
  }
  const { data: profile, error: profErr } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profErr || !profile) {
    return { ok: false, error: "Could not verify user role." };
  }
  const role = (profile as any).role as string;
  if (role !== "super_admin" && role !== "dispatch_manager") {
    return {
      ok: false,
      error: "Only Super Admin or Dispatch Manager can mark orders picked up.",
    };
  }
  return {
    ok: true,
    ctx: { callerId: user.id, callerRole: role as any },
  };
}

// ── Lookup helpers (UI form context) ─────────────────────────────────────────

export interface DistributorOption {
  id: string;
  full_name: string | null;
  phone: string | null;
  zone_name: string | null;
  area_name: string | null;
}

export interface ProductOption {
  id: string;
  name: string;
  category: string | null;
  mrp: number;
  distributor_price: number | null;
  is_active: boolean;
}

/**
 * Loads the data the New / Edit Order form needs in a single round-trip:
 *   • All active distributors (id, name, phone, primary zone/area for context).
 *   • All active products with their list-price columns so the client can
 *     render a live unit-price preview before submission. The server still
 *     re-resolves prices on submit (overrides may apply), so the preview is
 *     informational only.
 */
export async function getOrderFormContext(): Promise<{
  distributors: DistributorOption[];
  products: ProductOption[];
  callerRole: "super_admin" | "sales_person" | null;
  error?: string;
}> {
  const guard = await requireOrderManager();
  if (!guard.ok) {
    return { distributors: [], products: [], callerRole: null, error: guard.error };
  }
  const admin = createAdminClient();

  const [distRes, prodRes] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, full_name, phone, zones:zone_id ( name ), areas:area_id ( name )",
      )
      .eq("role", "distributor")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    admin
      .from("products")
      .select("id, name, category, mrp, distributor_price, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const distributors: DistributorOption[] = ((distRes.data ?? []) as any[]).map(
    (r) => ({
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      zone_name: r.zones?.name ?? null,
      area_name: r.areas?.name ?? null,
    }),
  );

  const products: ProductOption[] = ((prodRes.data ?? []) as any[]).map(
    (p) => ({
      id: p.id,
      name: p.name,
      category: p.category ?? null,
      mrp: Number(p.mrp ?? 0),
      distributor_price:
        p.distributor_price != null ? Number(p.distributor_price) : null,
      is_active: Boolean(p.is_active),
    }),
  );

  return { distributors, products, callerRole: guard.ctx.callerRole };
}

// ── createOrderForDistributor ─────────────────────────────────────────────────

export interface CreateOrderInput {
  distributorId: string;
  /** YYYY-MM-DD; defaults to today (IST). Editable for super_admin only. */
  orderDate?: string;
  items: RequestedOrderItem[];
}

export async function createOrderForDistributor(
  input: CreateOrderInput,
): Promise<
  ActionResult<{
    orderId: string;
    totalAmount: number;
    /** Did we auto-generate the bill right after insert? */
    billed: boolean;
    /** If auto-bill attempted but failed, the reason — the order itself
     *  still succeeded, so we return success=true and surface a warning. */
    billWarning?: string;
  }>
> {
  const guard = await requireOrderManager();
  if (!guard.ok) return { success: false, error: guard.error };
  const { callerRole } = guard.ctx;

  // ── Validate input shape ────────────────────────────────────────────────
  if (!input?.distributorId) {
    return { success: false, error: "Pick a distributor before submitting." };
  }
  const itemsErr = validateRequestedItems(input.items);
  if (itemsErr) return { success: false, error: itemsErr };

  const admin = createAdminClient();

  // ── Distributor must exist, be active, and actually be a distributor ────
  const { data: distributor, error: distErr } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", input.distributorId)
    .single();
  if (distErr || !distributor) {
    return { success: false, error: "Distributor not found." };
  }
  if ((distributor as any).role !== "distributor") {
    return {
      success: false,
      error: "Selected user is not a distributor.",
    };
  }
  if (!(distributor as any).is_active) {
    return {
      success: false,
      error: "Selected distributor is inactive. Reactivate them first.",
    };
  }

  // ── Cutoff + duplicate guards (sales_person only; super_admin bypasses) ─
  const orderDate = input.orderDate ?? new Date().toISOString().slice(0, 10);

  if (callerRole === "sales_person") {
    const cutoff = await isCutoffPassed();
    if (cutoff.passed) {
      return {
        success: false,
        error: `Cut-off was at ${cutoff.cutoffTime} IST. Ask a Super Admin to place this order, or place it tomorrow.`,
      };
    }
    // One-confirmed-order-per-distributor-per-day. Same window the app uses.
    const { data: existing } = await admin
      .from("orders")
      .select("id, status")
      .eq("distributor_id", input.distributorId)
      .eq("order_date", orderDate)
      .in("status", ["draft", "confirmed", "billed"])
      .maybeSingle();
    if (existing) {
      return {
        success: false,
        error: `An order for this distributor already exists for ${orderDate} (status: ${(existing as any).status}). Edit that order instead.`,
      };
    }
  }

  // ── Resolve prices via the shared helper (same logic as the app route) ──
  const priced = await resolveOrderPrices(
    admin,
    input.distributorId,
    "distributor",
    input.items,
  );
  if (!priced.ok) {
    const e = priced.error;
    if (e.code === "PRODUCT_INACTIVE") {
      return {
        success: false,
        error: `"${e.productName}" is inactive and can't be ordered.`,
      };
    }
    if (e.code === "PRODUCT_NOT_FOUND") {
      return { success: false, error: `Product ${e.productId} no longer exists.` };
    }
    return { success: false, error: e.message };
  }

  // ── Insert order + items ────────────────────────────────────────────────
  const { data: newOrder, error: orderErr } = await admin
    .from("orders")
    .insert({
      distributor_id: input.distributorId,
      order_date: orderDate,
      status: "confirmed",
      total_amount: priced.totalAmount,
    })
    .select("id")
    .single();
  if (orderErr || !newOrder) {
    console.error("[createOrderForDistributor] insert order:", orderErr?.message);
    return { success: false, error: orderErr?.message ?? "Could not create order." };
  }
  const orderId = (newOrder as any).id as string;

  const { error: itemsInsertErr } = await admin
    .from("order_items")
    .insert(
      priced.items.map(({ product_id, quantity, unit_price }) => ({
        order_id: orderId,
        product_id,
        quantity,
        unit_price,
      })),
    );
  if (itemsInsertErr) {
    // Roll back the order so we don't leave an orphan with no items.
    await admin.from("orders").delete().eq("id", orderId);
    console.error("[createOrderForDistributor] insert items:", itemsInsertErr.message);
    return { success: false, error: itemsInsertErr.message };
  }

  // ── Auto-bill: admin-placed orders skip the nightly cron buffer ─────────
  //
  // An admin placing an order is, by definition, doing so after the normal
  // flow (distributor self-service pre-cutoff) would have billed it. Running
  // generateBillForOrder inline here means stock_allocations is populated
  // immediately, so Stock Balance on the Android app reflects the new order
  // within a second instead of tomorrow morning.
  //
  // We don't fail the action if billing fails — the order itself is valid
  // and the nightly cron (or a manual Generate Bill click) will pick it up
  // as a safety net. The warning message is surfaced to the UI.
  const billResult = await generateBillForOrder(admin, orderId);
  let billed = false;
  let billWarning: string | undefined;
  if (billResult.success && billResult.billId) {
    billed = true;
    // Kick the PDF Edge Function so the invoice is ready when the
    // distributor arrives for pickup. Its failure mode is isolated (won't
    // affect the bill row) and the BillCard has its own retry.
    await triggerBillPdfGeneration(billResult.billId);
  } else {
    billWarning =
      billResult.error ??
      "Bill could not be generated automatically. The nightly cron will retry.";
    console.error(
      `[createOrderForDistributor] auto-bill failed for ${orderId}:`,
      billWarning,
    );
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
  return {
    success: true,
    data: {
      orderId,
      totalAmount: priced.totalAmount,
      billed,
      billWarning,
    },
  };
}

// ── updateOrderItems ─────────────────────────────────────────────────────────

/**
 * Order statuses where a dashboard user (super_admin / sales_person) is still
 * allowed to add or change line items. Anything beyond this set is treated as
 * "physically picked up" — once the stock has been dispatched, the truck has
 * left, and editing the bill on the back-end would no longer match what the
 * distributor actually has.
 *
 *   draft     → not yet confirmed
 *   confirmed → confirmed but not yet billed (typically same day, pre-cron)
 *   billed    → bill generated overnight; stock is *allocated* but the
 *               distributor hasn't physically picked it up yet. Editing in
 *               this window triggers a bill regen (handled below).
 *
 * Anything else (dispatched, delivered, cancelled) is locked.
 *
 * Exported so the UI can hide the Edit button using the same source of truth.
 */
// ADMIN_EDITABLE_ORDER_STATUSES, AdminEditableStatus, and isOrderEditableByAdmin
// now live in ./status so this "use server" file only exports async functions
// (a Next.js constraint). Consumers that need the sync helper or the constant
// should import from "../orders/status" directly.

export interface UpdateOrderInput {
  orderId: string;
  items: RequestedOrderItem[];
  /** Only super_admin may change the order date. Ignored for sales_person. */
  orderDate?: string;
}

export async function updateOrderItems(
  input: UpdateOrderInput,
): Promise<
  ActionResult<{
    totalAmount: number;
    /** True if an existing bill was re-issued (status was 'billed' on entry). */
    billRegenerated: boolean;
    /** True if a bill was generated for the first time (status was 'confirmed'
     *  on entry, auto-billed after the edit). */
    billGenerated: boolean;
    /** If auto-bill/regen failed, a human-readable reason. The items save
     *  itself still succeeded — this is a warning, not an error. */
    billWarning?: string;
  }>
> {
  const guard = await requireOrderManager();
  if (!guard.ok) return { success: false, error: guard.error };
  const { callerRole } = guard.ctx;

  if (!input?.orderId) return { success: false, error: "orderId is required." };
  const itemsErr = validateRequestedItems(input.items);
  if (itemsErr) return { success: false, error: itemsErr };

  const admin = createAdminClient();

  // Load the order to know its distributor + status (for billed regeneration).
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, distributor_id, order_date, status")
    .eq("id", input.orderId)
    .single();
  if (orderErr || !order) return { success: false, error: "Order not found." };

  const currentStatus = (order as any).status as string;
  if (!isOrderEditableByAdmin(currentStatus)) {
    // Surface the concrete reason so the admin knows why — "locked" on its
    // own would leave them guessing whether it's a permissions problem or
    // a state problem.
    const reason =
      currentStatus === "dispatched"
        ? "stock has already been dispatched from the factory"
        : currentStatus === "delivered"
          ? "the order has already been delivered"
          : currentStatus === "cancelled"
            ? "the order was cancelled"
            : `the order is in status "${currentStatus}"`;
    return {
      success: false,
      error: `This order can no longer be edited — ${reason}. Additions are only allowed before pickup from the factory.`,
    };
  }

  // Sales_person edits respect the cutoff for the order's date so they
  // can't push amendments after the day's window has closed.
  if (callerRole === "sales_person") {
    const cutoff = await isCutoffPassed();
    if (cutoff.passed) {
      return {
        success: false,
        error: `Cut-off was at ${cutoff.cutoffTime} IST. Editing this order is locked until tomorrow's window opens.`,
      };
    }
  }

  // Re-price using the shared helper so price resolution stays identical
  // to the app and to the create flow.
  const priced = await resolveOrderPrices(
    admin,
    (order as any).distributor_id,
    "distributor",
    input.items,
  );
  if (!priced.ok) {
    const e = priced.error;
    if (e.code === "PRODUCT_INACTIVE") {
      return {
        success: false,
        error: `"${e.productName}" is inactive and can't be ordered.`,
      };
    }
    if (e.code === "PRODUCT_NOT_FOUND") {
      return { success: false, error: `Product ${e.productId} no longer exists.` };
    }
    return { success: false, error: e.message };
  }

  // Replace order_items atomically (delete + insert; smaller blast radius
  // than per-row diffing for what is typically <50 line items).
  const { error: delErr } = await admin
    .from("order_items")
    .delete()
    .eq("order_id", input.orderId);
  if (delErr) {
    console.error("[updateOrderItems] delete items:", delErr.message);
    return { success: false, error: delErr.message };
  }

  const { error: insertErr } = await admin.from("order_items").insert(
    priced.items.map(({ product_id, quantity, unit_price }) => ({
      order_id: input.orderId,
      product_id,
      quantity,
      unit_price,
    })),
  );
  if (insertErr) {
    console.error("[updateOrderItems] insert items:", insertErr.message);
    return { success: false, error: insertErr.message };
  }

  // Bring the parent order in sync. Super_admin may also rewrite order_date.
  const orderUpdate: Record<string, any> = {
    total_amount: priced.totalAmount,
  };
  if (callerRole === "super_admin" && input.orderDate) {
    orderUpdate.order_date = input.orderDate;
  }
  const { error: updErr } = await admin
    .from("orders")
    .update(orderUpdate)
    .eq("id", input.orderId);
  if (updErr) {
    console.error("[updateOrderItems] update order:", updErr.message);
    return { success: false, error: updErr.message };
  }

  // ── Bill state sync ─────────────────────────────────────────────────────
  //
  // Two cases worth handling:
  //
  //   already billed → tear down the old bill and re-issue it with the new
  //                    quantities (regenerateBillFor handles bill_items,
  //                    stock_allocations, the storage PDF, and re-run).
  //
  //   confirmed      → no bill exists yet. Generate one now so Stock Balance
  //                    reflects the order immediately. This is the
  //                    "auto-bill on admin edit" behaviour — admin orders
  //                    don't need to wait for the nightly cron because they
  //                    are by definition post-cutoff and final.
  //
  // Both cases are best-effort: the items save itself already succeeded, so
  // a billing failure becomes a warning rather than rolling back the user's
  // intent. The nightly cron + manual "Retry PDF" backstop catches misses.
  let billRegenerated = false;
  let billGenerated = false;
  let billWarning: string | undefined;
  const startStatus = (order as any).status as string;

  if (startStatus === "billed") {
    const regen = await regenerateBillFor(admin, input.orderId);
    if (regen.ok) {
      billRegenerated = true;
    } else {
      billWarning = `Bill regeneration failed: ${regen.error}. Use "Retry PDF generation" on the bill card.`;
      console.error("[updateOrderItems] regen:", regen.error);
    }
  } else if (startStatus === "confirmed") {
    const billResult = await generateBillForOrder(admin, input.orderId);
    if (billResult.success && billResult.billId) {
      billGenerated = true;
      await triggerBillPdfGeneration(billResult.billId);
    } else {
      billWarning =
        billResult.error ??
        "Bill could not be generated automatically. The nightly cron will retry.";
      console.error("[updateOrderItems] auto-bill:", billWarning);
    }
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${input.orderId}`);
  return {
    success: true,
    data: {
      totalAmount: priced.totalAmount,
      billRegenerated,
      billGenerated,
      billWarning,
    },
  };
}

/**
 * Tear down the existing bill (bill_items + stock_allocations cascade off
 * the bill row's FKs) and rerun generateBillForOrder. Also deletes the old
 * PDF object from storage so it can't be downloaded post-edit.
 *
 * This intentionally lives next to updateOrderItems rather than in
 * src/lib/billing.ts because the cleanup steps are dashboard-flow-specific
 * (the cron path never deletes prior bills).
 */
async function regenerateBillFor(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<{ ok: true; billNumber: string } | { ok: false; error: string }> {
  // Find the existing bill row to capture its storage path before delete.
  const { data: oldBill, error: oldErr } = await admin
    .from("bills")
    .select("id, bill_number, bill_date, pdf_url")
    .eq("order_id", orderId)
    .maybeSingle();
  if (oldErr) {
    return { ok: false, error: oldErr.message };
  }

  if (oldBill) {
    const oldBillId = (oldBill as any).id as string;

    // Cascade-delete dependents. We do these in dependency order rather than
    // relying on FK ON DELETE because the original schema may not have
    // cascade configured.
    await admin.from("stock_allocations").delete().eq("bill_id", oldBillId);
    await admin.from("bill_items").delete().eq("bill_id", oldBillId);
    const { error: delBillErr } = await admin
      .from("bills")
      .delete()
      .eq("id", oldBillId);
    if (delBillErr) {
      return { ok: false, error: `Could not delete old bill: ${delBillErr.message}` };
    }

    // Best-effort: remove the old PDF blob so /storage/v1/object/... 404s
    // for any cached link that escapes. Storage 404s here are not fatal.
    const oldNumber: string | null = (oldBill as any).bill_number ?? null;
    const oldDate: string | null = (oldBill as any).bill_date ?? null;
    if (oldNumber && oldDate) {
      const d = new Date(oldDate);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const safeNumber = oldNumber.replace(/[^A-Za-z0-9_\-]/g, "_");
      await admin.storage
        .from("bills")
        .remove([`${y}/${m}/${safeNumber}.pdf`])
        .catch(() => undefined);
    }
  }

  // generateBillForOrder requires status === "confirmed"; flip the order
  // back from "billed" so it can run.
  const { error: revertErr } = await admin
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", orderId);
  if (revertErr) {
    return { ok: false, error: revertErr.message };
  }

  const result = await generateBillForOrder(admin, orderId);
  if (!result.success) {
    return { ok: false, error: result.error ?? "Bill regeneration failed." };
  }

  // The AFTER INSERT trigger on bills will fire the PDF Edge Function via
  // pg_net. As a belt-and-braces measure (and in case the trigger isn't
  // installed in this environment), kick the Edge Function manually too.
  await triggerBillPdfGeneration(result.billId!);

  return { ok: true, billNumber: result.billNumber! };
}

// ── markOrderPickedUp ────────────────────────────────────────────────────────
//
// "Pickup" means the distributor has physically collected the stock from
// the factory. Once flipped, the edit window closes (see
// ADMIN_EDITABLE_ORDER_STATUSES) and the distributor's Android app can
// surface the pickup timestamp on the order card.
//
// Transition model
//   confirmed → dispatched   (ok; bill doesn't exist yet but the admin
//                             explicitly decided to release the stock)
//   billed    → dispatched   (normal happy path — bill generated overnight,
//                             distributor arrives and picks up in the AM)
//   anything else → rejected
//
// Guards
//   • Caller must be super_admin or sales_person.
//   • Order must be in an editable state at call time (we re-check server
//     side, not just trust the UI).
//   • If caller is a sales person, they should be physically at the factory;
//     we don't enforce geofencing here because that's a client-side concern.
// -----------------------------------------------------------------------------

export async function markOrderPickedUp(
  orderId: string,
): Promise<ActionResult<{ pickedUpAt: string }>> {
  // Pickup uses its own guard (super_admin + dispatch_manager) rather than
  // requireOrderManager (super_admin + sales_person). See the requirePickupManager
  // comment for why these two ACLs are intentionally distinct.
  const guard = await requirePickupManager();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!orderId) return { success: false, error: "orderId is required." };

  const admin = createAdminClient();
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) return { success: false, error: "Order not found." };

  const status = (order as any).status as string;
  if (!isOrderEditableByAdmin(status)) {
    // Covers dispatched (already picked), delivered, cancelled, and any
    // exotic status. A pickup can only happen once; double-firing should
    // be a no-op to the user, so we return a soft message rather than an
    // error log.
    if (status === "dispatched") {
      return {
        success: false,
        error: "This order has already been marked as picked up.",
      };
    }
    return {
      success: false,
      error: `Cannot mark pickup — order is in status "${status}".`,
    };
  }

  const pickedUpAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from("orders")
    .update({
      status: "dispatched",
      picked_up_at: pickedUpAt,
      picked_up_by_user_id: guard.ctx.callerId,
    })
    .eq("id", orderId);
  if (updErr) {
    console.error("[markOrderPickedUp] update:", updErr.message);
    return { success: false, error: updErr.message };
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
  return { success: true, data: { pickedUpAt } };
}
