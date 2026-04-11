// src/app/api/orders/submit/route.ts
// ---------------------------------------------------------------------------
// POST /api/orders/submit
//
// Validates and submits an order for any order-placing party
// (distributor, super_stockist, or retailer).
//
// Request body (JSON):
//   {
//     items: Array<{ productId: string; quantity: number }>
//   }
//
// Steps:
//   1. Authenticate caller — must have an active session.
//   2. Verify caller role is order-placing (distributor / super_stockist / retailer).
//   3. Check isCutoffPassed() server-side — reject immediately if past cut-off.
//   4. Validate order items (non-empty, positive quantities, active products exist).
//   5. Resolve unit prices — 3-step hierarchy per item:
//        a. Party-specific price override (price_overrides for caller's tier)
//        b. Product's computed tier price (distributor_price / ss_price / retailer_price)
//        c. MRP as final fallback
//   6. Check for a duplicate confirmed/draft order today (idempotency guard).
//   7. Insert order + order_items, set status = confirmed.
//   8. Return created order ID and bill-pending status.
//
// Error codes returned in JSON body:
//   CUTOFF_PASSED  — order window is closed for today
//   UNAUTHORIZED   — missing or invalid session
//   FORBIDDEN      — caller role cannot place orders
//   DUPLICATE      — already submitted an order today
//   VALIDATION     — bad request body
//   SERVER_ERROR   — unexpected DB failure
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
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

/** Roles that are allowed to place orders */
const ORDER_PLACING_ROLES = ["distributor", "super_stockist", "retailer"] as const;
type OrderPlacingRole = (typeof ORDER_PLACING_ROLES)[number];

/**
 * Maps a user role to:
 *   - priceTierColumn : the computed price column on products to use as tier price
 *   - overrideTier    : the value to match in price_overrides.tier
 */
const ROLE_PRICING_MAP: Record<
  OrderPlacingRole,
  { priceTierColumn: string; overrideTier: string }
> = {
  super_stockist: { priceTierColumn: "ss_price",          overrideTier: "super_stockist" },
  distributor:    { priceTierColumn: "distributor_price",  overrideTier: "distributor"    },
  retailer:       { priceTierColumn: "retailer_price",     overrideTier: "retailer"       },
};

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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

  // ── Resolve caller role ────────────────────────────────────────────────────
  // Check cookie as a fast-path, then confirm from DB to prevent spoofing.
  const roleCookie = cookieStore.get("user_role")?.value as string | undefined;

  let callerRole: string | null = null;

  if (roleCookie && ORDER_PLACING_ROLES.includes(roleCookie as OrderPlacingRole)) {
    // Cookie looks valid; still verify from DB for security
    callerRole = roleCookie;
  }

  // Always verify from DB — cookie is just a hint, not trusted for access control
  const adminForRole = createAdminClient();
  const { data: profileRow } = await adminForRole
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const dbRole = (profileRow as any)?.role as string | null;

  if (!dbRole || !ORDER_PLACING_ROLES.includes(dbRole as OrderPlacingRole)) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "Your account role is not permitted to place orders.",
      },
      { status: 403 }
    );
  }

  // Use the authoritative DB role from here on
  callerRole = dbRole;
  const pricingConfig = ROLE_PRICING_MAP[callerRole as OrderPlacingRole];

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
  //
  // 3-step price resolution per item:
  //   Step A — Party-specific override: price_overrides WHERE user_id = caller AND tier = caller's tier
  //   Step B — Product tier price: products.distributor_price / ss_price / retailer_price
  //   Step C — MRP fallback: products.mrp (always available)
  //
  const admin = createAdminClient();
  const productIds = body.items.map((i) => i.productId);
  const today = new Date().toISOString().slice(0, 10);

  // Fetch all pricing columns + active flag in one query
  const { data: products, error: productsErr } = await (admin as any)
    .from("products")
    .select(`id, name, is_active, mrp, distributor_price, ss_price, retailer_price`)
    .in("id", productIds);

  if (productsErr || !products) {
    console.error("[orders/submit] products fetch failed:", productsErr?.message);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }

  // Validate all requested products are active
  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));
  for (const item of body.items) {
    const product = productMap.get(item.productId);
    if (!product) {
      return NextResponse.json(
        { error: "VALIDATION", message: `Product ${item.productId} not found.` },
        { status: 400 }
      );
    }
    if (!product.is_active) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: `Product "${product.name}" is currently inactive and cannot be ordered.`,
        },
        { status: 400 }
      );
    }
  }

  // ── Step A: Fetch caller's party-specific price overrides ─────────────────
  // Only picks up overrides that have come into effect on or before today.
  // Multiple overrides per product are ordered newest-first; we take the first.
  const { data: overrides } = await admin
    .from("price_overrides")
    .select("product_id, price")
    .eq("user_id", user.id)
    .eq("tier", pricingConfig.overrideTier as any)
    .in("product_id", productIds as any)
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });

  // Keep only the most-recent (already ordered desc) override per product
  const overrideMap = new Map<string, number>();
  for (const o of (overrides ?? []) as any[]) {
    if (!overrideMap.has(o.product_id)) {
      overrideMap.set(o.product_id, o.price);
    }
  }

  // ── Steps B + C: Build resolved price per item ────────────────────────────
  const resolvedItems = body.items.map((item) => {
    const product = productMap.get(item.productId)!;

    // Step A — party override
    const overridePrice = overrideMap.get(item.productId);
    // Step B — tier column (e.g. distributor_price)
    const tierPrice: number | null = product[pricingConfig.priceTierColumn] ?? null;
    // Step C — MRP fallback
    const mrpPrice: number = product.mrp;

    const unitPrice = overridePrice ?? tierPrice ?? mrpPrice;

    return {
      product_id:  item.productId,
      quantity:    item.quantity,
      unit_price:  unitPrice,
      price_source: overridePrice != null ? "override"
                  : tierPrice    != null ? "tier_price"
                  :                        "mrp_fallback",
    };
  });

  // Log price sources for auditability (visible in server logs / Supabase logs)
  console.info(
    "[orders/submit] price resolution summary:",
    resolvedItems.map((i) => `${i.product_id}=${i.price_source}@${i.unit_price}`)
  );

  // ── 5. Idempotency guard — no duplicate confirmed/draft order today ─────────
  // UTC date — acceptable for same-IST-day idempotency window
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
  // Strip price_source (internal audit field) before inserting
  const { error: itemsErr } = await admin
    .from("order_items")
    .insert(
      resolvedItems.map(({ product_id, quantity, unit_price }) => ({
        order_id: orderId,
        product_id,
        quantity,
        unit_price,
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
      priceTier: callerRole,
      message: "Order confirmed. Bill will be generated tonight.",
    },
    { status: 201 }
  );
}
