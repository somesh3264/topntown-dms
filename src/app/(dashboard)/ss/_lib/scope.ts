// src/app/(dashboard)/ss/_lib/scope.ts
// ---------------------------------------------------------------------------
// Super Stockist scope helper.
//
// Every SS-scoped action calls `resolveSsScope()`:
//   1. Gates the caller to role = "super_stockist" (or super_admin impersonating).
//   2. Returns the distributor_ids in the SS network (via ss_networks table).
//   3. Returns the SS profile (for displaying network owner, billing-to, etc.).
//
// If the caller isn't a super_stockist, the helper throws — pages should
// catch and redirect. Super admins are permitted so they can QA SS views,
// but they see an empty network unless they impersonate an SS.
// ---------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SsScope {
  userId: string;
  ssProfile: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    zone_id: string | null;
    area_id: string | null;
  };
  /** distributor ids linked to this SS via ss_networks. */
  distributorIds: string[];
  /** True for super_admin (not an actual SS — returns empty network). */
  isImpersonating: boolean;
}

export class NotSuperStockistError extends Error {
  constructor() {
    super("Only super_stockist (or super_admin) may access this page.");
  }
}

export async function resolveSsScope(userSupabase: SupabaseClient): Promise<SsScope> {
  const { data: auth } = await userSupabase.auth.getUser();
  if (!auth?.user) throw new Error("Not authenticated");

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, full_name, phone, email, role, zone_id, area_id")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile) throw new Error(`Profile not found: ${error?.message ?? auth.user.id}`);

  const p = profile as {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    role: string;
    zone_id: string | null;
    area_id: string | null;
  };

  if (p.role !== "super_stockist" && p.role !== "super_admin") {
    throw new NotSuperStockistError();
  }

  const isImpersonating = p.role === "super_admin";

  // Only look up ss_networks for actual super_stockists. Super admins get
  // an empty array — if QA needs data, impersonation is the explicit path.
  let distributorIds: string[] = [];
  if (!isImpersonating) {
    const { data: links } = await admin
      .from("ss_networks")
      .select("distributor_id")
      .eq("super_stockist_id", p.id);
    distributorIds = (links ?? []).map(
      (l) => (l as { distributor_id: string }).distributor_id,
    );
  }

  return {
    userId: p.id,
    ssProfile: {
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      email: p.email,
      zone_id: p.zone_id,
      area_id: p.area_id,
    },
    distributorIds,
    isImpersonating,
  };
}

/**
 * Narrow an `in("distributor_id", scope.distributorIds)` clause while handling
 * the empty-array edge case (no network → poison query, returns zero rows).
 */
export function scopeToDistributors<T>(
  query: T,
  scope: SsScope,
  columnName = "distributor_id",
): T {
  const ids = scope.distributorIds.length > 0
    ? scope.distributorIds
    : ["00000000-0000-0000-0000-000000000000"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).in(columnName, ids);
}

/** Guard: throw if the distributor id is not in the SS's network. */
export function assertDistributorInNetwork(scope: SsScope, distributorId: string): void {
  if (scope.isImpersonating) return; // super_admin bypass (for QA)
  if (!scope.distributorIds.includes(distributorId)) {
    throw new Error("Distributor is not part of your network.");
  }
}
