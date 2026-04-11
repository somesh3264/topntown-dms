// src/lib/supabase/middleware.ts
// ---------------------------------------------------------------------------
// Helper that creates a Supabase client inside Next.js Middleware.
// Middleware runs in the Edge Runtime — it cannot use next/headers,
// so cookies are threaded through the NextRequest / NextResponse objects
// directly.
// ---------------------------------------------------------------------------

import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

/**
 * Creates a Supabase client scoped to the current middleware request and
 * returns { supabase, response } so the caller can both query Supabase and
 * forward the mutated response (with refreshed auth cookies) to the browser.
 *
 * Usage (src/middleware.ts):
 * ```ts
 * import { updateSession } from "@/lib/supabase/middleware";
 *
 * export async function middleware(request: NextRequest) {
 *   return await updateSession(request);
 * }
 * ```
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Write cookies onto both the request (for downstream middleware)
          // and the response (so they reach the browser).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Never run code between createServerClient and
  // supabase.auth.getUser() — a stale session could slip through.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // -------------------------------------------------------------------------
  // Route protection rules
  // -------------------------------------------------------------------------

  const { pathname } = request.nextUrl;

  // Public paths — always allow through
  const isPublicPath =
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/favicon.ico";

  if (!user && !isPublicPath) {
    // Unauthenticated — redirect to login preserving the intended destination
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Return supabaseResponse so refreshed auth cookies are forwarded.
  return supabaseResponse;
}
