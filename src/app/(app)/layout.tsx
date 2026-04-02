// src/app/(app)/layout.tsx
// ---------------------------------------------------------------------------
// Distributor mobile PWA layout.
// Optimised for small screens: bottom tab bar, full-height content area,
// and a compact topbar.  next-pwa pre-caches routes under /app/*.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppBottomNav from "./_components/AppBottomNav";
import AppTopbar from "./_components/AppTopbar";

export const metadata: Metadata = {
  title: {
    default: "My Account",
    template: "%s | TopNTown",
  },
  // PWA display mode — set in public/manifest.json
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // TODO: verify role === "distributor" — redirect internal users to /dashboard
  const displayName = user.email ?? "Distributor";

  return (
    // Safe area insets ensure content clears iPhone notch / home indicator
    <div className="flex h-[100dvh] flex-col bg-background">
      <AppTopbar displayName={displayName} />

      {/* Scrollable page content — padding-bottom accounts for bottom nav */}
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>

      <AppBottomNav />
    </div>
  );
}
