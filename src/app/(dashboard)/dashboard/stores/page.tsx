// src/app/(dashboard)/stores/page.tsx
// ---------------------------------------------------------------------------
// Store Directory — Server Component.
//
// Role-scoped data fetching (RLS handles the actual row-level access):
//   SA  → all stores
//   SS  → stores in their distributor network
//   SP  → stores in their assigned area
//   Distributor → stores they are primary_distributor for
//
// Passes data to the interactive StoreDirectoryClient.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { Store } from "lucide-react";
import {
  getStores,
  getZonesForSelect,
  getMyProfile,
} from "./actions";
import { StoreDirectoryClient } from "./_components/StoreDirectoryClient";

export const metadata: Metadata = { title: "Store Directory" };
export const dynamic = "force-dynamic";

export default async function StoresPage() {
  // Pending count is derived client-side from the store list — getStores now
  // returns approval_status with each row, so a separate count fetch isn't
  // needed for the page itself. The sidebar still does its own count via the
  // dashboard layout to keep that lookup independent of this page's data.
  const [profile, stores, zones] = await Promise.all([
    getMyProfile(),
    getStores(),
    getZonesForSelect(),
  ]);

  const callerRole = profile?.role ?? "sales_person";

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Store className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Store Directory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage and onboard retail stores across all areas.
          </p>
        </div>
      </div>

      {/* ── Interactive Directory ────────────────────────────────────────────── */}
      <StoreDirectoryClient
        initialStores={stores}
        zones={zones}
        callerRole={callerRole}
      />
    </div>
  );
}
