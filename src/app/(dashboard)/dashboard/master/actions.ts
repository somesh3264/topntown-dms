// src/app/(dashboard)/master/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for Zone & Area master data management.
//
// Business rules:
//   • Zones with one or more areas CANNOT be deleted (FK ON DELETE RESTRICT).
//   • Areas that are referenced by at least one profile CANNOT be deleted.
//   • Zone names must be unique (enforced by DB UNIQUE constraint).
//   • Area names must be unique within a zone (enforced at the action layer).
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Zone {
  id: string;
  name: string;
  created_at: string;
  area_count: number; // computed via count(areas)
}

export interface Area {
  id: string;
  name: string;
  zone_id: string;
  created_at: string;
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Zones ────────────────────────────────────────────────────────────────────

/**
 * Fetch all zones ordered alphabetically, with a count of child areas.
 */
export async function getZones(): Promise<Zone[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("zones")
    .select("id, name, created_at, areas(count)")
    .order("name", { ascending: true });

  if (error) {
    console.error("[getZones]", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    // Supabase returns count as [{count: N}] when using aggregate
    area_count: (row.areas?.[0]?.count ?? 0) as number,
  }));
}

/**
 * Create a new zone.
 */
export async function createZone(
  name: string
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();

  const trimmed = name?.trim();
  if (!trimmed) return { success: false, error: "Zone name is required." };
  if (trimmed.length > 100)
    return { success: false, error: "Zone name must be 100 characters or fewer." };

  const { data, error } = await supabase
    .from("zones")
    .insert({ name: trimmed })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation
    if (error.code === "23505") {
      return { success: false, error: `Zone "${trimmed}" already exists.` };
    }
    console.error("[createZone]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true, data: { id: (data as any).id } };
}

/**
 * Rename an existing zone.
 */
export async function updateZone(
  id: string,
  name: string
): Promise<ActionResult> {
  const supabase = createClient();

  const trimmed = name?.trim();
  if (!trimmed) return { success: false, error: "Zone name is required." };
  if (trimmed.length > 100)
    return { success: false, error: "Zone name must be 100 characters or fewer." };

  const { error } = await supabase
    .from("zones")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: `Zone "${trimmed}" already exists.` };
    }
    console.error("[updateZone]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true };
}

/**
 * Delete a zone — only allowed when it has NO child areas.
 * The DB has ON DELETE RESTRICT on areas.zone_id, so this is a belt-and-
 * braces check to provide a friendly error rather than a cryptic DB error.
 */
export async function deleteZone(id: string): Promise<ActionResult> {
  const supabase = createClient();

  // Check for child areas
  const { count, error: countError } = await supabase
    .from("areas")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", id);

  if (countError) {
    console.error("[deleteZone] count error", countError.message);
    return { success: false, error: countError.message };
  }

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: "Cannot delete a zone that has areas. Remove all areas first.",
    };
  }

  const { error } = await supabase.from("zones").delete().eq("id", id);

  if (error) {
    console.error("[deleteZone]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true };
}

// ─── Areas ────────────────────────────────────────────────────────────────────

/**
 * Fetch all areas for a given zone, ordered alphabetically.
 */
export async function getAreas(zoneId: string): Promise<Area[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("areas")
    .select("id, name, zone_id, created_at")
    .eq("zone_id", zoneId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[getAreas]", error.message);
    return [];
  }

  return (data ?? []) as Area[];
}

/**
 * Create a new area within a zone.
 */
export async function createArea(
  zoneId: string,
  name: string
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();

  const trimmed = name?.trim();
  if (!trimmed) return { success: false, error: "Area name is required." };
  if (!zoneId) return { success: false, error: "Zone ID is required." };
  if (trimmed.length > 100)
    return { success: false, error: "Area name must be 100 characters or fewer." };

  // Check uniqueness within zone
  const { count } = await supabase
    .from("areas")
    .select("*", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .ilike("name", trimmed);

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: `Area "${trimmed}" already exists in this zone.`,
    };
  }

  const { data, error } = await supabase
    .from("areas")
    .insert({ name: trimmed, zone_id: zoneId })
    .select("id")
    .single();

  if (error) {
    console.error("[createArea]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true, data: { id: (data as any).id } };
}

/**
 * Rename an existing area.
 */
export async function updateArea(
  id: string,
  name: string
): Promise<ActionResult> {
  const supabase = createClient();

  const trimmed = name?.trim();
  if (!trimmed) return { success: false, error: "Area name is required." };
  if (trimmed.length > 100)
    return { success: false, error: "Area name must be 100 characters or fewer." };

  const { error } = await supabase
    .from("areas")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) {
    console.error("[updateArea]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true };
}

/**
 * Delete an area — blocked if any profiles reference this area.
 */
export async function deleteArea(id: string): Promise<ActionResult> {
  const supabase = createClient();

  // Check if any profiles reference this area
  const { count, error: countError } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("area_id", id);

  if (countError) {
    console.error("[deleteArea] count error", countError.message);
    return { success: false, error: countError.message };
  }

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error:
        "Cannot delete an area that is assigned to users. Reassign users first.",
    };
  }

  const { error } = await supabase.from("areas").delete().eq("id", id);

  if (error) {
    console.error("[deleteArea]", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/master");
  return { success: true };
}
