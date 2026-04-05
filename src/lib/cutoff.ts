// src/lib/cutoff.ts
// ---------------------------------------------------------------------------
// Order cut-off logic for Top N Town DMS.
//
// The cut-off time is stored in system_config with key = 'cut_off_time'
// as a 24-hour "HH:MM" string (e.g. "14:00").
//
// All comparisons are done in IST (Asia/Kolkata, UTC+5:30).
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
  /** The configured cut-off time, e.g. "14:00". */
  cutoffTime: string;
  /**
   * Minutes remaining until cut-off.
   * Negative when cut-off has already passed (|value| = minutes elapsed).
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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * isCutoffPassed()
 *
 * Reads `cut_off_time` from the system_config table and compares it
 * against the current IST time.
 *
 * Uses the service-role client so RLS policies do not block the read;
 * this function must only be called from trusted server-side code.
 */
export async function isCutoffPassed(): Promise<CutoffStatus> {
  const supabase = createAdminClient();

  // ── Fetch configured cut-off time ─────────────────────────────────────────
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", "cut_off_time")
    .single();

  if (error) {
    console.error("[isCutoffPassed] Failed to read cut_off_time:", error.message);
  }

  const cutoffTimeStr: string = data?.value?.trim() || DEFAULT_CUTOFF_TIME;
  const { hours: cutoffH, minutes: cutoffM } = parseHHMM(cutoffTimeStr);

  // ── Current IST time ───────────────────────────────────────────────────────
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
    cutoffTime: cutoffTimeStr,
    remainingMinutes,
  };
}
