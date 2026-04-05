// src/middleware.ts
// ---------------------------------------------------------------------------
// Next.js Middleware — runs on the Edge Runtime before every matched request.
//
// Responsibilities:
//   1. Refresh Supabase auth session cookies (required by @supabase/ssr).
//   2. Enforce role-based route protection without hitting the DB on every
//      request — the "user_role" cookie is written at login time and trusted
//      here for the fast-path check.
//   3. Handle impersonation mode: when a Super Admin sets the
//      "impersonating_role" + "impersonating_user_id" cookies, those values
//      are forwarded as request headers so Server Components can adapt their
//      data queries without additional DB round-trips in the middleware.
//   4. Guard edge cases: expired session → /login, missing profile → /login.
//
// MATCHER CONFIG EXPLANATION (see bottom of file):
//   The matcher is a single negative-lookahead regex that excludes:
//     - _next/static   → compiled JS / CSS bundles (no auth needed)
//     - _next/image    → Next.js image optimisation proxy
//     - favicon.ico    → browser favicon request
//     - api/           → API route handlers manage their own auth
//     - sw.js          → next-pwa service worker
//     - workbox-*      → next-pwa Workbox runtime chunks
//     - manifest.json  → PWA web-app manifest
//     - icons/         → PWA icon assets in /public
//   Every other path — including /login, /dashboard/*, /app/* — is matched
//   so the middleware can redirect, protect, or pass through as needed.
// ---------------------------------------------------------------------------

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All roles that exist in the system.
 * "super_stockist" is stored in the user_role cookie as written at login.
 * It maps to "sales_supervisor" in older DB enum migrations — whichever
 * string the login action writes to the cookie is what the middleware reads.
 */
export type UserRole =
  | "super_admin"
  | "super_stockist" // stored as "sales_supervisor" in the DB enum
  | "sales_person"
  | "distributor";

// ---------------------------------------------------------------------------
// Route protection table
// ---------------------------------------------------------------------------
// Rules are evaluated top-to-bottom; the FIRST match wins.
// Place more specific paths (e.g. /dashboard/admin) before broader siblings.

const ROUTE_RULES: Array<{
  pattern: RegExp;
  allowedRoles: readonly UserRole[];
}> = [
  // /dashboard/admin/* — Super Admin only
  {
    pattern: /^\/dashboard\/admin(\/.*)?$/,
    allowedRoles: ["super_admin"] as const,
  },
  // /dashboard/ss/* — Super Stockist only
  {
    pattern: /^\/dashboard\/ss(\/.*)?$/,
    allowedRoles: ["super_stockist"] as const,
  },
  // /dashboard/* (general) — all staff roles
  {
    pattern: /^\/dashboard(\/.*)?$/,
    allowedRoles: ["super_admin", "super_stockist", "sales_person"] as const,
  },
  // /app/* — Distributor portal
  {
    pattern: /^\/app(\/.*)?$/,
    allowedRoles: ["distributor"] as const,
  },
];

