// src/app/(auth)/login/page.tsx
// ---------------------------------------------------------------------------
// Login page — shared by all roles (Super Admin, Sales Supervisor / Super
// Stockist, Sales Person, Distributor).  Role-based routing happens after
// sign-in via the server action in actions.ts.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import LoginForm from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "Sign In | TopNTown DMS",
  description: "Sign in to your TopNTown DMS account",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-brand-900 p-4">
      <div className="w-full max-w-md space-y-6">

        {/* ── Logo placeholder ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          {/* Colored div standing in for the real SVG logo */}
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg"
            aria-hidden="true"
          >
            <span className="text-2xl font-black tracking-tight text-brand-700">
              NT
            </span>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-white">TopNTown</p>
            <p className="text-sm text-brand-200">Distribution Management System</p>
          </div>
        </div>

        {/* ── Login card ───────────────────────────────────────────────── */}
        <Card className="shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl font-semibold text-foreground">
              Welcome back
            </CardTitle>
            <CardDescription>
              Enter your phone number and password to sign in
            </CardDescription>
          </CardHeader>

          <CardContent>
            {/* Client component — handles form state, loading, error, redirect */}
            <LoginForm />
          </CardContent>
        </Card>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-brand-300">
          © {new Date().getFullYear()} TopNTown. All rights reserved.
        </p>
      </div>
    </main>
  );
}
