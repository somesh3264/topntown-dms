// src/app/(dashboard)/dashboard/system/page.tsx
// ---------------------------------------------------------------------------
// System Settings (Super Admin only).
//
// Exposes the global controls that drive order cut-off enforcement:
//   • Enable / disable the cut-off (master switch)
//   • Cut-off time (HH:MM IST)
//   • Support contact shown when cut-off is active and passed
//
// Access is enforced at two layers:
//   1. The dashboard layout / middleware already require an authenticated
//      user with a dashboard-eligible role.
//   2. updateSystemSettings() re-checks super_admin on the server before
//      writing — see actions.ts::assertSuperAdmin.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";

import { getSystemSettings } from "./actions";
import SystemSettingsForm from "./_components/SystemSettingsForm";

export const metadata: Metadata = { title: "System Settings" };

// Always fetch fresh — settings mutations happen infrequently but must
// be reflected immediately across all sessions.
export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const initial = await getSystemSettings();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">System Settings</h1>
        <p className="text-sm text-muted-foreground">
          Global configuration for order cut-off enforcement and distributor
          support. Changes apply immediately to all users.
        </p>
      </header>

      <section
        aria-labelledby="cutoff-heading"
        className="space-y-3"
      >
        <h2
          id="cutoff-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Order cut-off
        </h2>
        <SystemSettingsForm initial={initial} />
      </section>
    </div>
  );
}
