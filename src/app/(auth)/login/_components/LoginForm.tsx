// src/app/(auth)/login/_components/LoginForm.tsx
// ---------------------------------------------------------------------------
// Client component — owns form state, calls the signIn server action, and
// performs the role-based client-side redirect after a successful sign-in.
// ---------------------------------------------------------------------------
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, ROLE_REDIRECT } from "../actions";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function LoginForm() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // useTransition gives us isPending without managing a separate loading flag
  const [isPending, startTransition] = useTransition();

  // ── Phone input helpers ──────────────────────────────────────────────────
  /** Strip non-digits and cap at 10 characters (Indian mobile). */
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  }

  // ── Form submit ──────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signIn(phone, password);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      // Redirect based on role returned by the server action
      const destination = ROLE_REDIRECT[result.role] ?? "/dashboard";
      router.push(destination);
      router.refresh(); // ensure server components re-render with new session
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>

      {/* ── Phone number field ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone Number</Label>

        {/* Inline +91 prefix */}
        <div className="flex">
          <span
            className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground select-none"
            aria-hidden="true"
          >
            +91
          </span>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            maxLength={10}
            placeholder="98765 43210"
            value={phone}
            onChange={handlePhoneChange}
            disabled={isPending}
            className="rounded-l-none"
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
      </div>

      {/* ── Password field ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {error && (
        <p
          id="login-error"
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* ── Submit button ──────────────────────────────────────────────── */}
      <Button
        type="submit"
        disabled={isPending || phone.length < 10 || password.length < 1}
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Login"
        )}
      </Button>
    </form>
  );
}
