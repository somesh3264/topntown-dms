// src/app/(dashboard)/_components/DashboardShell.tsx
// ---------------------------------------------------------------------------
// Client Component — owns the mobile sidebar open/close state so the parent
// DashboardLayout (Server Component) can remain a pure Server Component while
// still passing server-fetched props (role, displayName) down to here.
//
// Renders:
//   - SidebarNav (240 px, collapsible on mobile via slide-in drawer)
//   - Top header bar with: breadcrumb, date/cutoff, search bar, notification
//   - Main content area (<main>) that receives {children}
// ---------------------------------------------------------------------------

"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, LogOut, Search, Bell, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import type { UserRole } from "@/middleware";

// ─── Role display labels ──────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  sales_person: "Sales Person",
  distributor: "Distributor",
  dispatch_manager: "Dispatch Manager",
};

// ─── Breadcrumb helper ───────────────────────────────────────────────────────

function getBreadcrumb(pathname: string): string {
  const segments = pathname.replace("/dashboard", "").split("/").filter(Boolean);
  if (segments.length === 0) return "DMS \u2192 Dashboard";
  const last = segments[segments.length - 1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `DMS \u2192 ${last}`;
}

// ─── Date formatter ──────────────────────────────────────────────────────────

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
  const pathname = usePathname();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const roleLabel = ROLE_LABELS[role] ?? role.replace(/_/g, " ");
  const breadcrumb = getBreadcrumb(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar (240 px) ───────────────────────────────────────────────── */}
      <SidebarNav
        role={role}
        displayName={displayName}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* ── Right column ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top header bar ──────────────────────────────────────────────── */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 md:px-6">
          {/* Left: hamburger (mobile only) + breadcrumb */}
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Mobile logo fallback */}
            <span className="font-semibold text-xs uppercase tracking-wider text-brand-700 md:hidden">
              TopNTown DMS
            </span>

            {/* Breadcrumb — desktop */}
            <span className="hidden text-sm text-muted-foreground md:inline">
              {breadcrumb}
            </span>
          </div>

          {/* Right: date + search + actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Date & cutoff — hidden on small screens */}
            <div className="hidden text-right text-xs text-muted-foreground lg:block">
              <p className="font-medium text-foreground/80">{formatCurrentDate()}</p>
              <p>Cut-off: 2:00 PM IST</p>
            </div>

            {/* Search bar */}
            <div className="hidden items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm text-muted-foreground sm:flex">
              <Search className="h-3.5 w-3.5" />
              <input
                type="text"
                placeholder="Search..."
                className="w-28 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 lg:w-40"
              />
            </div>

            {/* Notification bell */}
            <button
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>

            {/* User avatar + sign out (desktop) */}
            <div className="hidden items-center gap-2 border-l pl-3 sm:flex">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden max-w-[120px] truncate lg:inline">
                  {displayName}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {/* ── Page content ────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
