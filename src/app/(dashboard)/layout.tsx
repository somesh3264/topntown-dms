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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Persistent sidebar — hidden on mobile, visible md+ */}
      <DashboardSidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardTopbar displayName={displayName} />

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
