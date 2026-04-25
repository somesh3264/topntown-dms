// src/app/(dashboard)/stores/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for Store Management (v1.1).
//
// Business rules enforced:
//   • createStore:
//       - area_id is required (submit guard)
//       - gps_lat / gps_lng are required (submit guard)
//       - phone format: 10 digits
//       - Distributors create stores with is_active = false + approval request
//       - Super Admin / Sales Person create with is_active = true directly
//   • updateStore:
//       - area re-assignment requires super_admin role
//   • deactivateStore: simple soft-delete
//   • approveStore: sets is_active = true, approval status = 'approved'
//   • rejectStore:   sets approval status = 'rejected' + rejection_reason
//
// Role scoping (mirrors RLS policies):
//   SA  → all stores
//   SS  → stores whose primary_distributor_id is in their ss_network
//   SP  → stores in their assigned area_id
//   Distributor → stores with primary_distributor_id = self
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppRole =
  | "super_admin"
  | "super_stockist"
  | "sales_person"
  | "distributor";

export interface StoreRow {
  id: string;
  name: string;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  area_id: string;
  area_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  primary_distributor_id: string | null;
  distributor_name: string | null;
  is_active: boolean;
  onboarded_by: string;
  created_at: string;
  /**
   * Approval lifecycle of the latest store_approval_requests row, if any.
   * - "pending": distributor submitted, SA hasn't reviewed yet
   * - "approved": SA approved (mirrors is_active=true after activation)
   * - "rejected": SA declined; rejection_reason carries the message
   * - null: store was created directly by SA/SP (no approval row exists)
   */
  approval_status: "pending" | "approved" | "rejected" | null;
  /** Approval row id — needed to deep-link the Review button. */
  approval_id: string | null;
  /** Latest uploaded shop photo URL. Used by the edit form so SA isn't forced to re-take. */
  photo_url: string | null;
}

