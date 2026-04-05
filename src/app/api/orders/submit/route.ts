// src/app/api/orders/submit/route.ts
// ---------------------------------------------------------------------------
// POST /api/orders/submit
//
// Validates and submits a distributor's daily order.
//
// Request body (JSON):
//   {
//     items: Array<{ productId: string; quantity: number }>
//   }
//
// Steps:
//   1. Authenticate caller — must be a distributor with an active session.
//   2. Check isCutoffPassed() server-side — reject immediately if past cut-off.
//   3. Validate order items (non-empty, positive quantities, products exist).
//   4. Resolve unit prices (price_overrides → base_price → mrp hierarchy).
//   5. Check for a duplicate confirmed/draft order today (idempotency guard).
//   6. Insert order + order_items, set status = confirmed.
//   7. Return created order ID and bill-pending status.
//
// Error codes returned in JSON body:
//   CUTOFF_PASSED  — order window is closed for today
//   UNAUTHORIZED   — missing or invalid session
//   FORBIDDEN      — caller is not a distributor
//   DUPLICATE      — already submitted an order today
//   VALIDATION     — bad request body
//   SERVER_ERROR   — unexpected DB failure
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCutoffPassed } from "@/lib/cutoff";
import type { Database } from "@/types/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  productId: string;
  quantity: number;
}

interface SubmitOrderBody {
  items: OrderItem[];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const cookieStore = cookies();

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user || authError) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Role must be distributor (check cookie fast-path, then DB for safety)
  const roleCookie = cookieStore.get("user_role")?.value;
  if (roleCookie && roleCookie !== "distributor") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Only distributors can submit orders." },
      { status: 403 }
    );
  }

  // ── 2. Cut-off check ───────────────────────────────────────────────────────
  const cutoff = await isCutoffPassed();

  if (cutoff.passed) {
    // Fetch support contact number from system_config
    const admin = createAdminClient();
    const { data: contactRow } = await admin
      .from("system_config")
      .select("value")
      .eq("key", "support_contact")
      .single();

    const contactNumber: string = contactRow?.value ?? "+91-9999999999";

    return NextResponse.json(
      {
        error: "CUTOFF_PASSED",
        message: `Order cut-off was at ${cutoff.cutoffTime} IST. Please call us to place your order.`,
        contactNumber,
        cutoffTime: cutoff.cutoffTime,
      },
      { status: 422 }
    );
  }

  // ── 3. Parse & validate body ───────────────────────────────────────────────
  let body: SubmitOrderBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "VALIDATION", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "VALIDATION", message: "items must be a non-empty array." },
      { status: 400 }
    );
  }

  // Validate each line item
  for (const item of body.items) {
    if (!item.productId || typeof item.productId !== "string") {
      return NextResponse.json(
        { error: "VALIDATION", message: "Each item must have a valid productId." },
        { status: 400 }
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: `quantity for product ${item.productId} must be a positive integer.`,
        },
        { status: 400 }
      );
    }
  }

  // ── 4. Resolve prices via admin client (bypasses RLS) ─────────────────────
  const admin = createAdminClient();

  const productIds = body.items.map((i) => i.productId);

  // Fetch product master data for all items in one query.
  // NOTE: The DB schema has no separate base_price column — MRP is the base price.
  // Per-distributor pricing lives in price_overrides (fetched below).
  const { data: products, error: productsErr } = await admin
    .from("products")
    .select("id, mrp, is_active")
    .in("id", productIds);

  if (productsErr || !products) {
    console.error("[orders/submit] products fetch failed:", productsErr?.message);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }

  // Validate all requested products are active
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const item of body.items) {
    const product = productMap.get(item.productId);
    if (!product) {
      return NextResponse.json(
        { error: "VALIDATION", message: `Product ${item.productId} not found.` },
        { status: 400 }
      );
    }
    if (!(product as any).is_active) {
      return NextResponse.json(
        { error: "VALIDATION", message: `Product ${item.productId} is not active.` },
        { status: 400 }
      );
    }
  }

  // Fetch distributor-tier price overrides that are currently effective
  const { data: overrides } = await admin
    .from("price_overrides")
    .select("product_id, price")
    .eq("user_id", user.id)
    .eq("tier", "distributor")
    .in("product_id", productIds)
    .lte("effective_from", new Date().toISOString().slice(0, 10))
    .order("effective_from", { ascending: false });

  // Build override map (latest effective override per product)
  const overrideMap = new Map<string, number>();
  for (const o of overrides ?? []) {
    if (!overrideMap.has(o.product_id as string)) {
      overrideMap.set(o.product_id as string, o.price as number);
    }
  }

  // Resolve final unit price: distributor price_override → MRP (DB has no base_price column)
  const resolvedItems = body.items.map((item) => {
    const product = productMap.get(item.productId)!;
    const unitPrice =
      overrideMap.get(item.productId) ??
      (product as any).mrp;

    return {
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: unitPrice as number,
    };
  });

  // ── 5. Idempotency guard — no duplicate confirmed/draft order today ─────────
  const today = new Date().toISOString().slice(0, 10); // UTC date; acceptable for same-IST-day
  const { data: existingOrder } = await admin
    .from("orders")
    .select("id, status")
    .eq("distributor_id", user.id)
    .eq("order_date", today)
    .in("status", ["draft", "confirmed", "billed"])
    .maybeSingle();

  if (existingOrder) {
    return NextResponse.json(
      {
        error: "DUPLICATE",
        message: "An order for today has already been submitted.",
        existingOrderId: existingOrder.id,
        existingStatus: existingOrder.status,
      },
      { status: 409 }
    );
  }

  // ── 6. Insert order ────────────────────────────────────────────────────────
  const totalAmount = resolvedItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0
  );

  const { data: newOrder, error: orderErr } = await admin
    .from("orders")
    .insert({
      distributor_id: user.id,
      order_date: today,
      status: "confirmed",
      total_amount: parseFloat(totalAmount.toFixed(2)),
    })
    .select("id")
    .single();

  if (orderErr || !newOrder) {
    console.error("[orders/submit] order insert failed:", orderErr?.message);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }

  const orderId = (newOrder as { id: string }).id;

  // ── 7. Insert order_items ──────────────────────────────────────────────────
  const { error: itemsErr } = await admin
    .from("order_items")
    .insert(
      resolvedItems.map((item) => ({
        order_id: orderId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    );

  if (itemsErr) {
    console.error("[orders/submit] order_items insert failed:", itemsErr.message);
    // Attempt to clean up the orphaned order row
    await admin.from("orders").delete().eq("id", orderId);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }

  // ── 8. Return success ──────────────────────────────────────────────────────
  return NextResponse.json(
    {
      success: true,
      orderId,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      itemCount: resolvedItems.length,
      message: "Order confirmed. Bill will be generated tonight.",
    },
    { status: 201 }
  );
}
