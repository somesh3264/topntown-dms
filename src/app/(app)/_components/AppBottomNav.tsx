// src/app/(app)/_components/AppBottomNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, Crosshair, CreditCard, Package } from "lucide-react";

// Five-tab distributor nav: Home · Order · Deliver · Pay · Stock.
// Profile removed — all identity info lives on the Home header.
const tabs = [
  { href: "/app",         label: "Home",    icon: Home },
  { href: "/app/order",   label: "Order",   icon: ClipboardList },
  { href: "/app/deliver", label: "Deliver", icon: Crosshair },
  { href: "/app/pay",     label: "Pay",     icon: CreditCard },
  { href: "/app/stock",   label: "Stock",   icon: Package },
];

export default function AppBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t bg-card/95 backdrop-blur-sm safe-pb">
      <ul className="flex h-16 items-center justify-around px-2">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/app" ? pathname === "/app" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
