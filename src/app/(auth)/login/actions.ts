// src/app/(auth)/login/actions.ts
// ---------------------------------------------------------------------------
// Server Actions for authentication.
// All exports in this file run exclusively on the server.
// ---------------------------------------------------------------------------
"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "./constants";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------
export type SignInSuccess = { success: true; role: UserRole };
export type SignInError = { error: string };
export type SignInResult = SignInSuccess | SignInError;

// ---------------------------------------------------------------------------
// signIn — authenticate with phone + password
//
// Supabase stores each user's identifier as:
//   <phone_digits>@topntown.local
// e.g. 9876543210@topntown.local
//
// After successful auth the user's role is read from public.profiles and
// written into a short-lived "user_role" cookie so the client can redirect
// without an extra round-trip.
// ---------------------------------------------------------------------------
export async function signIn(
  phone: string,
  password: string
): Promise<SignInResult> {
  // Basic phone sanitation — strip spaces / dashes, keep digits only
  const digits = phone.replace(/\D/g, "");

  if (!digits || digits.length < 10) {
    return { error: "Please enter a valid 10-digit phone number." };
  }

  if (!password || password.length < 1) {
    return { error: "Password is required." };
  }

  const email = `${digits}@topntown.local`;

  const supabase = createClient();

  // ---- 1. Authenticate -------------------------------------------------
  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (authError) {
    // Map Supabase error messages to user-friendly strings
    const msg = authError.message.toLowerCase();
    if (
      msg.includes("invalid login credentials") ||
      msg.includes("invalid email or password")
    ) {
      return { error: "Invalid phone number or password." };
    }
    if (msg.includes("email not confirmed")) {
      return { error: "Account not verified. Please contact your administrator." };
    }
    if (
      msg.includes("user not found") ||
      msg.includes("no user found")
    ) {
      return { error: "No account found for this phone number." };
    }
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Sign-in failed. Please try again." };
  }

  // ---- 2. Fetch role from public.profiles ------------------------------
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile) {
    // Auth succeeded but profile is missing — sign back out to avoid a
    // half-authenticated state and surface an actionable message.
    await supabase.auth.signOut();
    return {
      error:
        "Your account is not properly set up. Please contact your administrator.",
    };
  }

  const role = profile.role as UserRole;

  // ---- 3. Persist role in a cookie so the client can redirect ----------
  //
  // This cookie is supplemental — the Supabase session cookie (set by the
  // SSR helper) is what actually protects routes.  This cookie is only used
  // to avoid an extra DB fetch on the first redirect.
  const cookieStore = cookies();
  cookieStore.set("user_role", role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Expire after 1 day — the Supabase session expiry is authoritative
    maxAge: 60 * 60 * 24,
  });

  return { success: true, role };
}
