// src/app/(app)/_components/HomeLiveBlock.tsx
// ---------------------------------------------------------------------------
// Client-side header that renders two things that depend on "now":
//   1. A time-based greeting (Good morning / afternoon / evening — IST).
//   2. The cut-off countdown card.
//
// Both tick forward without needing a page refresh — the countdown updates
// every 30 seconds, and the greeting re-evaluates on each tick. We cap updates
// at 30s to avoid unnecessary re-renders (1s would be overkill for an
// "Xh Ym" display).
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";

interface HomeLiveBlockProps {
  fullName: string;
  cutoffTime: string;     // "HH:MM" — e.g. "14:00"
  cutoffEnabled: boolean; // if false, we hide the countdown entirely
}

/** Returns the current moment in IST as a Date (UTC timestamps under the hood). */
function nowInIST(): Date {
  // Convert the current UTC time to IST by adjusting by +05:30.
  const nowUtc = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(nowUtc.getTime() + istOffsetMs - nowUtc.getTimezoneOffset() * 60_000);
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  return "Good evening,";
}

function formatCutoff12h(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return hhmm;
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${mm.toString().padStart(2, "0")} ${suffix}`;
}

/** Returns ms until the next cut-off. Negative if already passed. */
function msUntilCutoff(cutoffTime: string): number {
  const [hh, mm] = cutoffTime.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  const ist = nowInIST();
  const target = new Date(ist);
  target.setHours(hh, mm, 0, 0);
  // If today's cut-off has already passed, the "next cut-off" is tomorrow's.
  if (target.getTime() <= ist.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - ist.getTime();
}

function formatHoursMinutes(ms: number): string {
  if (ms <= 0) return "0h 0m";
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

export default function HomeLiveBlock({
  fullName,
  cutoffTime,
  cutoffEnabled,
}: HomeLiveBlockProps) {
  // Re-render every 30s so the countdown + greeting stay fresh without
  // over-taxing React. useState holds a tick counter; content is derived.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const ist = nowInIST();
  const greeting = greetingFor(ist.getHours());
  const msLeft = msUntilCutoff(cutoffTime);
  const passed = msLeft <= 0;

  return (
    <>
      {/* Greeting + Name */}
      <div className="mb-4 px-1 pt-2">
        <p className="text-sm text-muted-foreground">{greeting}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{fullName}</h1>
      </div>

      {/* Cut-off countdown card */}
      {cutoffEnabled && (
        <div className="mb-5 flex items-center justify-between rounded-2xl bg-brand-700 px-5 py-4 text-white shadow-sm">
          <div>
            <p className="text-xs text-white/80">
              {passed ? "Order cut-off" : "Order cut-off in"}
            </p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">
              {passed ? "Closed" : formatHoursMinutes(msLeft)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/80">Cut-off</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">
              {formatCutoff12h(cutoffTime)}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
