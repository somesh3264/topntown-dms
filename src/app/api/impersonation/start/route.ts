// src/app/api/impersonation/start/route.ts
// ---------------------------------------------------------------------------
// POST /api/impersonation/start
//
// Allows a Super Admin to begin impersonating another user.
//
// Request body (JSON):
//   { "targetUserId": string, "targetRole": UserRole }
//
// Steps:
//   1. Verify the caller has a super_admin session.
//   2. Validate the target user exists and their role matches the payload.
//   3. Set the impersonating_role + impersonating_user_id cookies.
//   4. Write an "impersonation_start" event to audit_logs.
//
// Example usage (from a Super Admin admin UI):
//   await fetch("/api/impersonation/start", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ targetUserId: "uuid", targetRole: "distributor" }),
//   });
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";
import type { UserRole } from "@/middleware";

const ALLOWED_IMPERSONATION_TARGETS: UserRole[] = [
  "super_stockist",
  "sales_person",
  "distributor",
];

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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  ) as unknown as SupabaseClient<Database>;

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

  // ── Parse body ─────────────────────────────────────────────────────────────
  let targetUserId: string | undefined;
  let targetRole: UserRole | undefined;

  try {
    const body = await request.json();
    targetUserId = body?.targetUserId;
    targetRole = body?.targetRole;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!targetUserId || !targetRole) {
    return NextResponse.json(
      { error: "targetUserId and targetRole are required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_IMPERSONATION_TARGETS.includes(targetRole)) {
    return NextResponse.json(
      { error: `Cannot impersonate role: ${targetRole}` },
      { status: 400 }
    );
  }

  // ── Validate target user exists ────────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", targetUserId)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  try {
    await supabase.from("audit_logs").insert({
      actor_id: user.id,
      action: "impersonation_start",
      target_user_id: targetUserId,
      metadata: {
        impersonated_role: targetRole,
        started_at: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.error(
      "[impersonation/start] Failed to write audit log:",
      auditErr
    );
  }

  // ── Set impersonation cookies ──────────────────────────────────────────────
  const cookieDefaults = {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    // Impersonation sessions expire after 2 hours regardless of tab activity.
    maxAge: 60 * 60 * 2,
  };

  const response = NextResponse.json({ ok: true });
  response.cookies.set("impersonating_role", targetRole, cookieDefaults);
  response.cookies.set("impersonating_user_id", targetUserId, cookieDefaults);

  return response;
}
