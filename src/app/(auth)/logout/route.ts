// src/app/(auth)/logout/route.ts
// ---------------------------------------------------------------------------
// Sign-out route handler.
//
// Usage — link or form action pointing at /logout:
//   <form action="/logout" method="post">
//     <button type="submit">Sign out</button>
//   </form>
//
// Or a simple anchor (GET) works for non-destructive sign-out:
//   <a href="/logout">Sign out</a>
//
// Both GET and POST are handled so callers can choose whichever suits the UI.
// ---------------------------------------------------------------------------

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

async function handleSignOut(request: NextRequest) {
  const supabase = createClient();

  // Sign out on the Supabase side — this invalidates the server session and
  // clears the Supabase auth cookies via the SSR cookie helper.
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Even if Supabase errors we still want to clear local state and
    // redirect so the user isn't stuck in a broken session.
    console.error("[logout] supabase.auth.signOut error:", error.message);
  }

  // Clear the supplemental role cookie we set in the signIn action.
  const cookieStore = cookies();
  cookieStore.delete("user_role");

  // Redirect to the login page.
  const loginUrl = new URL("/login", request.url);
  const response = NextResponse.redirect(loginUrl);

  return response;
}

// Support both GET (simple link) and POST (form action)
export const GET = handleSignOut;
export const POST = handleSignOut;
