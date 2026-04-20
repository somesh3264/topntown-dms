// src/app/(app)/_components/KpiTile.tsx
// ---------------------------------------------------------------------------
// Reusable 2x2-grid tile used on the distributor Home screen.
// Visual:
//   ┌──────────────────────┐
//   │  [icon]              │
//   │                      │
//   │   3                  │   <- value (big, bold)
//   │   Deliveries         │   <- label (muted)
//   └──────────────────────┘
// ---------------------------------------------------------------------------

import type { LucideIcon } from "lucide-react";

interface KpiTileProps {
  icon: LucideIcon;
  value: string;
  label: string;
  /** Background tint for the icon chip. Tailwind classes, e.g. "bg-emerald-50". */
  iconBg?: string;
  /** Foreground tint for the icon itself. Tailwind, e.g. "text-emerald-700". */
  iconFg?: string;
}

export default function KpiTile({
  icon: Icon,
  value,
  label,
  iconBg = "bg-stone-100",
  iconFg = "text-stone-700",
}: KpiTileProps) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div
        className={`mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}
      >
        <Icon className={`h-5 w-5 ${iconFg}`} aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
