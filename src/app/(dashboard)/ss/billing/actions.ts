// src/app/(dashboard)/ss/billing/actions.ts
// ---------------------------------------------------------------------------
// Server actions for the SS → Billing Report page.
//
//   - fetchBillingReport(filters): returns bills for network distributors
//     in the [from, to] window, including distributor name + status + PDF URL.
//
// Status is computed from payments_applied vs total_amount:
//   paid     → payments_applied ≥ total_amount
//   partial  → 0 < payments_applied < total_amount
//   unpaid   → payments_applied === 0 and bill within terms
//   overdue  → payments_applied < total_amount AND bill_date + 30d < today
// ---------------------------------------------------------------------------

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSsScope, scopeToDistributors } from "../_lib/scope";

export type BillStatus = "paid" | "partial" | "unpaid" | "overdue";

export interface BillingRow {
  id: string;
  billDate: string;
  distributorId: string;
  distributor: string;
  billNumber: string;
  totalAmount: number;
  paymentsApplied: number;
  status: BillStatus;
  pdfUrl: string | null;
}

export interface BillingSummary {
  totalBills: number;
  totalBilled: number;
  totalCollected: number;
  totalOverdue: number;
}

export interface BillingResponse {
  rows: BillingRow[];
  summary: BillingSummary;
  error?: string;
}

const OVERDUE_DAYS = 30;

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function deriveStatus(
  total: number,
  paid: number,
  billDateIso: string | null,
): BillStatus {
  if (paid >= total && total > 0) return "paid";
  if (paid > 0 && paid < total) return "partial";

  // unpaid or overdue
  if (billDateIso) {
    const billMs = new Date(billDateIso).getTime();
    const cutoff = Date.now() - OVERDUE_DAYS * 86_400_000;
    if (Number.isFinite(billMs) && billMs < cutoff && paid < total) return "overdue";
  }
  return "unpaid";
}

export interface BillingFilters {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  distributorId: string; // "all" or uuid
  status: BillStatus | "all";
}

export async function fetchBillingReport(
  filters: BillingFilters,
): Promise<BillingResponse> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    const admin = createAdminClient();

    let q = admin
      .from("bills")
      .select(
        `
          id,
          bill_number,
          bill_date,
          distributor_id,
          total_amount,
          pdf_url,
          payments:payments ( amount )
        `,
      )
      .gte("bill_date", filters.dateFrom)
      .lte("bill_date", filters.dateTo)
      .order("bill_date", { ascending: false });

    q = scopeToDistributors(q, scope, "distributor_id");

    if (filters.distributorId !== "all") {
      q = q.eq("distributor_id", filters.distributorId);
    }

    const { data, error } = await q;
    if (error) throw error;

    // Distributor name lookup (single round-trip for the network).
    const idsSeen = new Set<string>(
      (data ?? []).map((b) => (b as { distributor_id: string }).distributor_id),
    );
    let distributorNames = new Map<string, string>();
    if (idsSeen.size > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(idsSeen));
      distributorNames = new Map(
        (profs ?? []).map((p) => [
          (p as { id: string }).id,
          (p as { full_name: string | null }).full_name ?? "(unnamed)",
        ]),
      );
    }

    const rows: BillingRow[] = (data ?? []).map((raw) => {
      const r = raw as {
        id: string;
        bill_number: string | null;
        bill_date: string;
        distributor_id: string;
        total_amount: number | string | null;
        pdf_url: string | null;
        payments: Array<{ amount: number | string }> | null;
      };
      const total = num(r.total_amount);
      const paid = (r.payments ?? []).reduce((a, p) => a + num(p.amount), 0);
      return {
        id: r.id,
        billDate: r.bill_date,
        distributorId: r.distributor_id,
        distributor: distributorNames.get(r.distributor_id) ?? "(unknown)",
        billNumber: r.bill_number ?? r.id.slice(0, 8),
        totalAmount: total,
        paymentsApplied: paid,
        status: deriveStatus(total, paid, r.bill_date),
        pdfUrl: r.pdf_url,
      };
    });

    const filtered = filters.status === "all" ? rows : rows.filter((r) => r.status === filters.status);

    const summary: BillingSummary = {
      totalBills: filtered.length,
      totalBilled: filtered.reduce((a, r) => a + r.totalAmount, 0),
      totalCollected: filtered.reduce((a, r) => a + r.paymentsApplied, 0),
      totalOverdue: filtered
        .filter((r) => r.status === "overdue")
        .reduce((a, r) => a + Math.max(0, r.totalAmount - r.paymentsApplied), 0),
    };

    return { rows: filtered, summary };
  } catch (err) {
    return {
      rows: [],
      summary: { totalBills: 0, totalBilled: 0, totalCollected: 0, totalOverdue: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Small helper for the page component to render the distributor filter
 * dropdown without duplicating the scope lookup.
 */
export async function fetchNetworkDistributorsLite(): Promise<
  { rows: Array<{ id: string; name: string }>; error?: string }
> {
  try {
    const supabase = createClient();
    const scope = await resolveSsScope(supabase);
    if (scope.distributorIds.length === 0) return { rows: [] };
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", scope.distributorIds)
      .order("full_name");
    if (error) throw error;
    return {
      rows: (data ?? []).map((p) => {
        const r = p as { id: string; full_name: string | null };
        return { id: r.id, name: r.full_name ?? "(unnamed)" };
      }),
    };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}