export interface ApprovalRow {
  id: string;
  store_id: string;
  store_name: string;
  owner_name: string | null;
  area_name: string | null;
  zone_name: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  photo_url: string | null;
  submitted_by: string;
  submitter_name: string | null;
  assigned_salesperson_id: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch stores with role-scoped RLS automatically applied by Supabase.
 * Joins zone + area names, distributor name.
 */
export async function getStores(filters?: {
  zoneId?: string;
  areaId?: string;
  activeOnly?: boolean;
  search?: string;
}): Promise<StoreRow[]> {
  const supabase = createClient();

  // Pull approval status + photo URL alongside each store. The two related
  // tables are LEFT joined so stores without an approval row (created
  // directly by SA/SP) and stores without a photo still come through.
  let query = supabase.from("stores").select(`
    id,
    name,
    owner_name,
    phone,
    address,
    gps_lat,
    gps_lng,
    area_id,
    primary_distributor_id,
    is_active,
    onboarded_by,
    created_at,
    areas:area_id (
      id,
      name,
      zone_id,
      zones:zone_id ( id, name )
    ),
    profiles:primary_distributor_id ( full_name ),
    store_approval_requests ( id, status, created_at ),
    store_photos!store_photos_store_id_fkey ( photo_url )
  `);

  if (filters?.areaId) {
    query = query.eq("area_id", filters.areaId);
  } else if (filters?.zoneId) {
    // Filter by zone via area join — use subquery approach
    const { data: areaIds } = await supabase
      .from("areas")
      .select("id")
      .eq("zone_id", filters.zoneId);
    const ids = (areaIds ?? []).map((a: any) => a.id);
    if (ids.length > 0) {
      query = query.in("area_id", ids);
    }
  }

  if (filters?.activeOnly !== undefined && filters.activeOnly) {
    query = query.eq("is_active", true);
  } else if (filters?.activeOnly === false) {
    query = query.eq("is_active", false);
  }

  if (filters?.search?.trim()) {
    query = query.ilike("name", `%${filters.search.trim()}%`);
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    console.error("[getStores]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => {
    // PostgREST returns 1:M joins as arrays. Pick the most recent row from
    // each — sorted client-side (the result set is small per store).
    const approvals: Array<{ id: string; status: string; created_at: string }> =
      Array.isArray(row.store_approval_requests)
        ? row.store_approval_requests
        : row.store_approval_requests
        ? [row.store_approval_requests]
        : [];
    const latestApproval =
      approvals
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;

    // We don't know whether store_photos has a sortable timestamp column on
    // every deployment, so just take the first row — for a single-photo
    // workflow that's the only row, and for multi-photo it's "good enough"
    // until someone implements a gallery picker.
    const photos: Array<{ photo_url: string }> = Array.isArray(row.store_photos)
      ? row.store_photos
      : row.store_photos
      ? [row.store_photos]
      : [];
    const latestPhoto = photos[0] ?? null;

    return {
      id: row.id,
      name: row.name,
      owner_name: row.owner_name,
      phone: row.phone,
      address: row.address,
      gps_lat: row.gps_lat,
      gps_lng: row.gps_lng,
      area_id: row.area_id,
      area_name: row.areas?.name ?? null,
      zone_id: row.areas?.zone_id ?? null,
      zone_name: row.areas?.zones?.name ?? null,
      primary_distributor_id: row.primary_distributor_id,
      distributor_name: row.profiles?.full_name ?? null,
      is_active: row.is_active,
      onboarded_by: row.onboarded_by,
      created_at: row.created_at,
      approval_status:
        (latestApproval?.status as StoreRow["approval_status"]) ?? null,
      approval_id: latestApproval?.id ?? null,
      photo_url: latestPhoto?.photo_url ?? null,
    } satisfies StoreRow;
  });
}

/**
 * Fetch all zones for filter + form dropdowns.
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
 * Fetch areas for a given zone (cascading dropdown).
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
 * Fetch distributors active in a given area.
 * Used in StoreForm's "Assigned Distributor" searchable dropdown.
 */
export async function getDistributorsForArea(
  areaId: string
): Promise<{ id: string; full_name: string | null; phone: string | null }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("role", "distributor")
    .eq("area_id", areaId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[getDistributorsForArea]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; full_name: string | null; phone: string | null }[];
}

/**
 * Fetch the current user's profile (role + area).
 */
export async function getMyProfile(): Promise<{
  id: string;
  role: AppRole;
  area_id: string | null;
  zone_id: string | null;
} | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, area_id, zone_id")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as any;
}

/**
 * Fetch pending store approvals for the approvals dashboard.
 * SA sees all; SP sees only their assigned approvals.
 */
