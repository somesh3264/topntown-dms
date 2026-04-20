// src/app/(dashboard)/dashboard/dispatch/_components/DispatchRow.tsx
// ---------------------------------------------------------------------------
// Per-row "Mark picked up" action for the Dispatch queue.
//
// Wraps the shared markOrderPickedUp server action with a confirm dialog and
// inline error display. On success, calls router.refresh() so the row falls
// out of the list (its status is now 'dispatched', no longer in the query).
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { markOrderPickedUp } from "../../../orders/actions";

interface DispatchRowProps {
  orderId: string;
}

export default function DispatchRow({ orderId }: DispatchRowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (
      !confirm(
        "Mark this order as picked up?\n\nStock is now being handed over to the distributor. This cannot be undone.",
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
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PackageCheck className="h-4 w-4" />
        )}
        Mark picked up
      </button>
      {error && (
        <div className="flex max-w-xs items-start gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