/** Default landing path for each role after login or visiting "/". */
const ROLE_HOME: Record<UserRole, string> = {
  super_admin: "/dashboard",
  super_stockist: "/dashboard",
  sales_person: "/dashboard",
  distributor: "/app",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function redirectToLogin(
  request: NextRequest,
  reason?: string
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  // Preserve the intended destination so the login page can redirect back.
  url.searchParams.set("next", request.nextUrl.pathname);
  if (reason) url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

function redirectToHome(
  request: NextRequest,
  role: UserRole
): NextResponse {
  const home = ROLE_HOME[role] ?? "/dashboard";
  return NextResponse.redirect(new URL(home, request.url));
}

// ---------------------------------------------------------------------------
// Middleware entry point
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. Bootstrap Supabase SSR client ──────────────────────────────────────
  // `response` is reassigned inside setAll() so refreshed auth cookies are
  // attached to the outgoing response — this is the pattern @supabase/ssr
  // requires. Do NOT destructure response before setAll() runs.
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Apply to request first so downstream middleware sees the update.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Rebuild response so Set-Cookie headers reach the browser.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // ── 2. Validate session ────────────────────────────────────────────────────
  // IMPORTANT: No code between createServerClient() and getUser().
  // Any interleaved await can allow a stale/tampered token to slip through.
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  // ── 3. Read role + impersonation cookies ───────────────────────────────────
  //
  // "user_role" cookie
  //   Set by the login Server Action / Route Handler immediately after
  //   a successful Supabase sign-in. Reading it here avoids a DB round-trip
  //   on every request; the Supabase session check above still validates the
  //   JWT so the cookie alone is never the sole auth gate.
  //
  // "impersonating_role" / "impersonating_user_id" cookies
  //   Set via POST /api/impersonation/start (Super Admin only).
  //   Cleared via POST /api/impersonation/exit.
  //   Both actions log to the audit_logs table in their respective handlers.

  const realRole = request.cookies.get("user_role")?.value as
    | UserRole
    | undefined;

  const impersonatingRole = request.cookies.get("impersonating_role")
    ?.value as UserRole | undefined;
  const impersonatingUserId =
    request.cookies.get("impersonating_user_id")?.value;

  // Effective role drives the UX experience (nav, data queries) but access
  // control always checks the *real* role — Super Admins are never locked out
  // of admin routes while impersonating a lower-privileged user.
  const effectiveRole: UserRole | undefined =
    impersonatingRole && realRole === "super_admin"
      ? impersonatingRole
      : realRole;

  // ── 4. /login — bounce authenticated users to their home ──────────────────
  if (pathname === "/login") {
    if (user && !sessionError && realRole) {
      return redirectToHome(request, realRole);
    }
    // Unauthenticated or error — show the login page and pass through.
    return response;
  }

  // ── 5. "/" — root redirect based on role ──────────────────────────────────
  if (pathname === "/") {
    if (!user || sessionError) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (!realRole) {
      // Authenticated but user_role cookie missing — profile not created yet.
      return NextResponse.redirect(
        new URL("/login?error=missing_profile", request.url)
      );
    }
    return redirectToHome(request, realRole);
  }

  // ── 6. Protected route evaluation ─────────────────────────────────────────
  const matchedRule = ROUTE_RULES.find(({ pattern }) =>
    pattern.test(pathname)
  );

  if (matchedRule) {
    // 6a. Session must be valid
    if (!user || sessionError) {
      return redirectToLogin(request, "session_expired");
    }

    // 6b. user_role cookie must be present (edge case: cleared after login)
    if (!realRole) {
      return redirectToLogin(request, "missing_profile");
    }

    // 6c. Role-based access — always the real role, never the impersonated one.
    //     This prevents privilege escalation via cookie manipulation.
    if (!(matchedRule.allowedRoles as readonly string[]).includes(realRole)) {
      return redirectToHome(request, realRole);
    }
  }

  // ── 7. Forward context as request headers for Server Components ───────────
  // Layouts and pages read these via `headers()` from next/headers to avoid
  // a second Supabase call.  During impersonation, data-layer utilities should
  // use x-impersonating-user-id instead of x-user-id for their queries.

  if (user) {
    response.headers.set("x-user-id", user.id);
  }
  if (realRole) {
    response.headers.set("x-user-role", realRole);
  }
  if (effectiveRole) {
    response.headers.set("x-effective-role", effectiveRole);
  }
  if (impersonatingRole && impersonatingUserId && realRole === "super_admin") {
    response.headers.set("x-impersonating-role", impersonatingRole);
    response.headers.set("x-impersonating-user-id", impersonatingUserId);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Matcher config
// ---------------------------------------------------------------------------
// The regex uses a negative lookahead (?!...) to skip paths that never need
// auth processing, keeping the Edge function fast:
//
//   _next/static   → compiled JS / CSS bundles served directly by the CDN
//   _next/image    → Next.js built-in image optimisation endpoint
//   favicon.ico    → browser icon — no session required
//   api/           → Route Handlers carry their own Supabase auth guards
//   sw\\.js        → next-pwa service worker (must be publicly accessible)
//   workbox-.*     → Workbox runtime chunks emitted by next-pwa
//   manifest\\.json→ PWA web-app manifest (public)
//   icons/         → PWA icon assets served from /public/icons/
//
// Every other path is matched, including /login, /dashboard/*, and /app/*.
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/|sw\\.js|workbox-.*|manifest\\.json|icons/).*)",
  ],
};
