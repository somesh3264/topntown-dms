"use client";
// src/app/global-error.tsx
// Catches errors in the root layout — without this file Next.js shows a
// completely blank page when the root layout or a top-level component throws.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "sans-serif", padding: "2rem", background: "#fff" }}>
        <h2 style={{ color: "#dc2626" }}>Application Error</h2>
        <p style={{ color: "#374151", marginBottom: "1rem" }}>
          {error?.message || "An unexpected error occurred."}
        </p>
        {error?.stack && (
          <pre
            style={{
              background: "#f3f4f6",
              padding: "1rem",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              overflow: "auto",
              color: "#111827",
            }}
          >
            {error.stack}
          </pre>
        )}
        {error?.digest && (
          <p style={{ color: "#6b7280", fontSize: "0.75rem", marginTop: "1rem" }}>
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: "0.5rem 1rem",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
