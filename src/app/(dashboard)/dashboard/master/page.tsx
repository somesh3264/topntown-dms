// src/app/(dashboard)/master/page.tsx
// ---------------------------------------------------------------------------
// Zone & Area Management — Super Admin split-panel view.
//
// Server Component: fetches all zones (with area counts) server-side, then
// delegates all interactive state (selection, inline editing, add/delete) to
// ZoneAreaClient — a Client Component.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { getZones } from "./actions";
import { ZoneAreaClient } from "./_components/ZoneAreaClient";

export const metadata: Metadata = { title: "Zone & Area Management" };
export const dynamic = "force-dynamic";

export default async function MasterPage() {
  const zones = await getZones();

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <MapPin className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Zone &amp; Area Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage geographic zones and their sub-areas. Click any name to edit inline.
          </p>
        </div>
      </div>

      {/* ── Split-panel client ───────────────────────────────────────────────── */}
      <ZoneAreaClient initialZones={zones} />
    </div>
  );
}
