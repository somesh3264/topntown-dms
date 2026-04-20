// src/app/(dashboard)/dashboard/orders/[orderId]/_components/GenerateBillButton.tsx
// ---------------------------------------------------------------------------
// Small client component that calls the triggerBillGeneration server action.
// Rendered only for super_admin on confirmed orders.
//
// Behaviour
//   • On click, confirms and invokes the server action.
//   • On success, calls `router.refresh()` so the server-rendered order page
//     picks up the new bill row (and, if the Edge Function finished in-band,
//     the populated pdf_url).
//   • If the server action returns a `pdfWarning` — meaning the bill was
//     created but the PDF Edge Function failed/timed out — we display that
//     warning prominently so the admin knows the background render needs a
//     retry. The BillCard polling + retry affordance handles the recovery.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { triggerBillGeneration } from "../../../../orders/actions";

export default function GenerateBillButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    | { tone: "success"; text: string; warning?: string }
    | { tone: "error"; text: string }
    | null
  >(null);

  const handleClick = () => {
    if (!confirm("Generate a bill for this order now? This action cannot be undone.")) return;
    startTransition(async () => {
      setMessage(null);
      const result = await triggerBillGeneration(orderId);
      if (result.success) {
        setMessage({
          tone: "success",
          text: `Bill ${result.data?.billNumber ?? ""} generated.`,
          warning: result.data?.pdfWarning,
        });
        // Re-fetch the server component so the BillCard renders. When the PDF
        // was generated in-band, pdf_url is already populated; when it wasn't,
        // BillCard's client-side poll will take over from here.
        router.refresh();
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

      {message?.tone === "success" && (
        <div className="flex items-start gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {message?.tone === "success" && message.warning && (
        <div className="flex max-w-sm items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <span className="font-medium">PDF render problem:</span> {message.warning}
          </span>
        </div>
      )}

      {message?.tone === "error" && (
        <div className="flex items-start gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
