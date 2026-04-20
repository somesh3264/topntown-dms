// src/app/(dashboard)/dashboard/system/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for the System Settings page (Super Admin only).
//
// Manages the three system_config rows that drive order cut-off enforcement:
//   cut_off_time     — "HH:MM" IST, when the daily window closes
//   cut_off_enabled  — "true" | "false", master on/off switch
//   support_contact  — phone number shown to distributors post cut-off
//
// All mutations require the caller to be `super_admin`.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SystemSettings {
  /** "HH:MM" 24-hour IST, e.g. "14:00". */
  cutoffTime: string;
  /** Master toggle for cut-off enforcement. */
  cutoffEnabled: boolean;
  /** Phone number shown when the cut-off window is closed. */
  supportContact: string;
}

interface ActionResult {
  success: boolean;
  error?: string;
}

// ─── Defaults (used only if the config row is missing) ────────────────────────

const DEFAULTS: SystemSettings = {
  cutoffTime: "14:00",
  cutoffEnabled: false,
  supportContact: "+91-9999999999",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Throws unless the current session user has role=super_admin. */
async function assertSuperAdmin(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthenticated.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile as { role: string }).role !== "super_admin") {
    throw new Error("Only Super Admin can change system settings.");
  }

  return user.id;
}

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function isValidHHMM(s: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Basic phone validation — permissive on purpose. We allow country code,
 * spaces, dashes, parentheses, and a leading "+", but require at least 8
 * digits so we don't accept clearly broken values.
 */
function isValidPhone(s: string): boolean {
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * getSystemSettings()
 *
 * Reads all three cut-off-related keys from system_config and returns a
 * normalised SystemSettings object. Uses the admin client so RLS does not
 * interfere with the read (the Settings page is already guarded by the
 * dashboard layout + middleware).
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("system_config")
    .select("key, value")
    .in("key", ["cut_off_time", "cut_off_enabled", "support_contact"]);

  if (error) {
    console.error("[getSystemSettings]", error.message);
    return DEFAULTS;
  }

  const map = new Map<string, string>(
    (data ?? []).map((row: any) => [row.key as string, (row.value as string) ?? ""])
  );

  return {
    cutoffTime: map.get("cut_off_time")?.trim() || DEFAULTS.cutoffTime,
    cutoffEnabled: parseBool(map.get("cut_off_enabled"), DEFAULTS.cutoffEnabled),
    supportContact: map.get("support_contact")?.trim() || DEFAULTS.supportContact,
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * updateSystemSettings(formData)
 *
 * Validates the three fields and upserts them to system_config.
 * Only callable by super_admin.
 *
 * FormData keys:
 *   cut_off_time      string "HH:MM"
 *   cut_off_enabled   "on" | undefined  (HTML checkbox semantics)
 *   support_contact   string
 */
export async function updateSystemSettings(
  formData: FormData
): Promise<ActionResult> {
  try {
    await assertSuperAdmin();
  } catch (err: any) {
    return { success: false, error: err.message ?? "Unauthorized." };
  }

  const cutoffTimeRaw = (formData.get("cut_off_time") as string | null) ?? "";
  // The custom Switch (src/components/ui/switch.tsx) always submits either
  // "on" or "off" via its hidden input — a plain HTML <input type="checkbox">
  // would submit "on" when checked and nothing at all when unchecked, so we
  // handle both conventions here.
  const enabledRaw =
    ((formData.get("cut_off_enabled") as string | null) ?? "").trim().toLowerCase();
  const supportContactRaw =
    (formData.get("support_contact") as string | null) ?? "";

  // ── Validate ──────────────────────────────────────────────────────────────
  const cutoffTime = cutoffTimeRaw.trim();
  const supportContact = supportContactRaw.trim();
  const cutoffEnabled = ["on", "true", "1", "yes"].includes(enabledRaw);

  if (!isValidHHMM(cutoffTime)) {
    return {
      success: false,
      error: "Cut-off time must be in HH:MM 24-hour format (e.g. 14:00).",
    };
  }
  if (!isValidPhone(supportContact)) {
    return {
      success: false,
      error: "Support contact must be a valid phone number.",
    };
  }

  // ── Upsert all three keys in a single round-trip ─────────────────────────
  const admin = createAdminClient();

  // NOTE: We deliberately upsert only the two canonical columns (key, value).
  // The optional audit columns (updated_at, updated_by) are populated server-
  // side — updated_at by the trigger added in
  // 20260418_system_config_cutoff_controls.sql, and updated_by is intentionally
  // not required so this action works even against older system_config tables
  // that pre-date that migration.
  const rows = [
    { key: "cut_off_time", value: cutoffTime },
    { key: "cut_off_enabled", value: cutoffEnabled ? "true" : "false" },
    { key: "support_contact", value: supportContact },
  ];

  const { error } = await admin
    .from("system_config")
    .upsert(rows as any, { onConflict: "key" });

  if (error) {
    console.error("[updateSystemSettings] upsert failed:", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/system");
  return { success: true };
}
