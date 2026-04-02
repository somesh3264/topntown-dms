// src/app/(auth)/login/page.tsx
// ---------------------------------------------------------------------------
// Login page — shared by all roles (Super Admin, Sales Supervisor, Sales
// Person, Distributor).  Role-based routing happens after sign-in via
// the dashboard/app redirect.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import LoginForm from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your TopNTown DMS account",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-brand-900 p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-2xl">
        {/* Logo / Brand */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-brand-700">
            TopNTown DMS
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Distribution Management System
          </p>
        </div>

        {/* Login form — client component handles form state & Supabase call */}
        <LoginForm />
      </div>
    </main>
  );
}
