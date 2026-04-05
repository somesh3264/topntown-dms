// src/components/ImpersonationBanner.tsx
// ---------------------------------------------------------------------------
// Server Component — reads impersonation cookies set by Super Admin and
// renders a persistent red warning banner at the top of every page.
//
// Renders null (nothing) when no impersonation is active, so it is safe to
// include in the root layout unconditionally.
//
// Usage (app/layout.tsx or any shell layout):
//   import ImpersonationBanner from "@/components/ImpersonationBanner";
//   ...
//   <ImpersonationBanner />
//   {children}
//
// Architecture note:
//   This file is a Server Component.  The interactive "Exit Impersonation"
//   button lives in ExitImpersonationButton (a Client Component) and is
//   imported here.  Next.js allows Server Components to import Client
//   Components — the reverse is not true.
// ---------------------------------------------------------------------------

import { cookies } from "next/headers";
import type { UserRole } from "@/middleware";
import ExitImpersonationButton from "./ExitImpersonationButton";

/** Human-readable label for each role value. */
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  sales_person: "Sales Person",
  distributor: "Distributor",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ").toUpperCase();
}

export default function ImpersonationBanner() {
  const cookieStore = cookies();

  const impersonatingRole = cookieStore.get("impersonating_role")
    ?.value as UserRole | undefined;
  const impersonatingUserId = cookieStore.get("impersonating_user_id")?.value;

  // Nothing to show — not in impersonation mode.
  if (!impersonatingRole || !impersonatingUserId) {
    return null;
  }

  const roleLabel = formatRole(impersonatingRole);

  return (
    /**
     * The banner is fixed to the top of the viewport so it is always visible
     * regardless of scroll position.  z-[9999] ensures it sits above modals,
     * drawers, and Radix overlays.
     *
     * If your root layout already has a <header> or <nav>, add
     * `mt-[theme(spacing.banner)]` (or equivalent) to the sibling container
     * so page content is not hidden beneath the banner.
     */
    <div
      role="alert"
      aria-live="polite"
      className="
        fixed top-0 inset-x-0 z-[9999]
        flex items-center justify-between gap-4
        bg-red-600 text-white
        px-4 py-2
        text-sm font-semibold
        shadow-md
      "
    >
      {/* Left: warning icon + impersonation context */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Inline SVG so no external dependency is required */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
            clipRule="evenodd"
          />
        </svg>

        <span className="truncate">
          IMPERSONATING{" "}
          <span className="underline underline-offset-2">{roleLabel}</span>
          {" · "}
          <span className="font-mono text-red-100 text-xs">
            {impersonatingUserId}
          </span>
        </span>
      </div>

      {/* Right: exit button (Client Component) */}
      <ExitImpersonationButton />
    </div>
  );
}
