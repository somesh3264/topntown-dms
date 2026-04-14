// supabase/functions/generate-bill-pdf/index.ts
//
// Top N Town — Advance Bill PDF Generator (Supabase Edge Function, Deno).
//
// POST { billId: string }
//   1. Loads bill + bill_items + distributor profile (+ zone/area) + products.
//   2. Renders a professional invoice PDF with jsPDF + autotable.
//   3. Uploads to Storage: bills/<year>/<month>/<bill_number>.pdf
//   4. Updates bills.pdf_url with the public URL.
//
// Deploy:   supabase functions deploy generate-bill-pdf --no-verify-jwt
// Secrets:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase),
//           SUPPORT_CONTACT (optional — shown in the footer).
//
// Invoke (server-to-server, e.g. pg_cron / another Edge Function):
//   curl -X POST \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"billId":"<uuid>"}' \
//     "$SUPABASE_URL/functions/v1/generate-bill-pdf"

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import autoTable from "https://esm.sh/jspdf-autotable@3.8.2";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface BillRow {
  id: string;
  bill_number: string;
  bill_date: string;          // yyyy-mm-dd
  total_amount: number;
  status: string;
  created_at: string;
  distributor_id: string;
  order_id: string;
  pdf_url: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  zones: { name: string | null } | null;
  areas: { name: string | null } | null;
}

interface BillItemRow {
  allocated_qty: number;
  unit_price: number;
  tax_amount: number;
  products: {
    name: string;
    category: string | null;
    tax_rate: number;
  } | null;
}

// ----------------------------------------------------------------------------
// CORS
// ----------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const INR = (n: number) =>
  `Rs. ${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatIST(d: Date) {
  // Render the generation timestamp in IST for distributors.
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${fmt.format(d)} IST`;
}

// ----------------------------------------------------------------------------
// Data loader
// ----------------------------------------------------------------------------

async function loadBillContext(supabase: SupabaseClient, billId: string) {
  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .select(
      "id, bill_number, bill_date, total_amount, status, created_at, distributor_id, order_id, pdf_url",
    )
    .eq("id", billId)
    .single<BillRow>();

  if (billErr || !bill) {
    throw new Error(`Bill not found: ${billErr?.message ?? billId}`);
  }

  const { data: distributor, error: distErr } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, zones:zone_id ( name ), areas:area_id ( name )",
    )
    .eq("id", bill.distributor_id)
    .single<ProfileRow>();

  if (distErr || !distributor) {
    throw new Error(
      `Distributor profile not found: ${distErr?.message ?? bill.distributor_id}`,
    );
  }

  const { data: items, error: itemErr } = await supabase
    .from("bill_items")
    .select(
      "allocated_qty, unit_price, tax_amount, products:product_id ( name, category, tax_rate )",
    )
    .eq("bill_id", bill.id);

  if (itemErr) {
    throw new Error(`bill_items load failed: ${itemErr.message}`);
  }

  return { bill, distributor, items: (items ?? []) as BillItemRow[] };
}

// ----------------------------------------------------------------------------
// PDF renderer
// ----------------------------------------------------------------------------

