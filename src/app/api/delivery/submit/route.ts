// src/app/api/delivery/submit/route.ts
// ---------------------------------------------------------------------------
// POST /api/delivery/submit
//
// Thin wrapper around the `submit_delivery()` Postgres RPC that ALSO fires
// the `delivery_receipt` WhatsApp template to the store once the delivery is
// committed.
//
// Two integration shapes are supported:
//
//   (a) The distributor Android app can call this endpoint instead of the
//       RPC directly — same inputs, same RPC response shape, plus a WA send
//       on the way out.
//
//   (b) For callers that prefer to stick with the direct RPC (e.g. offline-
//       first queued deliveries), POST to /api/delivery/notify with the
//       resulting delivery_id after the RPC succeeds.
//
// Auth: requires a valid Supabase session (the RPC itself enforces that the
// caller is the distributor on the delivery via `auth.uid()` inside the RPC).
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/whatsapp";

interface SubmitDeliveryBody {
  distributor_id: string;
  store_id: string;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  gps_lat?: number | null;
  gps_lng?: number | null;
  /** Payment received at time of delivery (optional; defaults to 0). */
  payment_amount?: number;
  /** Optional override for the store's recipient phone (defaults to stores.phone). */
  recipient_phone?: string;
}

export async function POST(request: NextRequest) {
  let body: SubmitDeliveryBody;
  try {
    body = (await request.json()) as SubmitDeliveryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.distributor_id || !body?.store_id || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "distributor_id, store_id, and at least one item are required" },
      { status: 400 },
    );
  }

  const userSupabase = createServerSupabase();

  // ── 1. Commit the delivery via the existing RPC (runs in one txn). ────────
  const { data: rpcResult, error: rpcErr } = await userSupabase.rpc("submit_delivery", {
    p_distributor_id: body.distributor_id,
    p_store_id: body.store_id,
    p_items: body.items,
    p_gps_lat: body.gps_lat ?? null,
    p_gps_lng: body.gps_lng ?? null,
  });

  if (rpcErr || !rpcResult) {
    return NextResponse.json(
      { error: rpcErr?.message ?? "submit_delivery failed" },
      { status: 500 },
    );
  }

  const rpc = rpcResult as {
    delivery_id: string;
    total_value: number;
    item_count: number;
    delivered_at: string;
  };

  // ── 2. Send the delivery_receipt WhatsApp (failure doesn't roll back). ────
  // Admin client is used so the send happens regardless of the caller's RLS
  // scope to stores/profiles.
  const admin = createAdminClient();
  const { data: store } = await admin
    .from("stores")
    .select("id, name, phone, owner_phone")
    .eq("id", body.store_id)
    .single();

  const storeRow = store as
    | { name?: string | null; phone?: string | null; owner_phone?: string | null }
    | null;

  const phone =
    body.recipient_phone ??
    storeRow?.phone ??
    storeRow?.owner_phone ??
    null;

  let whatsappLogId: string | null = null;
  let whatsappSent = false;

  if (phone) {
    const deliveredOn = new Date(rpc.delivered_at).toLocaleDateString("en-IN", {
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
        item_count: rpc.item_count,
        total_inr: Number(rpc.total_value).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        delivered_on: deliveredOn,
        payment_inr: Number(body.payment_amount ?? 0).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
      { context: { entityType: "delivery", entityId: rpc.delivery_id } },
    );
    whatsappLogId = wa.logId;
    whatsappSent = wa.success;
  } else {
    console.warn(
      `[api/delivery/submit] No store phone for ${body.store_id}; skipping delivery_receipt send.`,
    );
  }

  return NextResponse.json({
    ...rpc,
    whatsapp: {
      sent: whatsappSent,
      logId: whatsappLogId,
    },
  });
}
