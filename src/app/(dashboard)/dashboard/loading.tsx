// src/app/(dashboard)/loading.tsx
// Shown by Next.js while the dashboard Server Component is fetching data.
// Replaces the blank white flash between navigation events.

export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
