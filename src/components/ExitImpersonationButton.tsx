"use client";
// src/components/ExitImpersonationButton.tsx
// ---------------------------------------------------------------------------
// Client Component — the "Exit Impersonation" button rendered inside the
// ImpersonationBanner Server Component.
//
// On click:
//   1. POSTs to /api/impersonation/exit which:
//        a. Clears the impersonating_role + impersonating_user_id cookies.
//        b. Writes an "impersonation_end" row to audit_logs.
//   2. Hard-navigates to /dashboard so the Super Admin's own session is fully
//      restored without any stale client-side state.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ExitImpersonationButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleExit() {
    setLoading(true);
    try {
      await fetch("/api/impersonation/exit", { method: "POST" });
    } catch {
      // Best-effort — even on network error, navigate away so the cookies
      // can be cleared on the server on next load.
    } finally {
      // Full navigation resets all client state (React Query cache, Zustand
      // stores, etc.) so no impersonated data leaks back into the SA view.
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleExit}
      disabled={loading}
      className="
        shrink-0
        rounded-md
        bg-white text-red-700
        px-3 py-1
        text-xs font-bold
        hover:bg-red-50
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-white
        disabled:opacity-60 disabled:cursor-not-allowed
        transition-colors
      "
    >
      {loading ? "Exiting…" : "Exit Impersonation"}
    </button>
  );
}
