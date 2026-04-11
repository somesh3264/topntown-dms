// src/lib/supabase/server.ts
// ---------------------------------------------------------------------------
// Server-side Supabase client — for use in Server Components, Route Handlers,
// and Server Actions.  Uses @supabase/ssr createServerClient with the
// next/headers cookies() API so auth tokens are propagated correctly.
// ---------------------------------------------------------------------------

import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Returns a Supabase client configured for server-side rendering.
 * Must be called inside an async Server Component, Route Handler, or
 * Server Action — anywhere `next/headers` cookies() is available.
 *
 * Usage (Server Component):
 * ```tsx
 * import { createClient } from "@/lib/supabase/server";
 *
 * export default async function Page() {
 *   const supabase = createClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 *   ...
 * }
 * ```
 */
export function createClient(): SupabaseClient<Database> {
  const cookieStore = cookies();

  // Cast to SupabaseClient<Database> (1-param form) to work around a type-
  // parameter position mismatch between @supabase/ssr@0.5.x and
  // @supabase/supabase-js ≥2.60.  The 3-param SupabaseClient<D,S,Schema>
  // used by createServerClient maps Schema to position-3 (SchemaName) in the
  // newer 5-param SupabaseClient class, collapsing Schema to `never`.
  // Using the 1-param form lets TypeScript derive all defaults correctly.
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  ) as unknown as SupabaseClient<Database>;
}
