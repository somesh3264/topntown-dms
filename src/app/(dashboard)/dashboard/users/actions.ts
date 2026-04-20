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
  | "distributor"
  | "dispatch_manager";

export interface UserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  /**
   * @deprecated Kept for backward compatibility. The authoritative scope now
   * lives in `zones[]` / `areas[]` (sourced from profile_zones / profile_areas).
   * For users created before the multi-zone migration, this is the same value
   * as `zones[0]?.id` / `areas[0]?.id` (the backfill seeded one entry per legacy
   * row).  New code should prefer the array fields.
   */
  zone_id: string | null;
  zone_name: string | null;
  area_id: string | null;
  area_name: string | null;
  zones: { id: string; name: string }[];
  areas: { id: string; name: string }[];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a list of non-empty IDs from FormData, supporting two shapes:
 *   1. Repeated `key` entries (the standard multi-select POST shape).
 *   2. A single `fallbackKey` singular entry (back-compat with old callers
 *      that still post `zone_id` / `area_id`).
 * Duplicates are collapsed; empty strings are ignored.
 */
function parseIdList(
  formData: FormData,
  key: string,
  fallbackKey?: string
): string[] {
  const raw = formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
  if (raw.length === 0 && fallbackKey) {
    const single = (formData.get(fallbackKey) as string | null)?.trim();
    if (single) return [single];
  }
  return Array.from(new Set(raw));
}

/**
 * Replace the set of profile_zones / profile_areas rows for a user.
 *
 * We do a delete-then-insert rather than diff/upsert because the set is small
 * (typically <20 rows) and the simpler code is easier to audit.  Returns an
 * error string on failure, `null` on success.
 */
