// src/app/(dashboard)/dashboard/dispatch/actions.ts
// ---------------------------------------------------------------------------
// Server action: getPendingPickups()
//
// Returns the list of orders awaiting factory pickup for today (IST).
// "Awaiting pickup" = status IN ('confirmed','billed') AND order_date = today.
//
// Visible to super_admin + dispatch_manager. Uses the admin (service-role)
// client for the read so we don't have to widen RLS on orders to include
// dispatch_manager — the auth guard above already verifies the caller has
// the right role before returning anything.
// ---------------------------------------------------------------------------

"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISODate } from "@/lib/billing";

export interface PendingPickup {
  id: string;
  distributor_id: string;
  distributor_name: string | null;
  order_date: string;
  status: "confirmed" | "billed";
  total_amount: number;
  created_at: string;
}

export interface PendingPickupsResult {
  pickups: PendingPickup[];
  error?: string;
}

// ── Guard ────────────────────────────────────────────────────────────────────

async function requireDispatchViewer(): Promise<
  | { ok: true; callerId: string; callerRole: "super_admin" | "dispatch_manager" }
  | { ok: false; error: string }
> {
  const supabaseAuth = createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized." };

  const { data: profile } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (role !== "super_admin" && role !== "dispatch_manager") {
    return {
      ok: false,
      error: "Only Super Admin or Dispatch Manager can view the dispatch queue.",
    };
  }
  return {
    ok: true,
    callerId: user.id,
    callerRole: role as "super_admin" | "dispatch_manager",
  };
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getPendingPickups(): Promise<PendingPickupsResult> {
  const guard = await requireDispatchViewer();
  if (!guard.ok) {
    return { pickups: [], error: guard.error };
  }

  const admin = createAdminClient();
  const today = todayISODate();

  // Pull only today's pending rows. Using the admin client keeps RLS out of
  // the picture for this narrow role; we've already verified the caller.
  const { data, error } = await admin
    .from("orders")
    .select("id, distributor_id, order_date, status, total_amount, created_at")
    .in("status", ["confirmed", "billed"])
    .eq("order_date", today)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[getPendingPickups]", error.message);
    return { pickups: [], error: error.message };
  }

  const rows = (data ?? []) as any[];

  // Batch-resolve distributor names (one round-trip, not N).
  const distributorIds = Array.from(
    new Set(rows.map((r) => r.distributor_id).filter(Boolean)),
  ) as string[];

  const nameMap = new Map<string, string | null>();
  if (distributorIds.length > 0) {
    const { data: profRows } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", distributorIds);
    for (const p of (profRows ?? []) as any[]) {
      nameMap.set(p.id, p.full_name ?? null);
    }
  }

  const pickups: PendingPickup[] = rows.map((r) => ({
    id: r.id,
    distributor_id: r.distributor_id,
    distributor_name: nameMap.get(r.distributor_id) ?? null,
    order_date: r.order_date,
    status: r.status as "confirmed" | "billed",
    total_amount: Number(r.total_amount ?? 0),
    created_at: r.created_at,
  }));

  return { pickups };
}
