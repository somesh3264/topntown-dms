// src/app/(dashboard)/layout.tsx
// ---------------------------------------------------------------------------
// Dashboard layout — Server Component.
//
// Responsibilities:
//   1. Auth guard — redirect to /login if no active session.
//   2. Role resolution — reads x-effective-role header written by middleware
//      (respects impersonation context) with a cookie fallback.
//   3. Profile fetch — single-row query for the user's full_name.
//   4. ImpersonationBanner — rendered outside the flex shell so its
//      position:fixed anchors to the viewport (not a clipping ancestor).
//   5. DashboardShell — Client Component that owns mobile sidebar state
//      and renders the header bar + SidebarNav + main content area.
//
// Why a Client Component shell?
//   The mobile hamburger menu requires useState/onClick, which cannot exist
//   in a Server Component.  We extract just the interactive wrapper into
//   DashboardShell while keeping *this* file server-only so it can read
//   cookies, headers, and call Supabase without a client round-trip.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/middleware";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { DashboardShell } from "./_components/DashboardShell";

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s | TopNTown DMS",
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();

  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  // Middleware handles the edge-runtime fast path; this is a belt-and-braces
  // guard inside the RSC render.  getUser() validates the JWT with Supabase —
  // it is NOT safe to skip this and rely on the cookie alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ── 2. Effective role ──────────────────────────────────────────────────────
  // Prefer the x-effective-role header set by middleware.  During impersonation
  // this reflects the impersonated role so the sidebar renders the correct nav
  // items.  Fall back to the user_role cookie for resilience.
  const reqHeaders = headers();
  const cookieStore = cookies();

  const effectiveRole =
    (reqHeaders.get("x-effective-role") as UserRole | null) ??
    (cookieStore.get("user_role")?.value as UserRole | undefined) ??
    null;

  if (!effectiveRole) {
    // Authenticated but role not set — profile was never created.
    redirect("/login?error=missing_profile");
  }

  // ── 3. Profile fetch ───────────────────────────────────────────────────────
  // Single lightweight row — full_name for the header user display.
  // Errors are swallowed gracefully; we fall back to the user's email.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const displayName = profile?.full_name ?? user.email ?? "User";

  // ── 4. Pending-approval count for the sidebar badge (SA only) ─────────────
  // We compute this once per layout render so every dashboard page shows the
  // current count without each page having to refetch. Counted via head:true
  // (no row payload, just the count) to keep the query cheap.
  let pendingApprovalCount = 0;
  if (effectiveRole === "super_admin") {
    const { count } = await supabase
      .from("store_approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingApprovalCount = count ?? 0;
  }

  // ── 5. Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/*
        ImpersonationBanner — position:fixed, z-[9999].
        Must be rendered OUTSIDE the h-screen overflow-hidden container below
        so the fixed positioning is relative to the viewport rather than to
        the nearest scroll ancestor.
      */}
      <ImpersonationBanner />

      {/*
        DashboardShell — Client Component.
        Receives server-fetched data as plain props and owns the mobile
        sidebar open/close state.
      */}
      <DashboardShell
        role={effectiveRole}
        displayName={displayName}
        pendingApprovalCount={pendingApprovalCount}
      >
        {children}
      </DashboardShell>
    </>
  );
}
