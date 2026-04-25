// src/components/stores/StoreForm.tsx
// ---------------------------------------------------------------------------
// Store Form — slide-over panel used for both Create and Edit.
//
// Fields:
//   store_name, owner_name, phone, address (textarea)
//   zone → area (cascading dropdowns)
//   GPS Capture (mandatory — GpsCapture component)
//   Shop Photo (mandatory — ShopPhotoCapture component)
//   Assigned Distributor (searchable dropdown filtered by selected area)
//
// Business rules enforced:
//   • Submit disabled until area_id selected AND gps captured AND photo taken
//   • Area re-assignment after creation: locked for non-super_admin (lock icon)
//   • Distributors: stores submitted with is_active=false + approval workflow
// ---------------------------------------------------------------------------

"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  X,
  Store,
  Loader2,
  Lock,
  Search,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { GpsCapture } from "./GpsCapture";
import { ShopPhotoCapture } from "./ShopPhotoCapture";
import {
  createStore,
  updateStore,
  approveStore,
  rejectStore,
  getAreasForZone,
  getDistributorsForArea,
  type StoreRow,
  type AppRole,
} from "@/app/(dashboard)/dashboard/stores/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreFormProps {
  /** null = create mode; StoreRow = edit mode */
  store?: StoreRow | null;
  zones: { id: string; name: string }[];
  /** Caller's role — used to enforce area-re-assignment lock */
  callerRole: AppRole;
  onSuccess: (store: Partial<StoreRow> & { id: string }) => void;
  onClose: () => void;
}

// ─── Searchable Distributor Dropdown ─────────────────────────────────────────

interface DistributorPickerProps {
  areaId: string;
  value: string;
  onChange: (id: string, name: string) => void;
  disabled?: boolean;
}