export async function getStoreApprovals(
  statusFilter: "pending" | "approved" | "rejected" | "all" = "pending"
): Promise<ApprovalRow[]> {
  const supabase = createClient();

  let query = supabase.from("store_approval_requests").select(`
    id,
    store_id,
    submitted_by,
    assigned_salesperson_id,
    status,
    rejection_reason,
    reviewed_at,
    created_at,
    stores:store_id (
      name,
      owner_name,
      gps_lat,
      gps_lng,
      areas:area_id (
        name,
        zones:zone_id ( name )
      )
    ),
    submitter:submitted_by ( full_name ),
    store_photos!store_photos_store_id_fkey (
      photo_url
    )
  `);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    console.error("[getStoreApprovals]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    store_id: row.store_id,
    store_name: row.stores?.name ?? "—",
    owner_name: row.stores?.owner_name ?? null,
    area_name: row.stores?.areas?.name ?? null,
    zone_name: row.stores?.areas?.zones?.name ?? null,
    gps_lat: row.stores?.gps_lat ?? null,
    gps_lng: row.stores?.gps_lng ?? null,
    photo_url:
      Array.isArray(row.store_photos) && row.store_photos.length > 0
        ? row.store_photos[0].photo_url
        : null,
    submitted_by: row.submitted_by,
    submitter_name: row.submitter?.full_name ?? null,
    assigned_salesperson_id: row.assigned_salesperson_id,
    status: row.status as "pending" | "approved" | "rejected",
    rejection_reason: row.rejection_reason,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  }));
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new store.
 *
 * Steps:
 *   1. Validate required fields (area_id, gps, phone format).
 *   2. Insert store row (is_active depends on caller's role).
 *   3. Upload photo to Supabase Storage "store-photos" bucket.
 *   4. Insert store_photos row.
 *   5. If caller is distributor → create store_approval_request.
 *
 * FormData keys:
 *   store_name, owner_name, phone, address,
 *   zone_id, area_id,
 *   gps_lat, gps_lng,
 *   distributor_id (optional — the assigned distributor),
 *   photo_data_url (base64 data URL captured client-side)
 */
export async function createStore(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const adminSupabase = createAdminClient();

  // ── Auth ───────────────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, area_id")
    .eq("id", user.id)
    .single();

  if (!profile) return { success: false, error: "Profile not found." };
  const role = profile.role as AppRole;

  // ── Parse fields ──────────────────────────────────────────────────────────
  const store_name = (formData.get("store_name") as string)?.trim();
  const owner_name = (formData.get("owner_name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const area_id = (formData.get("area_id") as string)?.trim();
  const gps_lat = parseFloat(formData.get("gps_lat") as string);
  const gps_lng = parseFloat(formData.get("gps_lng") as string);
  const distributor_id =
    (formData.get("distributor_id") as string)?.trim() || null;
  const photo_data_url = formData.get("photo_data_url") as string | null;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!store_name) return { success: false, error: "Store name is required." };
  if (!area_id) return { success: false, error: "Area is required." };
  if (isNaN(gps_lat) || isNaN(gps_lng)) {
    return { success: false, error: "GPS coordinates are required." };
  }
  if (phone && !/^\d{10}$/.test(phone)) {
    return { success: false, error: "Phone must be exactly 10 digits." };
  }
  if (!photo_data_url) {
    return { success: false, error: "Shop photo is required." };
  }

  // ── Determine is_active ───────────────────────────────────────────────────
  // Distributors create stores pending approval; SA/SS/SP create active stores
  const is_active = role !== "distributor";

  // ── Insert store ──────────────────────────────────────────────────────────
  const { data: storeData, error: storeError } = await supabase
    .from("stores")
    .insert({
      name: store_name,
      owner_name,
      phone,
      address,
      gps_lat,
      gps_lng,
      area_id,
      primary_distributor_id: distributor_id,
      is_active,
      onboarded_by: user.id,
    })
    .select("id")
    .single();

  if (storeError || !storeData) {
    console.error("[createStore] insert", storeError?.message);
    return { success: false, error: storeError?.message ?? "Failed to create store." };
  }

  const storeId = storeData.id;

  // ── Upload photo to Supabase Storage ─────────────────────────────────────
  let photoUrl: string | null = null;
  if (photo_data_url) {
    // Convert base64 data URL to Blob
    const [header, base64] = photo_data_url.split(",");
    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });
    const ext = mime.split("/")[1] || "jpg";
    const filePath = `${storeId}/shop_${Date.now()}.${ext}`;

    const { error: uploadError } = await adminSupabase.storage
      .from("store-photos")
      .upload(filePath, blob, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error("[createStore] photo upload", uploadError.message);
      // Non-fatal: continue, but log
    } else {
      const { data: publicData } = adminSupabase.storage
        .from("store-photos")
        .getPublicUrl(filePath);
      photoUrl = publicData.publicUrl;

      // Insert store_photos record
      await supabase.from("store_photos").insert({
        store_id: storeId,
        photo_url: photoUrl,
        uploaded_by: user.id,
      });
    }
  }

  // ── Create approval request for distributors ──────────────────────────────
  if (role === "distributor") {
    // Find the sales person assigned to this area
    const { data: spData } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "sales_person")
      .eq("area_id", area_id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    await supabase.from("store_approval_requests").insert({
      store_id: storeId,
      submitted_by: user.id,
      assigned_salesperson_id: spData?.id ?? null,
      status: "pending",
    });
  }

  revalidatePath("/dashboard/stores");
  return { success: true, data: { id: storeId } };
}

