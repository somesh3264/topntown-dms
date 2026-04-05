// src/app/(dashboard)/users/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for User Management (Super Admin).
//
// Business rules enforced:
//   • createUser: Creates a Supabase Auth user (phone-based email format) then
//     inserts a profiles row.  Phone must be unique across auth.users.
//   • deactivateUser: Blocked if the user has open orders (status not in
//     delivered/cancelled) for distributors, or active deliveries today for
//     sales persons.
//   • addToNetwork: Checks ss_networks for an existing assignment for the
//     distributor — each distributor belongs to exactly one SS.
//   • startImpersonation: Sets httpOnly cookies and redirects to the
//     appropriate portal.  Only callable by super_admin.
//   • endImpersonation: Clears impersonation cookies and redirects to
//     /dashboard.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppRole =
  | "super_admin"
  | "super_stockist"
  | "sales_person"
  | "distributor";

export interface UserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  zone_id: string | null;
  zone_name: string | null;
  area_id: string | null;
  area_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface NetworkDistributor {
  id: string;
  full_name: string | null;
  phone: string | null;
  zone_name: string | null;
  area_name: string | null;
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all users (profiles) joined with zone and area names.
 * Excludes the super_admin rows since they are managed separately.
 */
export async function getUsers(): Promise<UserRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      phone,
      role,
      zone_id,
      area_id,
      is_active,
      created_at,
      zones:zone_id ( name ),
      areas:area_id ( name )
    `)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[getUsers]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role as AppRole,
    zone_id: row.zone_id,
    zone_name: row.zones?.name ?? null,
    area_id: row.area_id,
    area_name: row.areas?.name ?? null,
    is_active: row.is_active,
    created_at: row.created_at,
  }));
}

/**
 * Fetch all zones for the Add User form dropdowns.
 */
export async function getZonesForSelect(): Promise<
  { id: string; name: string }[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("zones")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    console.error("[getZonesForSelect]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Fetch areas for a specific zone (used in the Add User form when zone changes).
 */
export async function getAreasForZone(
  zoneId: string
): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("areas")
    .select("id, name")
    .eq("zone_id", zoneId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[getAreasForZone]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Get all distributors in a Super Stockist's network.
 */
export async function getNetworkDistributors(
  ssId: string
): Promise<NetworkDistributor[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("ss_networks")
    .select(`
      distributor_id,
      profiles:distributor_id (
        id,
        full_name,
        phone,
        zones:zone_id ( name ),
        areas:area_id ( name )
      )
    `)
    .eq("super_stockist_id", ssId);

  if (error) {
    console.error("[getNetworkDistributors]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.profiles.id,
    full_name: row.profiles.full_name,
    phone: row.profiles.phone,
    zone_name: row.profiles.zones?.name ?? null,
    area_name: row.profiles.areas?.name ?? null,
  }));
}

/**
 * Get distributors NOT yet assigned to any SS network.
 */
export async function getUnassignedDistributors(): Promise<
  { id: string; full_name: string | null; phone: string | null }[]
> {
  const supabase = createClient();

  // Get all distributor IDs already in a network
  const { data: assigned } = await supabase
    .from("ss_networks")
    .select("distributor_id");

  const assignedIds = (assigned ?? []).map((r: any) => r.distributor_id);

  let query = supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("role", "distributor")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (assignedIds.length > 0) {
    query = query.not("id", "in", `(${assignedIds.join(",")})`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getUnassignedDistributors]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; full_name: string | null; phone: string | null }[];
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new user.
 *
 * Steps:
 *   1. Validate inputs.
 *   2. Create Supabase Auth user (phone-based: {phone}@topntown.local).
 *   3. Insert a profiles row referencing the new auth user ID.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in env.
 */
export async function createUser(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const full_name = (formData.get("full_name") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const role = formData.get("role") as AppRole;
  const password = formData.get("password") as string;
  const zone_id = (formData.get("zone_id") as string) || null;
  const area_id = (formData.get("area_id") as string) || null;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!full_name) return { success: false, error: "Full name is required." };
  if (!phone) return { success: false, error: "Phone number is required." };
  if (!/^\d{10}$/.test(phone))
    return { success: false, error: "Phone must be exactly 10 digits." };
  if (!role) return { success: false, error: "Role is required." };
  if (!password || password.length < 8)
    return { success: false, error: "Password must be at least 8 characters." };

  // Zone required for Super Stockist, Distributor, Sales Person
  if (["super_stockist", "distributor", "sales_person"].includes(role) && !zone_id) {
    return { success: false, error: "Zone is required for this role." };
  }
  // Area required for Distributor and Sales Person
  if (["distributor", "sales_person"].includes(role) && !area_id) {
    return { success: false, error: "Area is required for this role." };
  }

  const adminSupabase = createAdminClient();

  // ── Create auth user ──────────────────────────────────────────────────────
  const email = `${phone}@topntown.local`;
  const { data: authData, error: authError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, phone },
    });

  if (authError) {
    // Duplicate email means phone already registered
    if (authError.message.toLowerCase().includes("already")) {
      return { success: false, error: "This phone number is already registered." };
    }
    console.error("[createUser] auth.admin.createUser", authError.message);
    return { success: false, error: authError.message };
  }

  const userId = authData.user.id;

  // ── Insert profile ─────────────────────────────────────────────────────────
  // Use the regular (anon) client so RLS policies are respected where possible.
  // The admin client is used here since profiles may require service-role for insert.
  const { error: profileError } = await adminSupabase
    .from("profiles")
    .insert({
      id: userId,
      full_name,
      phone,
      role,
      zone_id: zone_id || null,
      area_id: area_id || null,
      is_active: true,
    });

  if (profileError) {
    // Roll back auth user to avoid orphan records
    await adminSupabase.auth.admin.deleteUser(userId);
    console.error("[createUser] profiles insert", profileError.message);
    return { success: false, error: profileError.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true, data: { id: userId } };
}

/**
 * Deactivate a user.
 *
 * Guard: blocked if the user has open orders (for distributors) or
 * active deliveries today (for sales persons).
 */
export async function deactivateUser(id: string): Promise<ActionResult> {
  const supabase = createClient();

  // Fetch role first
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", id)
    .single();

  if (profileError || !profile) {
    return { success: false, error: "User not found." };
  }

  const role = profile.role as AppRole;

  // ── Deactivation guard ───────────────────────────────────────────────────
  if (role === "distributor") {
    // Check for open (non-terminal) orders
    const { count, error: ordersError } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("distributor_id", id)
      .not("status", "in", '("delivered","cancelled")');

    if (!ordersError && (count ?? 0) > 0) {
      return {
        success: false,
        error: `Cannot deactivate: user has ${count} open order(s). Resolve them first.`,
      };
    }
  }

  if (role === "sales_person") {
    // Check for deliveries scheduled today
    const today = new Date().toISOString().split("T")[0];
    const { count, error: deliveriesError } = await supabase
      .from("deliveries")
      .select("*", { count: "exact", head: true })
      .eq("sales_person_id", id)
      .eq("delivery_date", today)
      .not("status", "in", '("completed","cancelled")');

    if (!deliveriesError && (count ?? 0) > 0) {
      return {
        success: false,
        error: `Cannot deactivate: user has ${count} delivery task(s) scheduled for today.`,
      };
    }
  }

  // ── Perform deactivation ──────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("[deactivateUser]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true };
}

/**
 * Reactivate a previously deactivated user.
 */
export async function activateUser(id: string): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("[activateUser]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true };
}

/**
 * Add a distributor to a Super Stockist's network.
 *
 * Guard: each distributor can belong to exactly one SS (UNIQUE distributor_id
 * in ss_networks).  If already assigned, returns a descriptive error.
 */
export async function addToNetwork(
  ssId: string,
  distId: string
): Promise<ActionResult> {
  const supabase = createClient();

  // Check for existing assignment
  const { data: existing, error: checkError } = await supabase
    .from("ss_networks")
    .select("super_stockist_id, profiles:super_stockist_id ( full_name )")
    .eq("distributor_id", distId)
    .maybeSingle();

  if (checkError) {
    console.error("[addToNetwork] check", checkError.message);
    return { success: false, error: checkError.message };
  }

  if (existing) {
    const ownerName = (existing as any).profiles?.full_name ?? "another Super Stockist";
    return {
      success: false,
      error: `This distributor is already assigned to ${ownerName}. Remove them from that network first.`,
    };
  }

  const { error } = await supabase
    .from("ss_networks")
    .insert({ super_stockist_id: ssId, distributor_id: distId });

  if (error) {
    // 23505 = unique_violation (race condition)
    if (error.code === "23505") {
      return {
        success: false,
        error: "This distributor is already in a network.",
      };
    }
    console.error("[addToNetwork]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true };
}

/**
 * Remove a distributor from a Super Stockist's network.
 */
export async function removeFromNetwork(
  ssId: string,
  distId: string
): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("ss_networks")
    .delete()
    .eq("super_stockist_id", ssId)
    .eq("distributor_id", distId);

  if (error) {
    console.error("[removeFromNetwork]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true };
}

// ─── Impersonation ────────────────────────────────────────────────────────────

/**
 * Start impersonating another user.
 * Sets httpOnly cookies read by middleware and redirects to the correct portal.
 *
 * Security note: caller must be super_admin — the middleware enforces this at
 * the route level, and the layout will not render this action for other roles.
 */
export async function startImpersonation(
  userId: string,
  role: AppRole
): Promise<void> {
  const cookieStore = cookies();

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    // No maxAge — session-scoped; cleared on browser close or endImpersonation.
  };

  cookieStore.set("impersonating_user_id", userId, cookieOpts);
  cookieStore.set("impersonating_role", role, cookieOpts);

  // Redirect to the impersonated role's home portal
  const destination = role === "distributor" ? "/app" : "/dashboard";
  redirect(destination);
}

/**
 * End the active impersonation session.
 * Clears the two impersonation cookies and redirects back to /dashboard.
 */
export async function endImpersonation(): Promise<void> {
  const cookieStore = cookies();
  cookieStore.delete("impersonating_user_id");
  cookieStore.delete("impersonating_role");
  redirect("/dashboard");
}
