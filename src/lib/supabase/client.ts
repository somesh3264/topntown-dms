// src/lib/supabase/client.ts
// ---------------------------------------------------------------------------
// Browser-side Supabase client — safe to import in Client Components.
// Uses @supabase/ssr createBrowserClient which handles cookie-based auth
// automatically (no deprecated @supabase/auth-helpers-nextjs).
// ---------------------------------------------------------------------------

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

/**
 * Returns a Supabase client configured for use in the browser.
 *
 * Usage (Client Component):
 * ```tsx
 * "use client";
 * import { createClient } from "@/lib/supabase/client";
 *
 * const supabase = createClient();
 * const { data } = await supabase.from("orders").select("*");
 * ```
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
