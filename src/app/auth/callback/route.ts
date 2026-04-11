// src/app/auth/callback/route.ts
// ---------------------------------------------------------------------------
// Supabase Auth callback handler.
//
// Called by Supabase after:
//   • OAuth sign-in (Google, GitHub, …)
//   • Magic-link / email confirmation clicks
//   • Password-reset confirmation links
//
// The handler exchanges the one-time `code` query param for a server-side
// session and then redirects the user to either their intended destination
// (the `next` param) or the appropriate home screen based on their role.
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROLE_REDIRECT, type UserRole } from "@/app/(auth)/login/constants";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  // `next` is an optional redirect hint (e.g. /dashboard/orders)
  const next = searchParams.get("next") ?? null;

  // If there is no code param Supabase has nothing to exchange — bail out.
  if (!code) {
    console.error("[auth/callback] Missing `code` query parameter.");
    return NextResponse.redirect(
      new URL("/login?error=missing_code", origin)
    );
  }

  const supabase = createClient();

  // Exchange the one-time code for a session (sets auth cookies via the
  // SSR cookie helper in src/lib/supabase/server.ts).
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("[auth/callback] Code exchange failed:", error?.message);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "auth_error")}`, origin)
    );
  }

  // ── Determine redirect destination ────────────────────────────────────
  // 1. Honour an explicit `next` param if provided (and it's a relative URL)
  if (next && next.startsWith("/")) {
    return NextResponse.redirect(new URL(next, origin));
  }

  // 2. Look up the user's role and redirect to their home screen
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const role = profile?.role as UserRole | undefined;
  const destination = role ? ROLE_REDIRECT[role] : "/dashboard";

  return NextResponse.redirect(new URL(destination, origin));
}
