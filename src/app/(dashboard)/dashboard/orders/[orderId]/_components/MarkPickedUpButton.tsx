// src/app/(dashboard)/dashboard/orders/[orderId]/_components/MarkPickedUpButton.tsx
// ---------------------------------------------------------------------------
// "Mark as picked up" — flips an order from confirmed/billed to dispatched.
//
// This is the boundary action that closes the admin edit window. Once a
// distributor has physically taken stock from the factory, neither the
// dashboard nor the app should let anyone change quantities; this button is
// what records that fact.
//
// Behaviour
//   • Confirms with the user before firing (irreversible).
//   • Calls markOrderPickedUp(); on success, calls router.refresh() so the
//     header re-renders with the pickup timestamp and the OrderItemsSection
//     immediately swaps its Edit button for a Locked badge.
//   • Surfaces any server error inline so the admin doesn't have to dig
//     through a toast that disappears.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { markOrderPickedUp } from "../../../../orders/actions";

interface MarkPickedUpButtonProps {
  orderId: string;
}

export default function MarkPickedUpButton({ orderId }: MarkPickedUpButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (
      !confirm(
        "Mark this order as picked up from the factory?\n\nOnce picked up, items can no longer be edited.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await markOrderPickedUp(orderId);
      if (!result.success) {
        setError(result.error ?? "Could not mark pickup.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PackageCheck className="h-4 w-4" />
        )}
        Mark as picked up
      </button>
      {error && (
        <div className="flex max-w-sm items-start gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