/**
 * Update an existing store.
 *
 * Area re-assignment requires super_admin role — enforced here and shown
 * as a lock icon in the UI for other roles.
 */
export async function updateStore(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role as AppRole | undefined;

  // ── Parse fields ──────────────────────────────────────────────────────────
  const store_name = (formData.get("store_name") as string)?.trim();
  const owner_name = (formData.get("owner_name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const new_area_id = (formData.get("area_id") as string)?.trim();
  const gps_lat_str = formData.get("gps_lat") as string;
  const gps_lng_str = formData.get("gps_lng") as string;
  const distributor_id =
    (formData.get("distributor_id") as string)?.trim() || null;

  if (!store_name) return { success: false, error: "Store name is required." };
  if (phone && !/^\d{10}$/.test(phone)) {
    return { success: false, error: "Phone must be exactly 10 digits." };
  }

  // ── Area re-assignment guard ───────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("stores")
    .select("area_id")
    .eq("id", id)
    .single();

  if (existing && new_area_id && existing.area_id !== new_area_id) {
    if (role !== "super_admin") {
      return {
        success: false,
        error: "Only a Super Admin can re-assign the store area.",
      };
    }
  }

  const updatePayload: Record<string, unknown> = {
    name: store_name,
    owner_name,
    phone,
    address,
    primary_distributor_id: distributor_id,
  };

  if (new_area_id) updatePayload.area_id = new_area_id;
  if (gps_lat_str && gps_lng_str) {
    const lat = parseFloat(gps_lat_str);
    const lng = parseFloat(gps_lng_str);
    if (!isNaN(lat) && !isNaN(lng)) {
      updatePayload.gps_lat = lat;
      updatePayload.gps_lng = lng;
    }
  }

  const { error } = await supabase
    .from("stores")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    console.error("[updateStore]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/stores");
  return { success: true };
}

/**
 * Soft-deactivate a store (sets is_active = false).
 */
export async function deactivateStore(id: string): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("stores")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("[deactivateStore]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/stores");
  return { success: true };
}

/**
 * Reactivate a deactivated store.
 */
export async function activateStore(id: string): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = await supabase
    .from("stores")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("[activateStore]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/stores");
  return { success: true };
}

/**
 * Approve a store (SA only).
 * Sets store.is_active = true and approval status = 'approved'.
 */
export async function approveStore(
  approvalId: string,
  storeId: string
): Promise<ActionResult> {
  const supabase = createClient();

  const now = new Date().toISOString();

  // Update approval record
  const { error: approvalError } = await supabase
    .from("store_approval_requests")
    .update({ status: "approved", reviewed_at: now })
    .eq("id", approvalId);

  if (approvalError) {
    console.error("[approveStore] approval update", approvalError.message);
    return { success: false, error: approvalError.message };
  }

  // Activate the store
  const { error: storeError } = await supabase
    .from("stores")
    .update({ is_active: true })
    .eq("id", storeId);

  if (storeError) {
    console.error("[approveStore] store activate", storeError.message);
    return { success: false, error: storeError.message };
  }

  revalidatePath("/dashboard/stores");
  revalidatePath("/dashboard/stores/approvals");
  return { success: true };
}

/**
 * Reject a store approval request.
 * Stores rejection_reason and keeps store is_active = false.
 */
export async function rejectStore(
  approvalId: string,
  reason: string
): Promise<ActionResult> {
  if (!reason?.trim()) {
    return { success: false, error: "Rejection reason is required." };
  }

  const supabase = createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("store_approval_requests")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      reviewed_at: now,
    })
    .eq("id", approvalId);

  if (error) {
    console.error("[rejectStore]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/stores/approvals");
  return { success: true };
}