function renderPdf(ctx: {
  bill: BillRow;
  distributor: ProfileRow;
  items: BillItemRow[];
  supportContact: string;
}): Uint8Array {
  const { bill, distributor, items, supportContact } = ctx;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // ---- Header ---------------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("TOP N TOWN", margin, 55);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text("Advance Bill / Tax Invoice", margin, 72);
  doc.setTextColor(0);

  // Header right-aligned meta block
  const metaX = pageWidth - margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Bill #: ${bill.bill_number}`, metaX, 55, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Bill Date: ${bill.bill_date}`, metaX, 70, { align: "right" });
  doc.text(`Generated: ${formatIST(new Date())}`, metaX, 85, { align: "right" });

  // Divider
  doc.setDrawColor(200);
  doc.setLineWidth(0.8);
  doc.line(margin, 100, pageWidth - margin, 100);

  // ---- Distributor block ----------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Billed To (Distributor)", margin, 120);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const distLines = [
    `Name : ${distributor.full_name ?? "-"}`,
    `Phone: ${distributor.phone ?? "-"}`,
    `Zone : ${distributor.zones?.name ?? "-"}`,
    `Area : ${distributor.areas?.name ?? "-"}`,
  ];
  distLines.forEach((l, i) => doc.text(l, margin, 138 + i * 14));

  // ---- Items table ----------------------------------------------------------
  let subTotal = 0;
  let totalTax = 0;

  const body = items.map((it) => {
    const qty = Number(it.allocated_qty ?? 0);
    const unit = Number(it.unit_price ?? 0);
    const tax = Number(it.tax_amount ?? 0);
    const line = qty * unit + tax;
    subTotal += qty * unit;
    totalTax += tax;

    return [
      it.products?.name ?? "-",
      it.products?.category ?? "-",
      String(qty),
      INR(unit),
      `${Number(it.products?.tax_rate ?? 0).toFixed(2)}%`,
      INR(tax),
      INR(line),
    ];
  });

  autoTable(doc, {
    startY: 205,
    margin: { left: margin, right: margin },
    head: [[
      "Product",
      "Category",
      "Qty",
      "Unit Price",
      "Tax %",
      "Tax Amt",
      "Line Total",
    ]],
    body,
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
    headStyles: {
      fillColor: [33, 37, 41],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
    },
    bodyStyles: { textColor: 30 },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 80 },
      2: { halign: "right", cellWidth: 40 },
      3: { halign: "right", cellWidth: 70 },
      4: { halign: "right", cellWidth: 50 },
      5: { halign: "right", cellWidth: 65 },
      6: { halign: "right", cellWidth: 80 },
    },
    didDrawPage: () => {
      // Footer drawn on every page.
      const footerY = pageHeight - 30;
      doc.setDrawColor(220);
      doc.line(margin, footerY - 14, pageWidth - margin, footerY - 14);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(
        `System-generated document. For queries: ${supportContact}`,
        pageWidth / 2,
        footerY,
        { align: "center" },
      );
      doc.setTextColor(0);
    },
  });

  // ---- Summary --------------------------------------------------------------
  const grandTotal = subTotal + totalTax;
  const finalY = (doc as any).lastAutoTable?.finalY ?? 240;
  const summaryX = pageWidth - margin - 230;
  let y = finalY + 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Sub-total", summaryX, y);
  doc.text(INR(subTotal), pageWidth - margin, y, { align: "right" });
  y += 16;
  doc.text("Total Tax", summaryX, y);
  doc.text(INR(totalTax), pageWidth - margin, y, { align: "right" });
  y += 8;
  doc.setDrawColor(180);
  doc.line(summaryX, y, pageWidth - margin, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Grand Total (INR)", summaryX, y);
  doc.text(INR(grandTotal), pageWidth - margin, y, { align: "right" });

  // Sanity note if computed grand total drifts from stored total_amount.
  const stored = Number(bill.total_amount ?? 0);
  if (Math.abs(stored - grandTotal) > 0.5) {
    y += 24;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(160, 80, 0);
    doc.text(
      `Note: stored bill total (${INR(stored)}) differs from computed total.`,
      margin,
      y,
    );
    doc.setTextColor(0);
  }

  const buf = doc.output("arraybuffer");
  return new Uint8Array(buf);
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let billId: string | undefined;
  try {
    const body = await req.json();
    billId = body?.billId;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!billId) {
    return json({ error: "billId is required" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPPORT_CONTACT =
    Deno.env.get("SUPPORT_CONTACT") ?? "support@topntown.example";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "Server not configured" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const ctx = await loadBillContext(supabase, billId);

    const pdfBytes = renderPdf({
      bill: ctx.bill,
      distributor: ctx.distributor,
      items: ctx.items,
      supportContact: SUPPORT_CONTACT,
    });

    const billDate = new Date(ctx.bill.bill_date);
    const year = billDate.getUTCFullYear();
    const month = pad2(billDate.getUTCMonth() + 1);
    // Path-safe bill number — defensive only; bill_number should already be safe.
    const safeNumber = ctx.bill.bill_number.replace(/[^A-Za-z0-9_\-]/g, "_");
    const storagePath = `${year}/${month}/${safeNumber}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("bills")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

    const { data: pub } = supabase.storage
      .from("bills")
      .getPublicUrl(storagePath);
    const publicUrl = pub.publicUrl;

    const { error: updErr } = await supabase
      .from("bills")
      .update({ pdf_url: publicUrl })
      .eq("id", ctx.bill.id);

    if (updErr) {
      throw new Error(`Failed to update bills.pdf_url: ${updErr.message}`);
    }

    return json({
      ok: true,
      billId: ctx.bill.id,
      billNumber: ctx.bill.bill_number,
      storagePath,
      pdfUrl: publicUrl,
    });
  } catch (err) {
    console.error("[generate-bill-pdf] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});
