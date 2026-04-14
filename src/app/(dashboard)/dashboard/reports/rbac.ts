// src/app/(dashboard)/dashboard/reports/rbac.ts
// ---------------------------------------------------------------------------
// RBAC scope resolver for reports.
//
// Given the currently-authenticated profile, returns the list of distributor
// ids the caller is allowed to include in any report. Returning `null` means
// "no scope restriction" (super_admin only).
//
//   super_admin     → null        (no restriction)
//   super_stockist  → distributor_ids drawn from ss_networks
//   sales_person    → distributor_ids whose profile.area_id matches SP's area
//   distributor     → [self_id]   (we still allow running reports over own data)
// ---------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type AppRole =
  | "super_admin"
  | "super_stockist"
  | "sales_person"
  | "distributor";

export interface ReportScope {
  role: AppRole;
  /** null = unrestricted (super_admin only). */
  distributorIds: string[] | null;
  /** Convenience: the user profile's own ids for filter defaults. */
  userId: string;
  userAreaId: string | null;
  userZoneId: string | null;
}

/**
 * Resolve the scope for the current request. Throws if the caller is not
 * authenticated or has no profile.
 */
export async function resolveReportScope(userSupabase: SupabaseClient): Promise<ReportScope> {
  const { data: auth } = await userSupabase.auth.getUser();
  if (!auth?.user) throw new Error("Not authenticated");

  // Admin client is needed for the super_stockist / sales_person joins because
  // ss_networks / profiles RLS are restrictive.
  const admin = createAdminClient();

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, role, zone_id, area_id")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile) {
    throw new Error(`Profile not found: ${error?.message ?? auth.user.id}`);
  }

  const p = profile as {
    id: string;
    role: AppRole;
    zone_id: string | null;
    area_id: string | null;
  };

  const base = {
    role: p.role,
    userId: p.id,
    userAreaId: p.area_id,
    userZoneId: p.zone_id,
  };

  if (p.role === "super_admin") {
    return { ...base, distributorIds: null };
  }

  if (p.role === "super_stockist") {
    const { data: links } = await admin
      .from("ss_networks")
      .select("distributor_id")
      .eq("super_stockist_id", p.id);
    const ids = (links ?? []).map((l) => (l as { distributor_id: string }).distributor_id);
    return { ...base, distributorIds: ids };
  }

  if (p.role === "sales_person") {
    if (!p.area_id) return { ...base, distributorIds: [] };
    const { data: dists } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "distributor")
      .eq("area_id", p.area_id);
    const ids = (dists ?? []).map((d) => (d as { id: string }).id);
    return { ...base, distributorIds: ids };
  }

  // distributor — limited to their own data.
  return { ...base, distributorIds: [p.id] };
}

/**
 * Apply a "distributor_id in (...)" clause honoring the scope. When the scope
 * is unrestricted (super_admin) this is a no-op.
 */
export function applyDistributorScope<T>(
  query: T,
  scope: ReportScope,
  columnName = "distributor_id",
): T {
  if (scope.distributorIds === null) return query;
  if (scope.distributorIds.length === 0) {
    // Poison the query — empty `in` clause fails on PostgREST; use an impossible uuid.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (query as any).in(columnName, ["00000000-0000-0000-0000-000000000000"]);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).in(columnName, scope.distributorIds);
}

/** Throws if the caller is not at least the given role. */
export function requireAtLeast(
  scope: ReportScope,
  minRole: AppRole,
): void {
  const order: AppRole[] = ["distributor", "sales_person", "super_stockist", "super_admin"];
  if (order.indexOf(scope.role) < order.indexOf(minRole)) {
    throw new Error(`Role ${scope.role} is not permitted to view this report`);
  }
}
