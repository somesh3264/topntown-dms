// src/app/(dashboard)/dashboard/orders/[orderId]/_components/GenerateBillButton.tsx
// ---------------------------------------------------------------------------
// Small client component that calls the triggerBillGeneration server action.
// Rendered only for super_admin on confirmed orders.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { triggerBillGeneration } from "../../../../orders/actions";

export default function GenerateBillButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  const handleClick = () => {
    if (!confirm("Generate a bill for this order now? This action cannot be undone.")) return;
    startTransition(async () => {
      setMessage(null);
      const result = await triggerBillGeneration(orderId);
      if (result.success) {
        setMessage({
          tone: "success",
          text: `Bill ${result.data?.billNumber ?? ""} generated. The PDF will appear once the edge function finishes.`,
        });
      } else {
        setMessage({ tone: "error", text: result.error ?? "Could not generate bill." });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Generate bill
      </button>
      {message && (
        <div
          className={`flex items-start gap-1 rounded-md px-2 py-1 text-xs ${
            message.tone === "success"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {message.tone === "success" && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
