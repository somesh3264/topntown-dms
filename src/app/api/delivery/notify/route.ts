// src/app/api/delivery/notify/route.ts
// ---------------------------------------------------------------------------
// POST /api/delivery/notify  { deliveryId, paymentAmount? }
//
// Post-hoc delivery notification endpoint — for callers (Android app, bulk
// importers) that already invoked the `submit_delivery` RPC directly and now
// just need to fire the `delivery_receipt` WhatsApp.
//
// Auth: CRON_SECRET bearer (server-to-server) OR a valid user session.
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  // Accept either a server-side bearer (cron / worker) or a real user session.
  const authHeader = request.headers.get("Authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  let authorized = cronSecret.length > 0 && authHeader === `Bearer ${cronSecret}`;

  if (!authorized) {
    const sb = createServerSupabase();
    const { data } = await sb.auth.getUser();
    authorized = !!data?.user;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { deliveryId?: string; paymentAmount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.deliveryId) {
    return NextResponse.json({ error: "deliveryId is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: delivery, error: dErr } = await admin
    .from("deliveries")
    .select("id, store_id, total_value, item_count, delivered_at")
    .eq("id", body.deliveryId)
    .single();

  if (dErr || !delivery) {
    return NextResponse.json(
      { error: `Delivery not found: ${dErr?.message ?? body.deliveryId}` },
      { status: 404 },
    );
  }

  const d = delivery as {
    id: string;
    store_id: string;
    total_value: number | string;
    item_count: number;
    delivered_at: string;
  };

  const { data: store } = await admin
    .from("stores")
    .select("name, phone, owner_phone")
    .eq("id", d.store_id)
    .single();

  const storeRow = store as
    | { name?: string | null; phone?: string | null; owner_phone?: string | null }
    | null;

  const phone = storeRow?.phone ?? storeRow?.owner_phone ?? null;
  if (!phone) {
    return NextResponse.json({ error: "No phone on file for this store" }, { status: 400 });
  }

  const deliveredOn = new Date(d.delivered_at).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const wa = await sendMessage(
    phone,
    "delivery_receipt",
    {
      store_name: storeRow?.name ?? "Store",
      item_count: d.item_count,
      total_inr: Number(d.total_value).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      delivered_on: deliveredOn,
      payment_inr: Number(body.paymentAmount ?? 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    },
    { context: { entityType: "delivery", entityId: d.id } },
  );

  return NextResponse.json(
    { sent: wa.success, logId: wa.logId, error: wa.error },
    { status: wa.success ? 200 : 502 },
  );
}
