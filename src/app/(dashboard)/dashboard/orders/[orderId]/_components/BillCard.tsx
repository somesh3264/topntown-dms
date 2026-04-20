// src/app/(dashboard)/dashboard/orders/[orderId]/_components/BillCard.tsx
// ---------------------------------------------------------------------------
// Client-side BillCard used on the order-detail page.
//
// Previously this was a pure server component that rendered whatever value
// bills.pdf_url had at request time. That caused the "PDF is still rendering —
// refresh in a moment" message to sit there forever whenever:
//   • the Edge Function took longer than the 15s in-band wait, OR
//   • the Edge Function silently failed (not deployed / misconfigured /
//     storage bucket missing), OR
//   • the initial render beat the Edge Function's storage upload by a few ms.
//
// This component fixes all three:
//   1. If pdf_url is null on mount, we poll `getBillPdfUrl` every 3 s for up
//      to ~60 s. As soon as the Edge Function writes the URL we flip to the
//      Download button — no manual page refresh needed.
//   2. If polling gives up or the super_admin wants to regenerate, a Retry
//      PDF button calls `retryBillPdfGeneration` and surfaces the real error
//      message from the Edge Function (e.g. "function not deployed", "storage
//      upload failed") instead of a generic "still rendering" message.
//   3. The polling cleans up its timer on unmount so navigating away doesn't
//      leak timeouts.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { formatInr, formatIstDate } from "../../../../ss/_lib/format";
import type { OrderBillSummary } from "../../../../orders/actions";
import {
  getBillPdfUrl,
  retryBillPdfGeneration,
} from "../../../../orders/actions";

// Poll every 3 s, up to 20 tries (~60 s). The Edge Function usually finishes
// in a few seconds; going longer than a minute without a URL means something
// went wrong and the user should retry explicitly.
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 20;

interface BillCardProps {
  bill: OrderBillSummary;
  /** Whether the viewer may retry PDF generation (super_admin only). */
  canRetryPdf: boolean;
}

export default function BillCard({ bill, canRetryPdf }: BillCardProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(bill.pdf_url);
  const [attempts, setAttempts] = useState(0);
  const [polling, setPolling] = useState(pdfUrl === null);
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop any pending timer. Called from cleanup and before scheduling the
  // next poll tick to avoid drift on fast refreshes.
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  // Polling loop — only runs while we have no URL and haven't exhausted the
  // attempt budget. Each tick hits getBillPdfUrl (a tiny server action) and
  // updates local state; once the URL appears, polling stops.
  useEffect(() => {
    if (!polling || pdfUrl || attempts >= POLL_MAX_ATTEMPTS) return;

    stopTimer();
    timerRef.current = setTimeout(async () => {
      try {
        const result = await getBillPdfUrl(bill.id);
        if (result.pdfUrl) {
          setPdfUrl(result.pdfUrl);
          setPolling(false);
          return;
        }
      } catch {
        // Transient failure — just count this as an attempt and keep trying.
      }
      setAttempts((a) => a + 1);
    }, POLL_INTERVAL_MS);

    return stopTimer;
  }, [polling, pdfUrl, attempts, bill.id, stopTimer]);

  // When we cross the attempt budget, stop polling so the UI can show the
  // retry affordance instead of the "still rendering" message.
  useEffect(() => {
    if (attempts >= POLL_MAX_ATTEMPTS) {
      setPolling(false);
    }
  }, [attempts]);

  function handleRetry() {
    setRetryError(null);
    setAttempts(0);
    startRetry(async () => {
      const result = await retryBillPdfGeneration(bill.id);
      if (!result.success) {
        setRetryError(result.error ?? "PDF generation failed.");
        return;
      }
      if (result.data?.pdfUrl) {
        setPdfUrl(result.data.pdfUrl);
        setPolling(false);
      } else {
        // Edge Function accepted but DB hasn't caught up yet — resume polling.
        setPolling(true);
      }
    });
  }

  const hasPdf = Boolean(pdfUrl);
  const pollingActive = polling && !hasPdf && attempts < POLL_MAX_ATTEMPTS;
  const pollingGaveUp = !polling && !hasPdf && attempts >= POLL_MAX_ATTEMPTS;

  return (
    <section
      aria-labelledby="bill-card-heading"
      className="mb-6 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2
              id="bill-card-heading"
              className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
            >
              Bill
            </h2>
            <p className="mt-0.5 font-mono text-base font-semibold">
              {bill.bill_number ?? `#${bill.id.slice(0, 8)}`}
            </p>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground md:grid-cols-3">
              <span>
                <span className="text-xs uppercase tracking-wide">Bill date</span>
                <br />
                <span className="text-foreground">
                  {formatIstDate(bill.bill_date)}
                </span>
              </span>
              <span>
                <span className="text-xs uppercase tracking-wide">Status</span>
                <br />
                <span className="text-foreground capitalize">{bill.status}</span>
              </span>
              <span>
                <span className="text-xs uppercase tracking-wide">Total</span>
                <br />
                <span className="text-foreground tabular-nums">
                  {formatInr(bill.total_amount)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex max-w-sm flex-col items-end gap-1.5">
          {hasPdf ? (
            <a
              href={pdfUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
          ) : pollingActive ? (
            <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              PDF is rendering… waiting for the render service.
            </span>
          ) : (
            <span className="inline-flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {pollingGaveUp
                  ? "PDF hasn't been generated after 60 seconds. The Edge Function may not be deployed."
                  : "PDF is not available yet."}
              </span>
            </span>
          )}

          {canRetryPdf && !hasPdf && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry PDF generation
            </button>
          )}

          {retryError && (
            <div className="flex max-w-sm items-start gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{retryError}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
