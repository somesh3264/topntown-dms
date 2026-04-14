// src/app/(dashboard)/dashboard/system/whatsapp-log/_components/WhatsappLogClient.tsx
// ---------------------------------------------------------------------------
// Client component for the WhatsApp log page — filter chips, table, and the
// per-row "Retry" button that calls the `retryWhatsappLog` server action.
// ---------------------------------------------------------------------------

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useState } from "react";
import { retryWhatsappLog } from "../actions";

export interface WhatsappLogRow {
  id: string;
  created_at: string;
  phone: string;
  template_name: string;
  provider: "wati" | "twilio";
  status: "sent" | "failed" | "retried";
  provider_message_id: string | null;
  error_message: string | null;
  rendered_preview: string | null;
  entity_type: string | null;
  entity_id: string | null;
  retry_of_log_id: string | null;
}

interface Props {
  rows: WhatsappLogRow[];
  currentStatus: string;
  currentTemplate: string;
  counts: { sent: number; failed: number; retried: number };
}

const STATUSES: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "retried", label: "Retried" },
];

const TEMPLATES: Array<{ value: string; label: string }> = [
  { value: "all", label: "All templates" },
  { value: "bill_ready", label: "bill_ready" },
  { value: "delivery_receipt", label: "delivery_receipt" },
  { value: "ledger_summary", label: "ledger_summary" },
];

export function WhatsappLogClient({ rows, currentStatus, currentTemplate, counts }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastToast, setLastToast] = useState<{ ok: boolean; text: string } | null>(null);

  function setFilter(key: "status" | "template", value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete(key);
    else sp.set(key, value);
    router.push(`?${sp.toString()}`);
  }

  function handleRetry(logId: string) {
    setRetryingId(logId);
    startTransition(async () => {
      const result = await retryWhatsappLog(logId);
      setRetryingId(null);
      setLastToast(
        result.ok
          ? { ok: true, text: `Retry sent (log ${result.newLogId?.slice(0, 8)}…).` }
          : { ok: false, text: result.error ?? "Retry failed." },
      );
      router.refresh();
      // Auto-dismiss the toast after a moment.
      setTimeout(() => setLastToast(null), 4500);
    });
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 max-w-lg">
        <Card label="Sent" value={counts.sent} tone="ok" />
        <Card label="Failed" value={counts.failed} tone="bad" />
        <Card label="Retried" value={counts.retried} tone="muted" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Status:</span>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter("status", s.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              currentStatus === s.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            {s.label}
          </button>
        ))}

        <span className="ml-4 text-xs uppercase tracking-wide text-muted-foreground mr-1">
          Template:
        </span>
        {TEMPLATES.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilter("template", t.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              currentTemplate === t.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toast */}
      {lastToast && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            lastToast.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          {lastToast.text}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Template</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Preview / Error</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No log entries match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatTime(r.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.phone}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.template_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.provider}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {r.entity_type ?? "-"}
                    {r.entity_id ? (
                      <span className="ml-1 font-mono">· {r.entity_id.slice(0, 8)}…</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[360px]">
                    {r.status === "failed" ? (
                      <span className="text-red-700">{r.error_message ?? "(no error recorded)"}</span>
                    ) : (
                      <span className="text-muted-foreground">{r.rendered_preview ?? "-"}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.status === "failed" ? (
                      <button
                        onClick={() => handleRetry(r.id)}
                        disabled={isPending && retryingId === r.id}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        {isPending && retryingId === r.id ? "Retrying…" : "Retry"}
                      </button>
                    ) : r.retry_of_log_id ? (
                      <Link
                        href={`?status=all&template=all`}
                        className="text-xs text-muted-foreground underline"
                        title={`Retry of ${r.retry_of_log_id}`}
                      >
                        retry
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────

function Card({ label, value, tone }: { label: string; value: number; tone: "ok" | "bad" | "muted" }) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "bad"
        ? "border-red-200 bg-red-50"
        : "border-muted bg-muted/30";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: WhatsappLogRow["status"] }) {
  const cls =
    status === "sent"
      ? "bg-emerald-100 text-emerald-900"
      : status === "failed"
        ? "bg-red-100 text-red-900"
        : "bg-amber-100 text-amber-900";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
