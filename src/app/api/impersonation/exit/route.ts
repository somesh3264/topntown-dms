// src/app/api/impersonation/exit/route.ts
// ---------------------------------------------------------------------------
// POST /api/impersonation/exit
//
// Called by ExitImpersonationButton when the Super Admin stops impersonating.
//
// Steps:
//   1. Verify the caller has an active Supabase session and is a super_admin.
//   2. Read the impersonation cookies to capture the audit payload.
//   3. Clear both impersonation cookies from the response.
//   4. Write an "impersonation_end" event to audit_logs.
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

export async function POST(request: NextRequest) {
  const cookieStore = cookies();

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  // ── Auth guard ─────────────────────────────────────────────────────────────
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!user || error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRoleCookie = cookieStore.get("user_role")?.value;
  if (userRoleCookie !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Capture impersonation context before clearing ──────────────────────────
  const impersonatedRole = cookieStore.get("impersonating_role")?.value;
  const impersonatedUserId = cookieStore.get("impersonating_user_id")?.value;

  if (!impersonatedRole || !impersonatedUserId) {
    // Already exited — treat as success (idempotent).
    return NextResponse.json({ ok: true });
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  // Non-fatal — if the insert fails we still clear the cookies so the SA
  // isn't stuck in impersonation mode.
  try {
    await supabase.from("audit_logs").insert({
      actor_id: user.id,
      action: "impersonation_end",
      target_user_id: impersonatedUserId,
      metadata: {
        impersonated_role: impersonatedRole,
        ended_at: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.error("[impersonation/exit] Failed to write audit log:", auditErr);
  }

  // ── Clear impersonation cookies ────────────────────────────────────────────
  const response = NextResponse.json({ ok: true });

  const cookieDefaults = {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0, // expire immediately
  };

  response.cookies.set("impersonating_role", "", cookieDefaults);
  response.cookies.set("impersonating_user_id", "", cookieDefaults);

  return response;
}
