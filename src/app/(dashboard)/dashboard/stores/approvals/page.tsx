// src/app/(dashboard)/stores/approvals/page.tsx
// ---------------------------------------------------------------------------
// Store Approval Workflow page (v1.1 — Super Admin only).
//
// Shows pending approvals created by distributors.
// Each card displays:
//   • Store name + owner
//   • Submitted by (distributor name)
//   • Shop photo thumbnail
//   • GPS map preview (OpenStreetMap)
//   • Area / Zone
//   • "Approve" and "Reject" actions
//
// Approve → sets is_active = true, approval status = 'approved'
// Reject  → prompts for reason, sets status = 'rejected' (store stays inactive)
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  XCircle,
  MapPin,
  Store,
  User,
  Clock,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  ImageOff,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getStoreApprovals,
  approveStore,
  rejectStore,
  type ApprovalRow,
} from "../actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "pending" | "approved" | "rejected" | "all";

// ─── Reject Dialog ────────────────────────────────────────────────────────────

interface RejectDialogProps {
  approval: ApprovalRow | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  pending: boolean;
}

function RejectDialog({
  approval,
  onConfirm,
  onCancel,
  pending,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    onConfirm(reason.trim());
  }

  return (
    <Dialog open={!!approval} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Store?</DialogTitle>
          <DialogDescription>
            <strong>{approval?.store_name}</strong> will remain inactive.
            Please provide a reason.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="rej-reason">Rejection Reason</Label>
            <Input
              id="rej-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. GPS location inaccurate, photo unclear…"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || !reason.trim()}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject Store
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Approval Card ────────────────────────────────────────────────────────────

interface ApprovalCardProps {
  approval: ApprovalRow;
  onApprove: (a: ApprovalRow) => void;
  onReject: (a: ApprovalRow) => void;
  processing: boolean;
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
  processing,
}: ApprovalCardProps) {
  const hasGps = approval.gps_lat !== null && approval.gps_lng !== null;
  const areaZone = [approval.zone_name, approval.area_name]
    .filter(Boolean)
    .join(" / ");

  const mapSrc =
    hasGps
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${approval.gps_lng! - 0.005},${approval.gps_lat! - 0.005},${approval.gps_lng! + 0.005},${approval.gps_lat! + 0.005}&layer=mapnik&marker=${approval.gps_lat},${approval.gps_lng}`
      : null;

  const statusColors: Record<ApprovalRow["status"], string> = {
    pending:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    approved:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  const reviewedDate = approval.reviewed_at
    ? new Date(approval.reviewed_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  const submittedDate = new Date(approval.created_at).toLocaleDateString(
    "en-IN",
    { day: "2-digit", month: "short", year: "numeric" }
  );

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden transition-opacity",
        processing && "pointer-events-none opacity-60"
      )}
    >
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
        {/* ── Left: Photo + Map ──────────────────────────────────────────────── */}
        <div className="flex flex-col border-b md:border-b-0 md:border-r">
          {/* Shop photo */}
          <div className="relative h-44 bg-muted">
            {approval.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={approval.photo_url}
                alt={`Shop photo – ${approval.store_name}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOff className="h-8 w-8 opacity-40" />
                <span className="text-xs">No photo</span>
              </div>
            )}
            <span
              className={cn(
                "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                statusColors[approval.status]
              )}
            >
              {approval.status}
            </span>
          </div>

          {/* GPS map */}
          {mapSrc ? (
            <div className="overflow-hidden border-t">
              <iframe
                src={mapSrc}
                width="100%"
                height="140"
                frameBorder="0"
                scrolling="no"
                className="pointer-events-none"
                title={`GPS – ${approval.store_name}`}
                loading="lazy"
              />
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center border-t bg-muted/40 text-xs text-muted-foreground gap-2">
              <XCircle className="h-4 w-4" />
              No GPS data
            </div>
          )}
        </div>

        {/* ── Right: Details + Actions ───────────────────────────────────────── */}
        <div className="flex flex-col justify-between p-4">
          <div className="space-y-3">
            {/* Store name */}
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {approval.store_name}
              </h3>
              {approval.owner_name && (
                <p className="text-sm text-muted-foreground">
                  {approval.owner_name}
                </p>
              )}
            </div>

            {/* Meta rows */}
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground">
                <User className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Submitted by
                  </span>
                  <p>{approval.submitter_name ?? approval.submitted_by}</p>
                </div>
              </div>

              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Area
                  </span>
                  <p>{areaZone || "—"}</p>
                </div>
              </div>

              {hasGps && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide">
                      GPS
                    </span>
                    <p className="font-mono text-xs">
                      {approval.gps_lat!.toFixed(6)},{" "}
                      {approval.gps_lng!.toFixed(6)}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 text-muted-foreground">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Submitted
                  </span>
                  <p>{submittedDate}</p>
                </div>
              </div>

              {/* Rejection reason */}
              {approval.status === "rejected" && approval.rejection_reason && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 px-2 py-1.5 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <span className="text-xs font-semibold">Rejection reason:</span>
                    <p className="text-xs">{approval.rejection_reason}</p>
                  </div>
                </div>
              )}

              {/* Reviewed date */}
              {reviewedDate && approval.status !== "pending" && (
                <p className="text-xs text-muted-foreground">
                  Reviewed on {reviewedDate}
                </p>
              )}
            </dl>
          </div>

          {/* Actions — only for pending */}
          {approval.status === "pending" && (
            <div className="mt-4 flex items-center gap-2 pt-3 border-t">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-destructive hover:border-destructive/40 hover:text-destructive"
                onClick={() => onReject(approval)}
                disabled={processing}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => onApprove(approval)}
                disabled={processing}
              >
                {processing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Approve
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StoreApprovalsPage() {
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [approvals, setApprovals] = useState<ApprovalRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Load approvals ────────────────────────────────────────────────────────
  async function loadApprovals(filter: StatusFilter = statusFilter) {
    setLoading(true);
    const data = await getStoreApprovals(filter);
    setApprovals(data);
    setLoading(false);
  }

  // Initial load
  useState(() => {
    loadApprovals("pending");
  });

  // Reload when filter changes
  function handleFilterChange(v: string) {
    const f = v as StatusFilter;
    setStatusFilter(f);
    loadApprovals(f);
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function handleApprove(approval: ApprovalRow) {
    setApprovingId(approval.id);
    const result = await approveStore(approval.id, approval.store_id);
    setApprovingId(null);

    if (!result.success) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Store approved",
      description: `${approval.store_name} is now active and visible in the beat screen.`,
    });

    setApprovals((prev) =>
      prev
        ? prev.map((a) =>
            a.id === approval.id
              ? { ...a, status: "approved" as const, reviewed_at: new Date().toISOString() }
              : a
          )
        : prev
    );
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  const [rejectTarget, setRejectTarget] = useState<ApprovalRow | null>(null);
  const [rejectPending, startRejectTransition] = useTransition();

  function handleRejectConfirm(reason: string) {
    if (!rejectTarget) return;
    const target = rejectTarget;

    startRejectTransition(async () => {
      const result = await rejectStore(target.id, reason);
      setRejectTarget(null);

      if (!result.success) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Store rejected",
        description: `${target.store_name} has been rejected.`,
        variant: "destructive",
      });

      setApprovals((prev) =>
        prev
          ? prev.map((a) =>
              a.id === target.id
                ? {
                    ...a,
                    status: "rejected" as const,
                    rejection_reason: reason,
                    reviewed_at: new Date().toISOString(),
                  }
                : a
            )
          : prev
      );
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const pendingCount =
    approvals?.filter((a) => a.status === "pending").length ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/stores"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Store Directory
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Store className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Store Approvals
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Review and approve stores submitted by distributors.
            </p>
          </div>
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pending count badge */}
      {statusFilter === "pending" && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <Clock className="h-4 w-4" />
          <strong>{pendingCount}</strong> store
          {pendingCount !== 1 ? "s" : ""} awaiting approval
        </div>
      )}

      {/* ── Cards grid ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading approvals…
        </div>
      ) : approvals && approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <CheckCircle2 className="mb-3 h-10 w-10 opacity-30" />
          <p className="font-medium">
            {statusFilter === "pending"
              ? "No pending approvals"
              : `No ${statusFilter} approvals`}
          </p>
          <p className="mt-1 text-xs">
            {statusFilter === "pending"
              ? "All store submissions have been reviewed."
              : "Change the filter to see other approvals."}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {(approvals ?? []).map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={setRejectTarget}
              processing={approvingId === approval.id}
            />
          ))}
        </div>
      )}

      {/* ── Reject dialog ────────────────────────────────────────────────────── */}
      <RejectDialog
        approval={rejectTarget}
        onConfirm={handleRejectConfirm}
        onCancel={() => setRejectTarget(null)}
        pending={rejectPending}
      />
    </div>
  );
}