function DistributorPicker({
  areaId,
  value,
  onChange,
  disabled,
}: DistributorPickerProps) {
  const [distributors, setDistributors] = useState<
    { id: string; full_name: string | null; phone: string | null }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const selected = distributors.find((d) => d.id === value);

  useEffect(() => {
    if (!areaId) {
      setDistributors([]);
      return;
    }
    setLoading(true);
    getDistributorsForArea(areaId).then((data) => {
      setDistributors(data);
      setLoading(false);
    });
  }, [areaId]);

  const filtered = distributors.filter((d) =>
    (d.full_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function handleSelect(dist: { id: string; full_name: string | null }) {
    onChange(dist.id, dist.full_name ?? "");
    setOpen(false);
    setSearch("");
  }

  function handleClear() {
    onChange("", "");
    setSearch("");
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || !areaId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          !areaId && "text-muted-foreground"
        )}
      >
        <span className="truncate">
          {loading
            ? "Loading distributors…"
            : !areaId
            ? "Select area first"
            : selected
            ? selected.full_name ?? selected.id
            : "Select distributor (optional)"}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          {/* Search */}
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search distributors…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-48 overflow-y-auto py-1">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="flex w-full items-center px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                None (unassigned)
              </button>
            )}

            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {distributors.length === 0
                  ? "No distributors in this area."
                  : "No results."}
              </p>
            ) : (
              filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleSelect(d)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                    d.id === value && "bg-accent/50 font-medium"
                  )}
                >
                  <span>{d.full_name ?? d.id}</span>
                  {d.phone && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {d.phone}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main StoreForm Component ─────────────────────────────────────────────────

export function StoreForm({
  store,
  zones,
  callerRole,
  onSuccess,
  onClose,
}: StoreFormProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(store);

  // Review mode = SA opening a pending submission. We render the same form
  // (so SA can correct typos before approving) but show an extra
  // approve/reject pair in the footer. Pulled out as a derived flag so the
  // body can use it inline without retesting the conditions.
  const isReview =
    isEdit &&
    callerRole === "super_admin" &&
    store?.approval_status === "pending" &&
    Boolean(store?.approval_id);

  // Reject-reason inline form. Kept inside the slide-over rather than as a
  // separate Dialog so the SA never loses the context of the submission
  // they're rejecting.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reviewBusy, setReviewBusy] = useState<"approve" | "reject" | null>(
    null
  );

  // ── Field state ────────────────────────────────────────────────────────────
  const [storeName, setStoreName] = useState(store?.name ?? "");
  const [ownerName, setOwnerName] = useState(store?.owner_name ?? "");
  const [phone, setPhone] = useState(store?.phone ?? "");
  const [address, setAddress] = useState(store?.address ?? "");

  // Zone / Area
  const [zoneId, setZoneId] = useState(store?.zone_id ?? "");
  const [areaId, setAreaId] = useState(store?.area_id ?? "");
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);

  // Distributor
  const [distributorId, setDistributorId] = useState(
    store?.primary_distributor_id ?? ""
  );

  // GPS
  const [gpsLat, setGpsLat] = useState<number | null>(store?.gps_lat ?? null);
  const [gpsLng, setGpsLng] = useState<number | null>(store?.gps_lng ?? null);

  // Photo
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const hasExistingPhoto = Boolean(store?.id); // edit mode assumes photo exists

  // Area-lock for non-SA in edit mode
  const areaLocked = isEdit && callerRole !== "super_admin";

  // ── Load areas when zone changes ──────────────────────────────────────────
  useEffect(() => {
    if (!zoneId) {
      setAreas([]);
      if (!isEdit) setAreaId("");
      return;
    }
    setAreasLoading(true);
    getAreasForZone(zoneId).then((data) => {
      setAreas(data);
      setAreasLoading(false);
    });
  }, [zoneId, isEdit]);

  // ── GPS capture callback ──────────────────────────────────────────────────
  const handleGpsCapture = useCallback((lat: number, lng: number) => {
    setGpsLat(lat);
    setGpsLng(lng);
  }, []);

  // ── Photo capture callback ────────────────────────────────────────────────
  const handlePhotoCapture = useCallback((dataUrl: string) => {
    setPhotoDataUrl(dataUrl);
  }, []);

  const handlePhotoClear = useCallback(() => {
    setPhotoDataUrl(null);
  }, []);

  // ── Submit validation ─────────────────────────────────────────────────────
  const gpsReady = gpsLat !== null && gpsLng !== null;
  const photoReady = hasExistingPhoto || Boolean(photoDataUrl);
  const canSubmit =
    storeName.trim() &&
    areaId &&
    gpsReady &&
    photoReady &&
    !pending;

  // ── Submit handler ────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!canSubmit) {
      if (!areaId)
        toast({
          title: "Area required",
          description: "Please select a zone and area before submitting.",
          variant: "destructive",
        });
      else if (!gpsReady)
        toast({
          title: "GPS required",
          description: "Please capture the store's GPS location.",
          variant: "destructive",
        });
      else if (!photoReady)
        toast({
          title: "Photo required",
          description: "Please take a shop photo before submitting.",
          variant: "destructive",
        });
      return;
    }

    const fd = new FormData();
    fd.set("store_name", storeName.trim());
    fd.set("owner_name", ownerName.trim());
    fd.set("phone", phone.trim());
    fd.set("address", address.trim());
    fd.set("zone_id", zoneId);
    fd.set("area_id", areaId);
    fd.set("gps_lat", String(gpsLat));
    fd.set("gps_lng", String(gpsLng));
    if (distributorId) fd.set("distributor_id", distributorId);
    if (photoDataUrl) fd.set("photo_data_url", photoDataUrl);

    startTransition(async () => {
      const result = isEdit && store
        ? await updateStore(store.id, fd)
        : await createStore(fd);

      if (!result.success) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      const successMsg = isEdit
        ? `${storeName} has been updated.`
        : callerRole === "distributor"
        ? `${storeName} submitted for approval.`
        : `${storeName} has been added.`;

      toast({ title: isEdit ? "Store updated" : "Store created", description: successMsg });

      onSuccess({
        id: isEdit ? store!.id : (result as any).data?.id ?? "",
        name: storeName.trim(),
        owner_name: ownerName.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        area_id: areaId,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        primary_distributor_id: distributorId || null,
        is_active: callerRole !== "distributor",
      });
    });
  }

  // ── Approve handler (review mode only) ────────────────────────────────────
  // Save any pending edits first, then flip approval to 'approved' which the
  // server-side action also sets is_active=true. We don't auto-save edits to
  // avoid silent overwrites — if the SA changed fields they explicitly hit
  // "Save Changes" first; "Approve" on its own approves the submission as-is.
  async function handleApprove() {
    if (!isReview || !store?.approval_id) return;
    setReviewBusy("approve");
    const result = await approveStore(store.approval_id, store.id);
    setReviewBusy(null);

    if (!result.success) {
      toast({
        title: "Approval failed",
        description: result.error,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Store approved",
      description: `${store.name} is now active.`,
    });
    // Caller refreshes the list. We pass approval_status so the local
    // optimistic update flips the row out of the Pending card.
    onSuccess({
      id: store.id,
      is_active: true,
      approval_status: "approved",
    });
  }

  // ── Reject handler (review mode only) ─────────────────────────────────────
  async function handleReject() {
    if (!isReview || !store?.approval_id) return;
    if (!rejectReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please tell the distributor why this submission is being rejected.",
        variant: "destructive",
      });
      return;
    }
    setReviewBusy("reject");
    const result = await rejectStore(store.approval_id, rejectReason.trim());
    setReviewBusy(null);

    if (!result.success) {
      toast({
        title: "Rejection failed",
        description: result.error,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Submission rejected",
      description: `${store.name} was rejected.`,
    });
    onSuccess({
      id: store.id,
      is_active: false,
      approval_status: "rejected",
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Slide-over panel ──────────────────────────────────────────────────── */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Store" : "Add Store"}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {isReview
                ? "Review Submission"
                : isEdit
                ? "Edit Store"
                : "Add New Store"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Distributor notice (creating from mobile-equivalent path) */}
        {callerRole === "distributor" && !isEdit && (
          <div className="mx-5 mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            New stores require Super Admin approval before becoming visible.
          </div>
        )}

        {/* Reviewer notice — explains the review workflow to the SA */}
        {isReview && (
          <div className="mx-5 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Submitted by{" "}
                  {store?.distributor_name ?? "the distributor"}
                </p>
                <p className="mt-0.5 text-xs">
                  Make any corrections below if needed, then approve to
                  activate or reject with a reason.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable form body */}
        <form
          id="store-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-5 space-y-5"
        >
          {/* ── Store Name ──────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-name">
              Store Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sf-name"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="e.g. Krishna General Store"
              required
            />
          </div>

          {/* ── Owner Name ──────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-owner">Owner Name</Label>
            <Input
              id="sf-owner"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. Ramesh Patel"
            />
          </div>

          {/* ── Phone ───────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-phone">Phone (10 digits)</Label>
            <Input
              id="sf-phone"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              placeholder="9876543210"
              inputMode="numeric"
            />
          </div>

          {/* ── Address ─────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-address">Address</Label>
            <textarea
              id="sf-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full street address…"
              rows={3}
              className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* ── Zone ────────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-zone">
              Zone <span className="text-destructive">*</span>
            </Label>
            {areaLocked ? (
              /* Lock icon for non-SA in edit mode */
              <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                {store?.zone_name ?? "—"}
                <span className="ml-auto text-[11px]">
                  SA only
                </span>
              </div>
            ) : (
              <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setAreaId(""); }}>
                <SelectTrigger id="sf-zone">
                  <SelectValue placeholder="Select zone…" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ── Area ────────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="sf-area">
              Area <span className="text-destructive">*</span>
            </Label>
            {areaLocked ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                {store?.area_name ?? "—"}
                <span className="ml-auto text-[11px]">SA only</span>
              </div>
            ) : (
              <Select
                value={areaId}
                onValueChange={setAreaId}
                disabled={!zoneId || areasLoading}
              >
                <SelectTrigger id="sf-area">
                  <SelectValue
                    placeholder={
                      !zoneId
                        ? "Select a zone first"
                        : areasLoading
                        ? "Loading areas…"
                        : areas.length === 0
                        ? "No areas in this zone"
                        : "Select area…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ── Assigned Distributor ────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Assigned Distributor</Label>
            <DistributorPicker
              areaId={areaId}
              value={distributorId}
              onChange={(id) => setDistributorId(id)}
              disabled={!areaId}
            />
            <p className="text-xs text-muted-foreground">
              Distributors filtered by selected area.
            </p>
          </div>

          {/* ── GPS Capture ─────────────────────────────────────────────────── */}
          <GpsCapture
            onCapture={handleGpsCapture}
            initialLat={store?.gps_lat}
            initialLng={store?.gps_lng}
          />

          {/* ── Shop Photo ──────────────────────────────────────────────────── */}
          {/* In edit mode, seed with the existing photo URL so the SA can
              see the distributor's submission without being forced to retake.
              The component treats the seed URL as "captured" — capture
              callback only fires if the SA actually takes a new photo. */}
          <ShopPhotoCapture
            onCapture={handlePhotoCapture}
            onClear={handlePhotoClear}
            initialPhotoUrl={isEdit ? store?.photo_url ?? null : null}
          />

          {/* ── Submit guards summary ────────────────────────────────────────── */}
          {(!areaId || !gpsReady || !photoReady) && (
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p className="font-semibold mb-1">Required before submitting:</p>
              {!areaId && <p>• Select a Zone and Area</p>}
              {!gpsReady && <p>• Capture GPS location</p>}
              {!photoReady && <p>• Take a shop photo</p>}
            </div>
          )}
        </form>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        {/* Two layouts:
            • Review mode → Reject + Save Edits + Approve (with optional
              inline reject-reason input that slides above the buttons).
            • Everything else → Cancel + Save / Add / Submit. */}
        {isReview ? (
          <div className="border-t bg-muted/20">
            {rejectOpen && (
              <div className="space-y-2 border-b border-amber-200 bg-amber-50/40 px-5 py-3 dark:bg-amber-900/10">
                <Label htmlFor="reject-reason" className="text-xs">
                  Rejection reason
                  <span className="text-destructive"> *</span>
                </Label>
                <textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tell the distributor why — e.g. blurry photo, wrong area, duplicate store…"
                  rows={2}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRejectOpen(false);
                      setRejectReason("");
                    }}
                    disabled={reviewBusy === "reject"}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={handleReject}
                    disabled={!rejectReason.trim() || reviewBusy === "reject"}
                  >
                    {reviewBusy === "reject" && (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    )}
                    Confirm Reject
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectOpen((v) => !v)}
                disabled={Boolean(reviewBusy)}
                className="text-destructive hover:border-destructive/50 hover:text-destructive"
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                Reject
              </Button>
              {/* "Save Edits" — submits the same form to update the store
                  without changing approval status. SA uses this if they
                  corrected typos but want to keep reviewing. */}
              <Button
                type="submit"
                form="store-form"
                variant="outline"
                disabled={!canSubmit || Boolean(reviewBusy)}
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Edits
              </Button>
              <Button
                type="button"
                onClick={handleApprove}
                disabled={Boolean(reviewBusy) || pending}
                className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
              >
                {reviewBusy === "approve" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                )}
                Approve
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="store-form"
              disabled={!canSubmit}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit
                ? "Save Changes"
                : callerRole === "distributor"
                ? "Submit for Approval"
                : "Add Store"}
            </Button>
          </div>
        )}
      </aside>
    </>
  );
}
