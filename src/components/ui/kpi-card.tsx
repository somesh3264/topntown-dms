// src/components/ui/kpi-card.tsx
// ---------------------------------------------------------------------------
// Reusable KPI card with optional trend indicator + a loading skeleton.
// Self-contained — no external shadcn dependency (skeleton is inlined).
// ---------------------------------------------------------------------------

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Inline pulse skeleton (avoids depending on an optional shadcn component) ─

function Pulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface KpiTrend {
  /**
   * Visual direction of the indicator:
   *   "up"      → emerald TrendingUp arrow (positive change)
   *   "down"    → red TrendingDown arrow  (negative change)
   *   "neutral" → muted dash icon
   */
  direction: "up" | "down" | "neutral";
  /** Primary trend label, e.g. "+12.5%" or "3 pending". */
  label: string;
  /** Optional softer qualifier, e.g. "vs yesterday". */
  qualifier?: string;
}

export interface KpiCardProps {
  /** Metric name shown above the value. */
  title: string;
  /** Formatted value string, e.g. "142" or "₹4.2L". */
  value: string | number;
  /** Optional trend row rendered below the value. */
  trend?: KpiTrend;
  /** Small Lucide icon placed in the top-right corner. */
  icon?: React.ReactNode;
  className?: string;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm space-y-3",
        className
      )}
      aria-label="Loading metric…"
    >
      <div className="flex items-center justify-between">
        <Pulse className="h-3.5 w-28" />
        <Pulse className="h-4 w-4 rounded-full" />
      </div>
      <Pulse className="h-8 w-24" />
      <Pulse className="h-3 w-20" />
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

export function KpiCard({ title, value, trend, icon, className }: KpiCardProps) {
  const TrendIcon =
    trend?.direction === "up"
      ? TrendingUp
      : trend?.direction === "down"
      ? TrendingDown
      : Minus;

  const trendColour =
    trend?.direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : trend?.direction === "down"
      ? "text-red-500 dark:text-red-400"
      : "text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      {/* ── Header row ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {icon && (
          <span className="text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      {/* ── Primary value ─────────────────────────────────────────────────── */}
      <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
        {value}
      </p>

      {/* ── Trend row ─────────────────────────────────────────────────────── */}
      {trend && (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1 text-xs",
            trendColour
          )}
        >
          <TrendIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium">{trend.label}</span>
          {trend.qualifier && (
            <span className="text-muted-foreground">{trend.qualifier}</span>
          )}
        </p>
      )}
    </div>
  );
}
