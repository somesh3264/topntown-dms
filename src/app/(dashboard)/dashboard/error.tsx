// src/app/(dashboard)/error.tsx
// ---------------------------------------------------------------------------
// Error boundary for the dashboard route group.
// Next.js App Router requires this to be a Client Component.
// Without this file, any Server Component error in /dashboard/* shows a
// blank white page instead of a useful message.
// ---------------------------------------------------------------------------

"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error so it appears in the terminal / browser console
    console.error("[Dashboard Error]", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Something went wrong
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
