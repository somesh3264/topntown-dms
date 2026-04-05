// src/app/(dashboard)/layout.tsx
// ---------------------------------------------------------------------------
// Shared layout for internal users: Super Admin, Sales Supervisor (SS),
// and Sales Person.  Server Component — reads the current user from Supabase
// and renders a sidebar + topbar shell.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardSidebar from "./_components/DashboardSidebar";
import DashboardTopbar from "./_components/DashboardTopbar";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s | Dashboard — TopNTown DMS",
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware handles most redirects but this is a belt-and-braces guard.
  if (!user) {
    redirect("/login");
  }

  // TODO: fetch user profile + role from `public.profiles` table.
  const displayName = user.email ?? "User";

  return (
    <>
      {/*
        ImpersonationBanner — Server Component.
        Reads the "impersonating_role" + "impersonating_user_id" cookies and
        renders a fixed red banner at the very top of the viewport (z-[9999])
        when a Super Admin is in impersonation mode.  Returns null otherwise,
        so it is zero-cost for all non-impersonation requests.

        It must sit OUTSIDE the h-screen container below so its `position:fixed`
        anchors to the viewport rather than to a clipping ancestor.
      */}
      <ImpersonationBanner />

      <div className="flex h-screen overflow-hidden bg-background">
        {/* Persistent sidebar — hidden on mobile, visible md+ */}
        <DashboardSidebar />

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <DashboardTopbar displayName={displayName} />

          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </>
  );
}
