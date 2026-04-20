// src/components/ui/sidebar-nav.tsx
// ---------------------------------------------------------------------------
// Reusable sidebar navigation component — warm dark theme with section groups.
//
// • Client Component — needs usePathname for active-route highlighting.
// • Role-conditional: only items matching the current UserRole are rendered.
// • Mobile-responsive: sits behind a translucent overlay and slides in/out.
//   The parent (DashboardShell) owns the open/close state and passes it down.
// • Section groups: items are grouped under labelled sections (OVERVIEW,
//   OPERATIONS, FINANCE, SYSTEM) matching the TopNTown DMS design system.
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
  CreditCard,
  Truck,
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
  /** Section this item belongs to. */
  section: string;
}

/**
 * Ordered list of all possible sidebar items with section grouping.
 * Items are filtered by role at render time.
 */
const NAV_ITEMS: NavItem[] = [
  // ── OVERVIEW ──────────────────────────────────────────────────────────────
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["super_admin", "super_stockist", "sales_person"],
    section: "OVERVIEW",
  },

  // ── OPERATIONS ────────────────────────────────────────────────────────────
  {
    href: "/dashboard/products",
    label: "Products & Pricing",
    icon: Package,
    roles: ["super_admin"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/master/category-mapping",
    label: "Category Mapping",
    icon: GitBranch,
    roles: ["super_admin"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/master",
    label: "Zones & Areas",
    icon: MapPin,
    roles: ["super_admin"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/users",
    label: "Users & Network",
    icon: Users,
    roles: ["super_admin"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/network",
    label: "My Network",
    icon: Network,
    roles: ["super_stockist"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/stores",
    label: "Retail Stores",
    icon: Store,
    roles: ["super_admin", "super_stockist", "sales_person"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/orders",
    label: "Orders & Billing",
    icon: ShoppingCart,
    roles: ["super_admin", "super_stockist"],
    section: "OPERATIONS",
  },
  {
    href: "/dashboard/dispatch",
    label: "Dispatch",
    icon: Truck,
    // Dispatch Manager's single screen; Super Admin sees it too for fallback.
    roles: ["super_admin", "dispatch_manager"],
    section: "OPERATIONS",
  },

  // ── FINANCE ───────────────────────────────────────────────────────────────
  {
    href: "/dashboard/pricing",
    label: "Payments",
    icon: CreditCard,
    roles: ["super_admin"],
    section: "FINANCE",
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    icon: BarChart3,
    roles: ["super_admin", "super_stockist", "sales_person"],
    section: "FINANCE",
  },

  // ── SYSTEM ────────────────────────────────────────────────────────────────
  {
    href: "/dashboard/system",
    label: "Configuration",
    icon: Settings2,
    roles: ["super_admin"],
    section: "SYSTEM",
  },
];

/** Ordered list of section labels for consistent rendering order. */
const SECTION_ORDER = ["OVERVIEW", "OPERATIONS", "FINANCE", "SYSTEM"];

// ─── Role label map ───────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  sales_person: "Sales Person",
  distributor: "Distributor",
  dispatch_manager: "Dispatch Manager",
};

// ─── Role initials + color ───────────────────────────────────────────────────

const ROLE_AVATARS: Record<string, { initials: string; bg: string }> = {
  super_admin: { initials: "SA", bg: "bg-emerald-700" },
  super_stockist: { initials: "SS", bg: "bg-amber-700" },
  sales_person: { initials: "SP", bg: "bg-sky-700" },
  distributor: { initials: "D", bg: "bg-violet-700" },
  dispatch_manager: { initials: "DM", bg: "bg-rose-700" },
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SidebarNavProps {
  role: UserRole;
  displayName?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SidebarNav({
  role,
  displayName,
  mobileOpen = false,
  onMobileClose,
}: SidebarNavProps) {
  const pathname = usePathname();

  // Filter items by role
  const visibleItems = NAV_ITEMS.filter((item) =>
    (item.roles as string[]).includes(role)
  );

  // Group visible items by section, preserving order
  const sections = SECTION_ORDER.map((sectionLabel) => ({
    label: sectionLabel,
    items: visibleItems.filter((item) => item.section === sectionLabel),
  })).filter((section) => section.items.length > 0);

  // Exact match for Dashboard root; prefix match for all other routes
  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  const avatar = ROLE_AVATARS[role] ?? { initials: "U", bg: "bg-stone-600" };

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
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col",
          "bg-sidebar text-sidebar-foreground",
          "transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-label="Sidebar navigation"
      >
        {/* ── Brand header ─────────────────────────────────────────────── */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-5">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-foreground">
            Distribution{" "}
            <span className="text-sidebar-foreground/60">·</span>{" "}
            DMS
          </span>

          {/* Close button — visible on mobile only */}
          <button
            className="ml-2 rounded-md p-1 text-sidebar-foreground hover:bg-sidebar-active hover:text-sidebar-active-foreground md:hidden"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Navigation list with sections ─────────────────────────────── */}
        <nav
          className="flex-1 overflow-y-auto px-3 py-4"
          aria-label="Main navigation"
        >
          {sections.map((section, sectionIdx) => (
            <div key={section.label} className={cn(sectionIdx > 0 && "mt-6")}>
              {/* Section header */}
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-sidebar-section">
                {section.label}
              </p>

              <ul className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={onMobileClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-sidebar-active text-sidebar-active-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── User footer ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Avatar circle */}
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                avatar.bg
              )}
            >
              {avatar.initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-active-foreground">
                {ROLE_LABELS[role] ?? role}
              </p>
              {displayName && (
                <p className="truncate text-[11px] text-sidebar-foreground/80">
                  {displayName}
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
