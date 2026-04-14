// src/app/(dashboard)/ss/payments/_components/PaymentsClient.tsx
// ---------------------------------------------------------------------------
// Client view for SS → Payment Tracking.
//
// Two sections:
//   1. Log payment form   — creates an ss_payments row at order time
//   2. Payment history    — filterable table
// ---------------------------------------------------------------------------

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { CheckCircle2, Loader2, PlusCircle, RefreshCcw } from "lucide-react";
import {
  listPayments,
  logPaymentAtOrderTime,
  type PaymentFilters,
  type OpenOrderOption,
  type SsPaymentMethod,
  type SsPaymentRow,
  type SsPaymentStatus,
} from "../actions";
import { formatInr, formatIstDate, formatIstDateTime } from "../../_lib/format";

interface Props {
  openOrders: OpenOrderOption[];
  canLogPayment: boolean;
  defaultFrom: string;
  defaultTo: string;
  openOrdersError?: string;
}

const METHODS: Array<{ value: SsPaymentMethod; label: string }> = [
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS: Array<{ value: SsPaymentStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

// Today at 12:00 IST as a default — avoids TZ off-by-one when submitting.
function nowIstDateTimeLocal(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(
    ist.getHours(),
  )}:${pad(ist.getMinutes())}`;
}

export default function PaymentsClient({
  openOrders,
  canLogPayment,
  defaultFrom,
  defaultTo,
  openOrdersError,
}: Props) {
  // ─── Log-payment form state ─────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState({
    orderId: "" as string,
    amount: "",
    method: "upi" as SsPaymentMethod,
    referenceNumber: "",
    paidAt: nowIstDateTimeLocal(),
    note: "",
  });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const selectedOrder = useMemo(
    () => openOrders.find((o) => o.id === formState.orderId) ?? null,
    [formState.orderId, openOrders],
  );

  // When the user picks an order, prefill the amount.
  const handleOrderChange = (orderId: string) => {
    setFormState((f) => {
      const order = openOrders.find((o) => o.id === orderId);
      return {
        ...f,
        orderId,
        amount: order ? order.totalAmount.toFixed(2) : f.amount,
      };
    });
  };

  const submitPayment = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setFormError(null);
      setFormSuccess(null);

      const amount = parseFloat(formState.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError("Enter a valid amount greater than zero.");
        return;
      }
      if (!formState.paidAt) {
        setFormError("Choose a payment date and time.");
        return;
      }

      setFormSubmitting(true);
      const paidAtIso = new Date(`${formState.paidAt}:00+05:30`).toISOString();
      const result = await logPaymentAtOrderTime({
        orderId: formState.orderId || null,
        amount,
        method: formState.method,
        referenceNumber: formState.referenceNumber,
        paidAt: paidAtIso,
        note: formState.note,
      });
      setFormSubmitting(false);

      if (!result.ok) {
        setFormError(result.error ?? "Could not log payment.");
        return;
      }

      setFormSuccess(
        selectedOrder
          ? `Payment of ${formatInr(amount)} logged for order ${selectedOrder.orderNumber}. Finance will confirm shortly.`
          : `Payment of ${formatInr(amount)} logged. Finance will confirm shortly.`,
      );
      setFormState({
        orderId: "",
        amount: "",
        method: "upi",
        referenceNumber: "",
        paidAt: nowIstDateTimeLocal(),
        note: "",
      });
      // Refresh history so the new row appears.
      runHistory();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formState, selectedOrder],
  );

  // ─── History state ───────────────────────────────────────────────────────
  const [filters, setFilters] = useState<PaymentFilters>({
    dateFrom: defaultFrom,
    dateTo: defaultTo,
    status: "all",
  });
  const [rows, setRows] = useState<SsPaymentRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPending, startHistoryTransition] = useTransition();

  const runHistory = useCallback(() => {
    startHistoryTransition(async () => {
      setHistoryError(null);
      const res = await listPayments(filters);
      setRows(res.rows);
      if (res.error) setHistoryError(res.error);
    });
  }, [filters]);

  useEffect(() => {
    runHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* ─── Log payment ─── */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Log a payment</h2>
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            disabled={!canLogPayment}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            <PlusCircle className="h-4 w-4" />
            {formOpen ? "Hide form" : "New payment"}
          </button>
        </div>

        {!canLogPayment && (
          <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            Payment logging is disabled in this view. Log in as a super stockist to record
            payments.
          </div>
        )}

        {formOpen && canLogPayment && (
          <form className="space-y-3 p-4" onSubmit={submitPayment}>
            {openOrdersError && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                Could not load open orders: {openOrdersError}. You can still log a payment
                without linking an order.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Link to order (optional)">
                <select
                  value={formState.orderId}
                  onChange={(e) => handleOrderChange(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— No linked order —</option>
                  {openOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} · {o.distributor} · {formatInr(o.totalAmount)}
                    </option>
                  ))}
                </select>
                {selectedOrder && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Placed {formatIstDate(selectedOrder.orderDate)} for {selectedOrder.distributor}
                  </p>
                )}
              </Field>

              <Field label="Amount (INR)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={formState.amount}
                  onChange={(e) =>
                    setFormState((f) => ({ ...f, amount: e.target.value }))
                  }
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </Field>

              <Field label="Method">
                <select
                  value={formState.method}
                  onChange={(e) =>
                    setFormState((f) => ({ ...f, method: e.target.value as SsPaymentMethod }))
                  }
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Reference number">
                <input
                  type="text"
                  placeholder="UTR / cheque no. / transaction id"
                  value={formState.referenceNumber}
                  onChange={(e) =>
                    setFormState((f) => ({ ...f, referenceNumber: e.target.value }))
                  }
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </Field>

              <Field label="Paid at (IST)">
                <input
                  type="datetime-local"
                  required
                  value={formState.paidAt}
                  onChange={(e) => setFormState((f) => ({ ...f, paidAt: e.target.value }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </Field>

              <Field label="Note (optional)">
                <input
                  type="text"
                  value={formState.note}
                  onChange={(e) => setFormState((f) => ({ ...f, note: e.target.value }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {formSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Log payment
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ─── History ─── */}
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
          <h2 className="mr-auto text-sm font-medium">Payment history</h2>
          <Field label="From" small>
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="To" small>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Status" small>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as SsPaymentStatus | "all",
                }))
              }
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={runHistory}
            disabled={historyPending}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            {historyPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        {historyError && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {historyError}
          </div>
        )}

        {rows.length === 0 && !historyPending ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No payments logged in this window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Paid at</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Method</th>
                <th className="px-4 py-3 text-left font-medium">Order ref.</th>
                <th className="px-4 py-3 text-left font-medium">Reference #</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatIstDateTime(p.paidAt)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatInr(p.amount)}
                  </td>
                  <td className="px-4 py-2 capitalize">{p.method.replace("_", " ")}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.orderNumber ?? (p.orderId ? p.orderId.slice(0, 8) : "—")}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.referenceNumber ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <PaymentStatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ─── Internal components ──────────────────────────────────────────────────────

function Field({
  label,
  children,
  small = false,
}: {
  label: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${small ? "" : ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PaymentStatusBadge({ status }: { status: SsPaymentStatus }) {
  const config: Record<SsPaymentStatus, { label: string; cls: string }> = {
    pending: {
      label: "Pending",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    confirmed: {
      label: "Confirmed",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    failed: {
      label: "Failed",
      cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    },
    refunded: {
      label: "Refunded",
      cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    },
  };
  const { label, cls } = config[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}
