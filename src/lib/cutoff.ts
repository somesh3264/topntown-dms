// src/lib/cutoff.ts
// ---------------------------------------------------------------------------
// Order cut-off logic for Top N Town DMS.
//
// The cut-off is controlled by two rows in `system_config`:
//   key = 'cut_off_time'     value: "HH:MM" 24-hour IST (e.g. "14:00")
//   key = 'cut_off_enabled'  value: "true" | "false"  master switch
//
// When cut_off_enabled is "false" (or missing), isCutoffPassed() always
// returns passed=false so the order window is effectively open 24×7. This
// is how Super Admins pause enforcement — e.g. for testing or during an
// event — without rewriting the cut-off time.
//
// All comparisons are in IST (Asia/Kolkata, UTC+5:30).
//
// Usage (Server Component / Route Handler):
//   import { isCutoffPassed } from "@/lib/cutoff";
//   const result = await isCutoffPassed();
//   if (result.passed) { /* reject order */ }
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CutoffStatus {
  /** True if the daily order cut-off time has already passed for today. */
  passed: boolean;
  /**
   * Whether cut-off enforcement is currently turned on.
   * When false, `passed` is always false regardless of current time.
   */
  enabled: boolean;
  /** The configured cut-off time, e.g. "14:00". */
  cutoffTime: string;
  /**
   * Minutes remaining until cut-off.
   * Negative when cut-off has already passed (|value| = minutes elapsed).
   * When enforcement is disabled this is always 0 — callers should
   * key off `enabled` first.
   */
  remainingMinutes: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CUTOFF_TIME = "14:00"; // fallback if DB row is missing
const IST_OFFSET_MINUTES = 5 * 60 + 30; // 330 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the current date-time in IST as a Date object.
 * We shift the UTC epoch value by the IST offset so that
 * .getUTCHours() / .getUTCMinutes() give the IST wall-clock time.
 */
function nowInIST(): Date {
  const utcMs = Date.now();
  return new Date(utcMs + IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Parses a "HH:MM" string into { hours, minutes }.
 * Returns DEFAULT_CUTOFF_TIME's parsed values on invalid input.
 */
function parseHHMM(timeStr: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr?.trim() ?? "");
  if (!match) {
    console.warn(`[cutoff] Invalid cut_off_time value "${timeStr}", using default.`);
    return parseHHMM(DEFAULT_CUTOFF_TIME);
  }
  return { hours: parseInt(match[1], 10), minutes: parseInt(match[2], 10) };
}

/**
 * Reads a single string value from system_config for a given key.
 * Returns null if the row is missing or the read errored.
 */
async function readConfig(key: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error(`[cutoff] Failed to read system_config["${key}"]:`, error.message);
    return null;
  }
  // `value` is stored as text; trim defensive whitespace.
  return ((data as { value: string } | null)?.value ?? "").trim() || null;
}

/** Coerce "true"/"false"/"1"/"0"/"yes"/"no" into a boolean. */
function parseBoolFlag(raw: string | null, defaultValue: boolean): boolean {
  if (raw == null) return defaultValue;
  const v = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return defaultValue;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * isCutoffPassed()
 *
 * Reads `cut_off_time` and `cut_off_enabled` from the system_config table
 * and compares against the current IST time.
 *
 * - If `cut_off_enabled` is "false" → returns passed=false, enabled=false.
 * - Otherwise behaves as before: passed=true once IST time ≥ cut_off_time.
 *
 * Uses the service-role client so RLS policies do not block the read;
 * this function must only be called from trusted server-side code.
 */
export async function isCutoffPassed(): Promise<CutoffStatus> {
  const [rawCutoffTime, rawEnabled] = await Promise.all([
    readConfig("cut_off_time"),
    readConfig("cut_off_enabled"),
  ]);

  const cutoffTimeStr: string = rawCutoffTime || DEFAULT_CUTOFF_TIME;

  // Default to DISABLED when the flag row is missing — safer during rollout
  // of this new feature since the migration pre-seeds it explicitly.
  const enabled = parseBoolFlag(rawEnabled, false);

  if (!enabled) {
    return {
      passed: false,
      enabled: false,
      cutoffTime: cutoffTimeStr,
      remainingMinutes: 0,
    };
  }

  // ── Enabled path — evaluate against IST clock ────────────────────────────
  const { hours: cutoffH, minutes: cutoffM } = parseHHMM(cutoffTimeStr);

  const istNow = nowInIST();
  const currentH = istNow.getUTCHours();
  const currentM = istNow.getUTCMinutes();

  // Convert both to total minutes from midnight for easy comparison
  const cutoffTotalMinutes = cutoffH * 60 + cutoffM;
  const currentTotalMinutes = currentH * 60 + currentM;

  const remainingMinutes = cutoffTotalMinutes - currentTotalMinutes;
  const passed = remainingMinutes <= 0;

  return {
    passed,
    enabled: true,
    cutoffTime: cutoffTimeStr,
    remainingMinutes,
  };
}
