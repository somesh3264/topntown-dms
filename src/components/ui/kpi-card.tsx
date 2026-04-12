// src/components/ui/kpi-card.tsx
// ---------------------------------------------------------------------------
// Reusable KPI card with coloured icon circle + trend badge.
// Matches the TopNTown DMS warm dashboard design system.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";

// ─── Inline pulse skeleton ──────────────────────────────────────────────────

function Pulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface KpiTrend {
  /**
   * Visual direction of the indicator:
   *   "up"      → green badge  (positive change)
   *   "down"    → red badge    (negative change)
   *   "neutral" → muted badge
   */
  direction: "up" | "down" | "neutral";
  /** Primary trend label, e.g. "+12.5%" or "3 pending". */
  label: string;
}

export interface KpiCardProps {
  /** Metric name shown below the value. */
  title: string;
  /** Formatted value string, e.g. "142" or "₹4.2L". */
  value: string | number;
  /** Subtitle line below the title. */
  subtitle?: string;
  /** Optional trend badge rendered in the top-right corner. */
  trend?: KpiTrend;
  /** Icon element — rendered inside a coloured circle. */
  icon?: React.ReactNode;
  /** Background class for the icon circle, e.g. "bg-amber-100". */
  iconBg?: string;
  /** Text colour class for the icon, e.g. "text-amber-700". */
  iconColor?: string;
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
      <div className="flex items-start justify-between">
        <Pulse className="h-10 w-10 rounded-full" />
        <Pulse className="h-5 w-20 rounded-full" />
      </div>
      <Pulse className="h-8 w-24" />
      <Pulse className="h-3 w-32" />
      <Pulse className="h-3 w-20" />
    </div>
  );
}

// ─── Trend badge colours ─────────────────────────────────────────────────────

const TREND_STYLES: Record<
  "up" | "down" | "neutral",
  string
> = {
  up: "bg-emerald-50 text-emerald-700 border-emerald-200",
  down: "bg-red-50 text-red-700 border-red-200",
  neutral: "bg-stone-100 text-stone-600 border-stone-200",
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  iconBg = "bg-stone-100",
  iconColor = "text-stone-600",
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      {/* ── Top row: icon circle + trend badge ────────────────────────────── */}
      <div className="flex items-start justify-between">
        {/* Coloured icon circle */}
        {icon && (
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              iconBg,
              iconColor
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}

        {/* Trend badge */}
        {trend && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              TREND_STYLES[trend.direction]
            )}
          >
            {trend.label}
          </span>
        )}
      </div>

      {/* ── Primary value ─────────────────────────────────────────────────── */}
      <p className="mt-4 text-3xl font-bold tracking-tight text-foreground">
        {value}
      </p>

      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <p className="mt-1 text-sm font-medium text-muted-foreground">{title}</p>

      {/* ── Subtitle ──────────────────────────────────────────────────────── */}
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted-foreground/70">{subtitle}</p>
      )}
    </div>
  );
}
