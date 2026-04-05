"use client";
// src/components/orders/CutoffCountdown.tsx
// ---------------------------------------------------------------------------
// Client component — shows a live countdown to the daily order cut-off.
//
// Props:
//   cutoffTime     — "HH:MM" in IST, e.g. "14:00"  (passed from Server Component)
//   contactNumber  — tel: link destination, e.g. "+91-9876543210"
//   onCutoffReached? — optional callback fired once when the countdown hits 0
//
// Behaviour:
//   • Displays "Order closes in HH:MM:SS" while the window is open.
//   • Ticks every second using setInterval.
//   • When the countdown reaches 0:
//       — Hides the form area (passes `isClosed` down via the render prop / slot).
//       — Shows "Order cut-off has passed. Call [number] to order." with a
//         tappable tel: link.
//
// Usage (inside a Server Component page):
//   <CutoffCountdown cutoffTime="14:00" contactNumber="+91-9876543210">
//     {(isClosed) =>
//       isClosed ? null : <OrderForm />
//     }
//   </CutoffCountdown>
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Phone } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CutoffCountdownProps {
  /** Cut-off time string in HH:MM (IST 24-hour). */
  cutoffTime: string;
  /** Phone number shown / linked when cut-off passes. e.g. "+91-9876543210" */
  contactNumber: string;
  /**
   * Render prop pattern — children receives `isClosed: boolean` so the parent
   * can hide the order form once the window closes.
   */
  children?: (isClosed: boolean) => ReactNode;
  /** Optional callback invoked exactly once when the countdown reaches 0. */
  onCutoffReached?: () => void;
}

interface TimeRemaining {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
}

// ─── IST helpers ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function nowInISTComponents(): { h: number; m: number; s: number } {
  const istDate = new Date(Date.now() + IST_OFFSET_MS);
  return {
    h: istDate.getUTCHours(),
    m: istDate.getUTCMinutes(),
    s: istDate.getUTCSeconds(),
  };
}

function parseHHMM(timeStr: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr?.trim() ?? "");
  if (!match) return { h: 14, m: 0 }; // safe default
  return { h: parseInt(match[1], 10), m: parseInt(match[2], 10) };
}

function computeRemaining(cutoffTime: string): TimeRemaining {
  const { h: ch, m: cm } = parseHHMM(cutoffTime);
  const now = nowInISTComponents();

  const cutoffTotalS = ch * 3600 + cm * 60;
  const nowTotalS = now.h * 3600 + now.m * 60 + now.s;
  const diffS = cutoffTotalS - nowTotalS;

  if (diffS <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 };
  }

  return {
    hours: Math.floor(diffS / 3600),
    minutes: Math.floor((diffS % 3600) / 60),
    seconds: diffS % 60,
    totalSeconds: diffS,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CutoffCountdown({
  cutoffTime,
  contactNumber,
  children,
  onCutoffReached,
}: CutoffCountdownProps) {
  const [remaining, setRemaining] = useState<TimeRemaining>(() =>
    computeRemaining(cutoffTime)
  );
  const [firedCallback, setFiredCallback] = useState(false);

  const isClosed = remaining.totalSeconds === 0;

  const tick = useCallback(() => {
    const next = computeRemaining(cutoffTime);
    setRemaining(next);

    if (next.totalSeconds === 0 && !firedCallback) {
      setFiredCallback(true);
      onCutoffReached?.();
    }
  }, [cutoffTime, firedCallback, onCutoffReached]);

  useEffect(() => {
    // Don't start interval if already past cut-off on mount
    if (remaining.totalSeconds === 0) return;

    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [tick, remaining.totalSeconds]);

  // ── Pad helper ──────────────────────────────────────────────────────────────
  const pad = (n: number) => String(n).padStart(2, "0");

  // ── Past cut-off view ───────────────────────────────────────────────────────
  if (isClosed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-6 py-5 text-center">
        <p className="text-sm font-medium text-orange-800">
          Order cut-off has passed for today.
        </p>
        <p className="text-sm text-orange-700">
          Call us to place your order:
        </p>
        <a
          href={`tel:${contactNumber.replace(/\s/g, "")}`}
          className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 active:scale-95"
        >
          <Phone className="h-4 w-4" />
          {contactNumber}
        </a>
        {/* Render children with isClosed = true so the form can unmount */}
        {children?.(true)}
      </div>
    );
  }

  // ── Countdown view ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Countdown banner */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-2.5"
      >
        <span className="text-sm text-green-800">Order closes in</span>
        <span
          className={[
            "font-mono text-lg font-bold tabular-nums",
            remaining.hours === 0 && remaining.minutes < 30
              ? "text-orange-600" // warn when < 30 min remaining
              : "text-green-700",
          ].join(" ")}
        >
          {pad(remaining.hours)}:{pad(remaining.minutes)}:{pad(remaining.seconds)}
        </span>
      </div>

      {/* Children — the order form — while window is still open */}
      {children?.(false)}
    </div>
  );
}

export default CutoffCountdown;
