// src/app/(dashboard)/ss/billing/_components/BillingClient.tsx
// ---------------------------------------------------------------------------
// Client component that owns:
//   - filter state (date range, distributor, status)
//   - fetch orchestration (calls fetchBillingReport server action)
//   - xlsx export (using `xlsx` already installed via Reports module)
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Download, FileText, Loader2, RefreshCcw, Search } from "lucide-react";
import {
  fetchBillingReport,
  type BillingFilters,
  type BillingRow,
  type BillingSummary,
  type BillStatus,
} from "../actions";
import { formatInr, formatIstDate } from "../../_lib/format";

interface Props {
  distributors: Array<{ id: string; name: string }>;
  defaultFrom: string;
  defaultTo: string;
  loadError?: string;
}

const STATUS_OPTIONS: Array<{ value: BillStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partially paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
];

export default function BillingClient({
  distributors,
  defaultFrom,
  defaultTo,
  loadError,
}: Props) {
  const [filters, setFilters] = useState<BillingFilters>({
    dateFrom: defaultFrom,
    dateTo: defaultTo,
    distributorId: "all",
    status: "all",
  });
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [summary, setSummary] = useState<BillingSummary>({
    totalBills: 0,
    totalBilled: 0,
    totalCollected: 0,
    totalOverdue: 0,
  });
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);

  const runReport = useCallback(() => {
    startTransition(async () => {
      setFetchError(null);
      const result = await fetchBillingReport(filters);
      setRows(result.rows);
      setSummary(result.summary);
      if (result.error) setFetchError(result.error);
    });
  }, [filters]);

  // Initial load.
  useEffect(() => {
    runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = useCallback(async () => {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      // CSV export — Excel opens CSVs natively and we avoid the xlsx
      // binary dependency (which isn't installed in this environment).
      const header = [
        "Bill Date",
        "Distributor",
        "Bill Number",
        "Total Amount (INR)",
        "Paid (INR)",
        "Balance (INR)",
        "Status",
      ];

      const bodyRows = rows.map((r) => [
        formatIstDate(r.billDate),
        r.distributor,
        r.billNumber,
        r.totalAmount.toFixed(2),
        r.paymentsApplied.toFixed(2),
        Math.max(0, r.totalAmount - r.paymentsApplied).toFixed(2),
        r.status,
      ]);

      const trailer: Array<Array<string | number>> = [
        [],
        ["Summary"],
        ["Bills", summary.totalBills],
        ["Total billed (INR)", summary.totalBilled.toFixed(2)],
        ["Collected (INR)", summary.totalCollected.toFixed(2)],
        ["Overdue (INR)", summary.totalOverdue.toFixed(2)],
        [],
        ["Date range", `${filters.dateFrom} to ${filters.dateTo}`],
        [
          "Generated",
          new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        ],
      ];

      const all: Array<Array<string | number>> = [header, ...bodyRows, ...trailer];
      const csv =
        "\uFEFF" +
        all
          .map((line) =>
            line
              .map((cell) => {
                const s = cell === null || cell === undefined ? "" : String(cell);
                return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
              })
              .join(","),
          )
          .join("\r\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ss-billing-${filters.dateFrom}_to_${filters.dateTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (err) {
      setFetchError(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed.",
      );
    } finally {
      setExporting(false);
    }
  }, [rows, summary, filters]);

  const summaryCards = useMemo(
    () => [
      { label: "Bills", value: String(summary.totalBills) },
      { label: "Total billed", value: formatInr(summary.totalBilled) },
      { label: "Collected", value: formatInr(summary.totalCollected) },
      {
        label: "Overdue",
        value: formatInr(summary.totalOverdue),
        tone: summary.totalOverdue > 0 ? ("warning" as const) : undefined,
      },
    ],
    [summary],
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <FilterField label="From">
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </FilterField>
          <FilterField label="Distributor">
            <select
              value={filters.distributorId}
              onChange={(e) => setFilters((f) => ({ ...f, distributorId: e.target.value }))}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="all">All in network</option>
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value as BillStatus | "all" }))
              }
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={runReport}
              disabled={pending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Generate
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || rows.length === 0}
              title={rows.length === 0 ? "No rows to export" : "Export to Excel"}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Excel
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaryCards.map((c) => (
          <SummaryCard key={c.label} label={c.label} value={c.value} tone={c.tone} />
        ))}
      </div>

      {/* Errors */}
      {(loadError || fetchError) && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {loadError ?? fetchError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {pending
              ? "Loading…"
              : rows.length === 0
                ? "No bills match these filters."
                : `${rows.length} bill${rows.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={runReport}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <RefreshCcw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Distributor</th>
              <th className="px-4 py-3 text-left font-medium">Bill Number</th>
              <th className="px-4 py-3 text-right font-medium">Total Amount</th>
              <th className="px-4 py-3 text-right font-medium">Paid</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-2 text-muted-foreground">{formatIstDate(r.billDate)}</td>
                <td className="px-4 py-2">{r.distributor}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.billNumber}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatInr(r.totalAmount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatInr(r.paymentsApplied)}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-right">
                  {r.pdfUrl && (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      PDF
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Internal components ──────────────────────────────────────────────────────

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const config: Record<BillStatus, { label: string; cls: string }> = {
    paid: {
      label: "Paid",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    partial: {
      label: "Partial",
      cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    },
    unpaid: {
      label: "Unpaid",
      cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    },
    overdue: {
      label: "Overdue",
      cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    },
  };
  const { label, cls } = config[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}
