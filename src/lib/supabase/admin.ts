// src/lib/supabase/admin.ts
// ---------------------------------------------------------------------------
// Service-role Supabase client — for use ONLY in trusted server-side code
// (Server Actions, Route Handlers) that need elevated privileges, such as
// creating auth users via supabase.auth.admin.*.
//
// ⚠️  NEVER import this in Client Components or expose the service role key
//     to the browser.  The SUPABASE_SERVICE_ROLE_KEY env var must NOT have
//     the NEXT_PUBLIC_ prefix.
//
// Usage (Server Action):
//   import { createAdminClient } from "@/lib/supabase/admin";
//   const supabase = createAdminClient();
//   await supabase.auth.admin.createUser({ ... });
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");

  return createClient<Database>(url, serviceKey, {
    auth: {
      // Disable auto-refresh and session persistence — this client is only
      // used for one-shot admin operations per request.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
