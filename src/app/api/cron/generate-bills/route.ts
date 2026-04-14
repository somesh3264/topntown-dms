// src/app/api/cron/generate-bills/route.ts
// ---------------------------------------------------------------------------
// GET /api/cron/generate-bills
//
// Nightly bill generation job — triggered by Vercel Cron at 22:00 IST
// (configured as 16:30 UTC in vercel.json).
//
// Authentication:
//   Authorization: Bearer <CRON_SECRET>
//   The CRON_SECRET env var must be set in Vercel project settings.
//   Vercel automatically adds this header when it invokes the cron.
//
// What it does:
//   1. Verifies the Authorization header.
//   2. Finds all orders for today (IST) with status = 'confirmed'.
//   3. For each order: generates bill, bill_items, stock_allocations,
//      and updates order.status → billed.  (via generateBillForOrder)
//   4. Returns a JSON summary { success, billsGenerated, errors }.
//
// Idempotency:
//   generateBillForOrder skips orders already in 'billed' status, so
//   accidental double-invocations are safe.
//
// Manual testing (development):
//   curl -X GET http://localhost:3000/api/cron/generate-bills \
//     -H "Authorization: Bearer $CRON_SECRET"
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBillForOrder } from "@/lib/billing";
import { todayISODate } from "@/lib/billing";
import { sendMessage } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  // ── 1. Authenticate cron request ──────────────────────────────────────────
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/generate-bills] CRON_SECRET env var is not set.");
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET is not set." },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Find all confirmed orders for today (IST) ───────────────────────────
  const supabase = createAdminClient();
  const today = todayISODate(); // "YYYY-MM-DD" in IST

  console.log(`[cron/generate-bills] Starting bill generation run for ${today}`);

  const { data: confirmedOrders, error: fetchErr } = await supabase
    .from("orders")
    .select("id, distributor_id, total_amount")
    .eq("order_date", today)
    .eq("status", "confirmed");

  if (fetchErr) {
    console.error("[cron/generate-bills] Failed to fetch confirmed orders:", fetchErr.message);
    return NextResponse.json({ error: "Failed to fetch orders.", detail: fetchErr.message }, { status: 500 });
  }

  if (!confirmedOrders || confirmedOrders.length === 0) {
    console.log(`[cron/generate-bills] No confirmed orders found for ${today}.`);
    return NextResponse.json({ success: true, billsGenerated: 0, message: "No confirmed orders for today." });
  }

  console.log(`[cron/generate-bills] Found ${confirmedOrders.length} confirmed order(s) to bill.`);

  // ── 3. Generate a bill for each order ─────────────────────────────────────
  let billsGenerated = 0;
  let notificationsSent = 0;
  const errors: Array<{ orderId: string; error: string }> = [];

  for (const order of confirmedOrders) {
    const orderId = (order as { id: string }).id;

    const result = await generateBillForOrder(supabase, orderId);

    if (result.success) {
      billsGenerated++;
      console.log(
        `[cron/generate-bills] ✓ Order ${orderId} → Bill ${result.billNumber} (${result.billId})`
      );

      // ── 3a. WhatsApp: notify distributor that the bill is ready ─────────
      // The PDF is generated asynchronously by the generate-bill-pdf Edge
      // Function (triggered by INSERT on bills). We wait briefly so the
      // pdf_url is usually populated by the time we send; if it isn't, we
      // still notify with the dashboard URL as a fallback.
      try {
        const notified = await notifyBillReady(supabase, result.billId!);
        if (notified) notificationsSent++;
      } catch (notifyErr) {
        console.error(
          `[cron/generate-bills] WhatsApp notify failed for bill ${result.billId}:`,
          notifyErr,
        );
        // A failed notification is NOT a failed bill — logged in whatsapp_logs for retry.
      }
    } else {
      const errMsg = result.error ?? "Unknown error";
      console.error(`[cron/generate-bills] ✗ Order ${orderId} failed: ${errMsg}`);
      errors.push({ orderId, error: errMsg });
    }
  }

  // ── 4. Return summary ──────────────────────────────────────────────────────
  const hasErrors = errors.length > 0;

  console.log(
    `[cron/generate-bills] Run complete. Generated: ${billsGenerated}, Errors: ${errors.length}`
  );

  return NextResponse.json(
    {
      success: !hasErrors,
      date: today,
      billsGenerated,
      notificationsSent,
      totalOrders: confirmedOrders.length,
      errors: hasErrors ? errors : undefined,
    },
    { status: hasErrors ? 207 : 200 } // 207 Multi-Status if partial failures
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Send the `bill_ready` WhatsApp to the distributor for a freshly-generated bill.
 * Returns true on success. All attempts are persisted to `whatsapp_logs`.
 */
async function notifyBillReady(
  supabase: ReturnType<typeof createAdminClient>,
  billId: string,
): Promise<boolean> {
  // Poll briefly for the pdf_url — the generate-bill-pdf Edge Function usually
  // populates it within ~2s of the INSERT trigger firing.
  let pdfUrl: string | null = null;
  let billNumber: string | null = null;
  let totalAmount: number | null = null;
  let distributorId: string | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabase
      .from("bills")
      .select("bill_number, pdf_url, total_amount, distributor_id")
      .eq("id", billId)
      .single();

    if (data) {
      billNumber = (data as { bill_number: string }).bill_number;
      totalAmount = Number((data as { total_amount: number | string }).total_amount ?? 0);
      distributorId = (data as { distributor_id: string }).distributor_id;
      pdfUrl = (data as { pdf_url: string | null }).pdf_url ?? null;
      if (pdfUrl) break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (!distributorId || !billNumber) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", distributorId)
    .single();

  const phone = (profile as { phone?: string | null } | null)?.phone;
  if (!phone) {
    console.warn(`[cron/generate-bills] No phone for distributor ${distributorId}, skipping WA`);
    return false;
  }

  const amountInr = (totalAmount ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const viewUrl =
    pdfUrl ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/orders/${billId}`.replace(/^\//, "/");

  const res = await sendMessage(
    phone,
    "bill_ready",
    {
      distributor_name:
        (profile as { full_name?: string | null } | null)?.full_name ?? "Distributor",
      bill_number: billNumber,
      amount_inr: amountInr,
      pdf_url: viewUrl,
    },
    { context: { entityType: "bill", entityId: billId } },
  );

  return res.success;
}
