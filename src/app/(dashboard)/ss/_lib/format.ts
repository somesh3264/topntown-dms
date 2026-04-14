// src/app/(dashboard)/ss/_lib/format.ts
// ---------------------------------------------------------------------------
// Small formatting helpers shared by SS pages. All IST-aware.
// ---------------------------------------------------------------------------

export function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatIstDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatIstDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Returns YYYY-MM-DD strings for the default billing / payment date window. */
export function defaultDateRange(daysBack = 30): { from: string; to: string } {
  const today = new Date();
  const to = today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const back = new Date(today.getTime() - daysBack * 86_400_000);
  const from = back.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return { from, to };
}

/** ISO bounds for a [from, to] window interpreted in IST (inclusive). */
export function istDayBounds(from: string, to: string): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(`${from}T00:00:00+05:30`).toISOString(),
    toIso: new Date(`${to}T23:59:59.999+05:30`).toISOString(),
  };
}
