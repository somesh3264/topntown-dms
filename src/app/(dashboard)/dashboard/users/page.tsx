// src/app/(dashboard)/users/page.tsx
// ---------------------------------------------------------------------------
// User Management page — Server Component.
//
// Fetches all users + zone/area lookup data server-side, passes to the
// interactive UsersClient.  Super Admin only (enforced by middleware).
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { Users } from "lucide-react";
import { getUsers, getZonesForSelect } from "./actions";
import { UsersClient } from "./_components/UsersClient";

export const metadata: Metadata = { title: "User Management" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [users, zones] = await Promise.all([
    getUsers(),
    getZonesForSelect(),
  ]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create, manage, and impersonate users across all roles.
          </p>
        </div>
      </div>

      {/* ── Interactive table ────────────────────────────────────────────────── */}
      <UsersClient initialUsers={users} zones={zones} />
    </div>
  );
}
