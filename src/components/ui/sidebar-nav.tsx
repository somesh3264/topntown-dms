// src/components/ui/sidebar-nav.tsx
// ---------------------------------------------------------------------------
// Reusable sidebar navigation component.
//
// • Client Component — needs usePathname for active-route highlighting.
// • Role-conditional: only items matching the current UserRole are rendered.
// • Mobile-responsive: sits behind a translucent overlay and slides in/out.
//   The parent (DashboardShell) owns the open/close state and passes it down.
//
// Role → nav item mapping:
//   super_admin    → Dashboard, Products, Pricing, Zones & Areas, Users,
//                    Stores, Orders, Reports, System Config
//   super_stockist → Dashboard, My Network, Stores, Orders, Reports
//   sales_person   → Dashboard, Stores, Reports
// ---------------------------------------------------------------------------

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Tag,
  MapPin,
  Users,
  Store,
  ShoppingCart,
  BarChart3,
  Settings2,
  Network,
  X,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/middleware";

// ─── Nav item catalog ─────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Roles that can see this item. */
  roles: UserRole[];
}

/**
 * Ordered list of all possible sidebar items.
 * Items are filtered by role at render time.
 * Place role-specific items between the shared Dashboard and Reports entries.
 */
const NAV_ITEMS: NavItem[] = [
  // ── Shared across all internal roles ──────────────────────────────────────
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["super_admin", "super_stockist", "sales_person"],
  },

  // ── Super Admin only ───────────────────────────────────────────────────────
  {
    href: "/dashboard/products",
    label: "Products",
    icon: Package,
    roles: ["super_admin"],
  },
  {
    href: "/dashboard/master/category-mapping",
    label: "Category Mapping",
    icon: GitBranch,
    roles: ["super_admin"],
  },
  {
    href: "/dashboard/pricing",
    label: "Pricing",
    icon: Tag,
    roles: ["super_admin"],
  },
  {
    href: "/dashboard/master",
    label: "Zones & Areas",
    icon: MapPin,
    roles: ["super_admin"],
  },
  {
    href: "/dashboard/users",
    label: "Users",
    icon: Users,
    roles: ["super_admin"],
  },

  // ── Super Stockist only ────────────────────────────────────────────────────
  {
    href: "/dashboard/network",
    label: "My Network",
    icon: Network,
    roles: ["super_stockist"],
  },

  // ── SA + SS + SP ──────────────────────────────────────────────────────────
  {
    href: "/dashboard/stores",
    label: "Stores",
    icon: Store,
    roles: ["super_admin", "super_stockist", "sales_person"],
  },

  // ── SA + SS ───────────────────────────────────────────────────────────────
  {
    href: "/dashboard/orders",
    label: "Orders",
    icon: ShoppingCart,
    roles: ["super_admin", "super_stockist"],
  },

  // ── Shared ────────────────────────────────────────────────────────────────
  {
    href: "/dashboard/reports",
    label: "Reports",
    icon: BarChart3,
    roles: ["super_admin", "super_stockist", "sales_person"],
  },

  // ── Super Admin only (bottom) ──────────────────────────────────────────────
  {
    href: "/dashboard/system",
    label: "System Config",
    icon: Settings2,
    roles: ["super_admin"],
  },
];

// ─── Role label map ───────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  sales_person: "Sales Person",
  distributor: "Distributor",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SidebarNavProps {
  /**
   * Effective role — may differ from real role during impersonation.
   * Passed from the Server Component layout, never read client-side.
   */
  role: UserRole;
  /**
   * Controls the mobile slide-in drawer. Ignored on ≥ md viewports where
   * the sidebar is always visible.
   */
  mobileOpen?: boolean;
  /** Called when the user taps the backdrop or the close (X) button. */
  onMobileClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SidebarNav({
  role,
  mobileOpen = false,
  onMobileClose,
}: SidebarNavProps) {
  const pathname = usePathname();

  // Only render items the current role is allowed to see
  const visibleItems = NAV_ITEMS.filter((item) =>
    (item.roles as string[]).includes(role)
  );

  // Exact match for Dashboard root; prefix match for all other routes
  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  return (
    <>
      {/* ── Mobile semi-transparent backdrop ─────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar panel ────────────────────────────────────────────────── */}
      <aside
        className={cn(
          // On mobile: fixed, slides in/out; on desktop: static, always visible
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-card",
          "transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-label="Sidebar navigation"
      >
        {/* ── Brand header ─────────────────────────────────────────────── */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-5">
          <span className="text-base font-bold tracking-tight">
            <span className="text-brand-700">TopN</span>
            <span className="text-foreground">Town</span>
            <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-brand-700">
              DMS
            </span>
          </span>

          {/* Close button — visible on mobile only */}
          <button
            className="ml-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Navigation list ───────────────────────────────────────────── */}
        <nav
          className="flex-1 overflow-y-auto px-3 py-3"
          aria-label="Main navigation"
        >
          <ul className="space-y-0.5">
            {visibleItems.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onMobileClose} // close mobile drawer after navigation
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── Role badge footer ─────────────────────────────────────────── */}
        <div className="shrink-0 border-t px-5 py-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Signed in as
          </p>
          <p className="mt-0.5 text-xs font-semibold text-foreground">
            {ROLE_LABELS[role] ?? role}
          </p>
        </div>
      </aside>
    </>
  );
}
