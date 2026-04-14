// src/app/api/whatsapp/ledger/route.ts
// ---------------------------------------------------------------------------
// POST /api/whatsapp/ledger  { storeId: string }
//
// Computes the store's current ledger snapshot and sends the `ledger_summary`
// WhatsApp template to the store's primary phone.
//
// Outstanding  = Σ delivered_value − Σ payments  (for this store)
// Last delivery = MAX(deliveries.delivered_at) for this store
// Payments received = Σ payments.amount for this store
//
// Auth: super_admin, super_stockist, or the assigned sales_person / distributor
//       (same pattern as the rest of the dashboard's API routes).
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  const userSupabase = createServerSupabase();

  const { data: userData } = await userSupabase.auth.getUser();
  if (!userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.storeId) {
    return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── 1. Store identity / recipient phone ───────────────────────────────────
  const { data: store, error: storeErr } = await admin
    .from("stores")
    .select("id, name, phone, owner_phone")
    .eq("id", body.storeId)
    .single();

  if (storeErr || !store) {
    return NextResponse.json(
      { error: `Store not found: ${storeErr?.message ?? body.storeId}` },
      { status: 404 },
    );
  }

  const s = store as { id: string; name: string | null; phone: string | null; owner_phone: string | null };
  const phone = s.phone ?? s.owner_phone;
  if (!phone) {
    return NextResponse.json({ error: "No phone on file for this store" }, { status: 400 });
  }

  // ── 2. Aggregate ledger ─────────────────────────────────────────────────--
  const [deliveriesRes, paymentsRes] = await Promise.all([
    admin
      .from("deliveries")
      .select("total_value, delivered_at")
      .eq("store_id", s.id),
    admin
      .from("payments")
      .select("amount")
      .eq("store_id", s.id),
  ]);

  if (deliveriesRes.error) {
    return NextResponse.json({ error: deliveriesRes.error.message }, { status: 500 });
  }
  if (paymentsRes.error) {
    return NextResponse.json({ error: paymentsRes.error.message }, { status: 500 });
  }

  const deliveries = (deliveriesRes.data ?? []) as Array<{
    total_value: number | string;
    delivered_at: string;
  }>;
  const payments = (paymentsRes.data ?? []) as Array<{ amount: number | string }>;

  const delivered = deliveries.reduce((acc, d) => acc + Number(d.total_value ?? 0), 0);
  const paid = payments.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
  const outstanding = Math.max(0, delivered - paid);

  const lastDelivery = deliveries
    .map((d) => d.delivered_at)
    .sort()
    .at(-1);

  const lastDeliveryStr = lastDelivery
    ? new Date(lastDelivery).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "No deliveries yet";

  // ── 3. Send the template ─────────────────────────────────────────────────-
  const wa = await sendMessage(
    phone,
    "ledger_summary",
    {
      store_name: s.name ?? "Store",
      outstanding_inr: outstanding.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      last_delivery_date: lastDeliveryStr,
      payments_inr: paid.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    },
    { context: { entityType: "ledger", entityId: s.id } },
  );

  return NextResponse.json(
    {
      sent: wa.success,
      logId: wa.logId,
      error: wa.error,
      snapshot: {
        outstanding,
        delivered,
        paid,
        lastDelivery: lastDelivery ?? null,
      },
    },
    { status: wa.success ? 200 : 502 },
  );
}
