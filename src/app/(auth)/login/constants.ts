// src/app/(auth)/login/constants.ts
// ---------------------------------------------------------------------------
// Auth constants — kept in a plain (non-"use server") module so they can be
// imported by both server actions and client components without violating the
// Next.js rule that "use server" files may only export async functions.
// ---------------------------------------------------------------------------

export type UserRole =
  | "super_admin"
  | "sales_supervisor"
  | "sales_person"
  | "distributor";

/** Maps each role to its post-login landing path. */
export const ROLE_REDIRECT: Record<UserRole, string> = {
  super_admin: "/dashboard",
  sales_supervisor: "/dashboard",
  sales_person: "/dashboard",
  distributor: "/app",
};