async function replaceScope(
  adminSupabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  zoneIds: string[],
  areaIds: string[]
): Promise<string | null> {
  // Zones
  const { error: delZErr } = await adminSupabase
    .from("profile_zones")
    .delete()
    .eq("profile_id", profileId);
  if (delZErr) return delZErr.message;

  if (zoneIds.length > 0) {
    const { error: insZErr } = await adminSupabase
      .from("profile_zones")
      .insert(zoneIds.map((zone_id) => ({ profile_id: profileId, zone_id })));
    if (insZErr) return insZErr.message;
  }

  // Areas
  const { error: delAErr } = await adminSupabase
    .from("profile_areas")
    .delete()
    .eq("profile_id", profileId);
  if (delAErr) return delAErr.message;

  if (areaIds.length > 0) {
    const { error: insAErr } = await adminSupabase
      .from("profile_areas")
      .insert(areaIds.map((area_id) => ({ profile_id: profileId, area_id })));
    if (insAErr) return insAErr.message;
  }

  return null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all users (profiles) joined with their zone(s) and area(s).
 *
 * The authoritative scope now lives in the `profile_zones` and `profile_areas`
 * junction tables — supporting many-to-many assignments — so we hydrate those
 * into `zones[]` / `areas[]`.  The legacy singular `zone_id` / `area_id` are
 * still populated (from the first element of the respective array) so existing
 * callers that haven't migrated yet keep working.
 *
 * Excludes super_admin rows since they are managed separately.
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
      profile_zones ( zones ( id, name ) ),
      profile_areas ( areas ( id, name ) )
    `)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[getUsers]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => {
    const zones: { id: string; name: string }[] = (row.profile_zones ?? [])
      .map((pz: any) => pz.zones)
      .filter(Boolean)
      .map((z: any) => ({ id: z.id, name: z.name }));
    const areas: { id: string; name: string }[] = (row.profile_areas ?? [])
      .map((pa: any) => pa.areas)
      .filter(Boolean)
      .map((a: any) => ({ id: a.id, name: a.name }));

    // Sort for stable, user-friendly display.
    zones.sort((a, b) => a.name.localeCompare(b.name));
    areas.sort((a, b) => a.name.localeCompare(b.name));

    const primaryZone = zones[0] ?? null;
    const primaryArea = areas[0] ?? null;

    return {
      id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      role: row.role as AppRole,
      zone_id: row.zone_id ?? primaryZone?.id ?? null,
      zone_name: primaryZone?.name ?? null,
      area_id: row.area_id ?? primaryArea?.id ?? null,
      area_name: primaryArea?.name ?? null,
      zones,
      areas,
      is_active: row.is_active,
      created_at: row.created_at,
    };
  });
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
 * Kept for any older callers; new code should prefer `getAreasForZones`.
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
 * Fetch the union of areas that belong to any of the provided zone IDs.
 *
 * Used by the multi-select area dropdown: as the user adds / removes zones,
 * the area list is refreshed with the union of candidates. Returns an empty
 * array when no zones are supplied (intentional — area is meaningless without
 * a zone context).
 */
export async function getAreasForZones(
  zoneIds: string[]
): Promise<{ id: string; name: string; zone_id: string }[]> {
  if (!zoneIds || zoneIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("areas")
    .select("id, name, zone_id")
    .in("zone_id", zoneIds)
    .order("name", { ascending: true });

  if (error) {
    console.error("[getAreasForZones]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string; zone_id: string }[];
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

  // Multi-select fields arrive as repeated form entries under the same key.
  // Fallback to the singular key for compatibility with any caller that still
  // posts the old shape.
  const zone_ids = parseIdList(formData, "zone_ids", "zone_id");
  const area_ids = parseIdList(formData, "area_ids", "area_id");

  // ── Validation ────────────────────────────────────────────────────────────
  if (!full_name) return { success: false, error: "Full name is required." };
  if (!phone) return { success: false, error: "Phone number is required." };
  if (!/^\d{10}$/.test(phone))
    return { success: false, error: "Phone must be exactly 10 digits." };
  if (!role) return { success: false, error: "Role is required." };
  if (!password || password.length < 8)
    return { success: false, error: "Password must be at least 8 characters." };

  // Zone required for Super Stockist, Distributor, Sales Person
  if (["super_stockist", "distributor", "sales_person"].includes(role) && zone_ids.length === 0) {
    return { success: false, error: "At least one zone is required for this role." };
  }
  // Area required for Distributor and Sales Person
  if (["distributor", "sales_person"].includes(role) && area_ids.length === 0) {
    return { success: false, error: "At least one area is required for this role." };
  }

  const adminSupabase = createAdminClient();

  // ── Sanity-check that areas belong to the selected zones ──────────────────
  // This protects against a stale client posting (zone=A, area=B-in-zone-C).
  if (zone_ids.length > 0 && area_ids.length > 0) {
    const { data: areasForZones, error: areaCheckError } = await adminSupabase
      .from("areas")
      .select("id")
      .in("zone_id", zone_ids)
      .in("id", area_ids);
    if (areaCheckError) {
      console.error("[createUser] area/zone validation", areaCheckError.message);
      return { success: false, error: areaCheckError.message };
    }
    if ((areasForZones ?? []).length !== area_ids.length) {
      return {
        success: false,
        error: "One or more areas don't belong to the selected zones. Please re-select.",
      };
    }
  }

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
  // The singular zone_id / area_id columns now store the *primary* zone/area
  // (first of the multi-select) purely for back-compat with older read paths.
  // The junction tables are the source of truth.
  const { error: profileError } = await adminSupabase
    .from("profiles")
    .insert({
      id: userId,
      full_name,
      phone,
      role,
      zone_id: zone_ids[0] ?? null,
      area_id: area_ids[0] ?? null,
      is_active: true,
    });

  if (profileError) {
    // Roll back auth user to avoid orphan records
    await adminSupabase.auth.admin.deleteUser(userId);
    console.error("[createUser] profiles insert", profileError.message);
    return { success: false, error: profileError.message };
  }

  // ── Persist multi-zone / multi-area assignments ───────────────────────────
  const assignError = await replaceScope(adminSupabase, userId, zone_ids, area_ids);
  if (assignError) {
    // Clean up both the profile and auth user so we don't leave half-created data.
    await adminSupabase.from("profiles").delete().eq("id", userId);
    await adminSupabase.auth.admin.deleteUser(userId);
    console.error("[createUser] scope assignments", assignError);
    return { success: false, error: assignError };
  }

  revalidatePath("/dashboard/users");
  return { success: true, data: { id: userId } };
}

/**
 * Update an existing user's profile fields.
 *
 * Mutable fields: full_name, phone, role, zone_id, area_id.
 *
 * Password changes and is_active toggles are intentionally out of scope —
 * password resets belong in a dedicated flow and active state has its own
 * activate/deactivate actions so the deactivation guards can run.
 *
 * If the phone changes we also update the corresponding auth.users email
 * (since we use {phone}@topntown.local as the synthetic email) and the
 * user_metadata so the auth record stays in sync with profiles. This keeps
 * login working with the new phone after the edit.
 *
 * Zone/area requirements mirror createUser:
 *   - super_stockist: zone required
 *   - distributor, sales_person: zone AND area required
 *   - super_admin: neither required (and is rejected from edits)
 */
export async function updateUser(
  id: string,
  formData: FormData
): Promise<ActionResult<UserRow>> {
  const full_name = (formData.get("full_name") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const role = formData.get("role") as AppRole;
  const zone_ids = parseIdList(formData, "zone_ids", "zone_id");
  const area_ids = parseIdList(formData, "area_ids", "area_id");

  // ── Validation ────────────────────────────────────────────────────────────
  if (!id) return { success: false, error: "User id is required." };
  if (!full_name) return { success: false, error: "Full name is required." };
  if (!phone) return { success: false, error: "Phone number is required." };
  if (!/^\d{10}$/.test(phone))
    return { success: false, error: "Phone must be exactly 10 digits." };
  if (!role) return { success: false, error: "Role is required." };
  if (role === "super_admin")
    return { success: false, error: "Super admin accounts cannot be edited here." };

  if (["super_stockist", "distributor", "sales_person"].includes(role) && zone_ids.length === 0) {
    return { success: false, error: "At least one zone is required for this role." };
  }
  if (["distributor", "sales_person"].includes(role) && area_ids.length === 0) {
    return { success: false, error: "At least one area is required for this role." };
  }

  const adminSupabase = createAdminClient();

  // ── Fetch current row (to detect phone/role changes and roll back cleanly) ──
  const { data: current, error: fetchError } = await adminSupabase
    .from("profiles")
    .select("id, phone, role")
    .eq("id", id)
    .single();

  if (fetchError || !current) {
    return { success: false, error: "User not found." };
  }

  const phoneChanged = (current.phone ?? "") !== phone;

  // ── If phone changed, update auth.users email + metadata first ────────────
  // We do this before the profiles update so that a failure here leaves the
  // profile row untouched (rather than the profile being ahead of auth).
  if (phoneChanged) {
    const newEmail = `${phone}@topntown.local`;
    const { error: authErr } = await adminSupabase.auth.admin.updateUserById(id, {
      email: newEmail,
      user_metadata: { full_name, role, phone },
    });
    if (authErr) {
      if (authErr.message.toLowerCase().includes("already")) {
        return { success: false, error: "This phone number is already registered." };
      }
      console.error("[updateUser] auth.admin.updateUserById", authErr.message);
      return { success: false, error: authErr.message };
    }
  } else {
    // Still keep metadata in sync for name/role tweaks — cheap and idempotent.
    await adminSupabase.auth.admin.updateUserById(id, {
      user_metadata: { full_name, role, phone },
    });
  }

  // ── Cross-validate: areas must belong to the chosen zones ─────────────────
  if (zone_ids.length > 0 && area_ids.length > 0) {
    const { data: areasForZones, error: areaCheckError } = await adminSupabase
      .from("areas")
      .select("id")
      .in("zone_id", zone_ids)
      .in("id", area_ids);
    if (areaCheckError) {
      console.error("[updateUser] area/zone validation", areaCheckError.message);
      return { success: false, error: areaCheckError.message };
    }
    if ((areasForZones ?? []).length !== area_ids.length) {
      return {
        success: false,
        error: "One or more areas don't belong to the selected zones. Please re-select.",
      };
    }
  }

  // ── Update profile row ────────────────────────────────────────────────────
  // Singular zone_id / area_id mirror the *primary* (first) value from the
  // multi-select so legacy reads still work.  Roles that don't need scoping
  // get NULL across the board.
  const { error: updateError } = await adminSupabase
    .from("profiles")
    .update({
      full_name,
      phone,
      role,
      zone_id: zone_ids[0] ?? null,
      area_id: area_ids[0] ?? null,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[updateUser] profiles update", updateError.message);
    return { success: false, error: updateError.message };
  }

  // ── Replace junction-table assignments ────────────────────────────────────
  const scopeError = await replaceScope(adminSupabase, id, zone_ids, area_ids);
  if (scopeError) {
    console.error("[updateUser] scope assignments", scopeError);
    return { success: false, error: scopeError };
  }

  // ── Re-read with joined zone/area sets so the UI can show the new values ──
  const { data: refreshed, error: refreshError } = await adminSupabase
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
      profile_zones ( zones ( id, name ) ),
      profile_areas ( areas ( id, name ) )
    `)
    .eq("id", id)
    .single();

  if (refreshError || !refreshed) {
    // The update already succeeded; surface a partial success so the caller
    // can refetch the table if it wants to.
    revalidatePath("/dashboard/users");
    return { success: true };
  }

  const ref: any = refreshed;
  const zones: { id: string; name: string }[] = (ref.profile_zones ?? [])
    .map((pz: any) => pz.zones)
    .filter(Boolean)
    .map((z: any) => ({ id: z.id, name: z.name }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  const areas: { id: string; name: string }[] = (ref.profile_areas ?? [])
    .map((pa: any) => pa.areas)
    .filter(Boolean)
    .map((a: any) => ({ id: a.id, name: a.name }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  const row: UserRow = {
    id: ref.id,
    full_name: ref.full_name,
    phone: ref.phone,
    role: ref.role as AppRole,
    zone_id: ref.zone_id ?? zones[0]?.id ?? null,
    zone_name: zones[0]?.name ?? null,
    area_id: ref.area_id ?? areas[0]?.id ?? null,
    area_name: areas[0]?.name ?? null,
    zones,
    areas,
    is_active: ref.is_active,
    created_at: ref.created_at,
  };

  revalidatePath("/dashboard/users");
  return { success: true, data: row };
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
