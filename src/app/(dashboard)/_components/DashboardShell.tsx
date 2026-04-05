// src/app/(dashboard)/_components/DashboardShell.tsx
// ---------------------------------------------------------------------------
// Client Component — owns the mobile sidebar open/close state so the parent
// DashboardLayout (Server Component) can remain a pure Server Component while
// still passing server-fetched props (role, displayName) down to here.
//
// Renders:
//   • SidebarNav (240 px, collapsible on mobile via slide-in drawer)
//   • Top header bar with: hamburger (mobile), logo fallback, page title slot,
//     role badge, user name, logout button
//   • Main content area (<main>) that receives {children}
// ---------------------------------------------------------------------------

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, LogOut, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import type { UserRole } from "@/middleware";

// ─── Role display labels ──────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  sales_person: "Sales Person",
  distributor: "Distributor",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardShellProps {
  role: UserRole;
  displayName: string;
  children: React.ReactNode;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function DashboardShell({
  role,
  displayName,
  children,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const roleLabel = ROLE_LABELS[role] ?? role.replace(/_/g, " ");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar (240 px) ───────────────────────────────────────────────── */}
      <SidebarNav
        role={role}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* ── Right column ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top header bar ──────────────────────────────────────────────── */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 md:px-6">
          {/* Left: hamburger (mobile only) + logo text fallback */}
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/*
              On mobile the sidebar is hidden — show a compact logo so the
              header has a recognisable brand mark.  Hidden on md+ where the
              sidebar already displays the full brand.
            */}
            <span className="font-bold text-sm text-brand-700 md:hidden">
              TopNTown DMS
            </span>
          </div>

          {/* Right: role badge + user name + sign-out */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Role badge */}
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary sm:inline">
              {roleLabel}
            </span>

            {/* User name with icon */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden max-w-[160px] truncate sm:inline">
                {displayName}
              </span>
            </div>

            {/* Sign-out button */}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* ── Page content ────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
