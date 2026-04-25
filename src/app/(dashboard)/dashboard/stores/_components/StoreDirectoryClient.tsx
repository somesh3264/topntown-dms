// src/app/(dashboard)/stores/_components/StoreDirectoryClient.tsx
// ---------------------------------------------------------------------------
// Client Component — interactive Store Directory table with:
//   • Zone → Area cascading filter dropdowns
//   • Active / Inactive toggle
//   • Search by store name
//   • Role-scoped column visibility (SA/SS see all; SP sees their area)
//   • "Add Store" button → StoreForm slide-over
//   • Edit and Deactivate/Activate row actions
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import {
  PlusCircle,
  Search,
  MapPin,
  CheckCircle2,
  XCircle,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Store,
  Filter,
  Clock,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { StoreForm } from "@/components/stores/StoreForm";
import {
  deactivateStore,
  activateStore,
  getAreasForZone,
  type StoreRow,
  type AppRole,
} from "../actions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreDirectoryClientProps {
  initialStores: StoreRow[];
  zones: { id: string; name: string }[];
  callerRole: AppRole;
  // pendingApprovalCount used to drive the top banner; now the count comes
  // from `pendingStores.length` which is derived locally from the same store
  // list, so the prop is no longer needed.
}

// "pending" used to be a status filter; now it's its own section above the
// directory so the dropdown only governs the main (non-pending) list.
type StatusFilter = "all" | "active" | "inactive";

// ─── Component ────────────────────────────────────────────────────────────────

export function StoreDirectoryClient({
  initialStores,
  zones,
  callerRole,
}: StoreDirectoryClientProps) {
  const { toast } = useToast();

  const [stores, setStores] = useState<StoreRow[]>(initialStores);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StoreRow | null>(null);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterZoneId, setFilterZoneId] = useState("all");
  const [filterAreaId, setFilterAreaId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterAreas, setFilterAreas] = useState<
    { id: string; name: string }[]
  >([]);

  // Load areas when zone filter changes
  useEffect(() => {
    if (!filterZoneId || filterZoneId === "all") {
      setFilterAreas([]);
      setFilterAreaId("all");
      return;
    }
    getAreasForZone(filterZoneId).then(setFilterAreas);
    setFilterAreaId("all");
  }, [filterZoneId]);

  // ── Derived split lists ───────────────────────────────────────────────────
  // The directory is rendered as two separate tables for SA users:
  //   • pendingStores → top card, shown whenever SA has any pending approvals.
  //     Filters (zone/area/search) still apply so the queue stays scoped.
  //   • mainStores → bottom card, everything that's NOT pending. The Status
  //     filter only narrows this list (Active/Inactive/All).
  // Non-SA roles see only the main list (no pending section); pending stores
  // never appear in their RLS scope anyway.
  const sharedFilter = (s: StoreRow) => {
    if (filterAreaId !== "all" && s.area_id !== filterAreaId) return false;
    if (
      filterZoneId !== "all" &&
      filterAreaId === "all" &&
      s.zone_id !== filterZoneId
    )
      return false;
    if (
      search.trim() &&
      !s.name.toLowerCase().includes(search.trim().toLowerCase())
    )
      return false;
    return true;
  };

  const pendingStores = useMemo(() => {
    if (callerRole !== "super_admin") return [] as StoreRow[];
    return stores.filter(
      (s) => s.approval_status === "pending" && sharedFilter(s)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, callerRole, filterAreaId, filterZoneId, search]);

  const mainStores = useMemo(() => {
    return stores.filter((s) => {
      // Pending stores live in their own card for SA — exclude them here.
      if (callerRole === "super_admin" && s.approval_status === "pending") {
        return false;
      }
      if (!sharedFilter(s)) return false;
      if (filterStatus === "active" && !s.is_active) return false;
      if (filterStatus === "inactive" && s.is_active) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, callerRole, filterStatus, filterAreaId, filterZoneId, search]);

  // ── Deactivate / Activate ─────────────────────────────────────────────────
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggleActive(store: StoreRow) {
    setTogglingId(store.id);
    const result = store.is_active
      ? await deactivateStore(store.id)
      : await activateStore(store.id);

    setTogglingId(null);

    if (!result.success) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
      return;
    }

    setStores((prev) =>
      prev.map((s) =>
        s.id === store.id ? { ...s, is_active: !store.is_active } : s
      )
    );
    toast({
      title: store.is_active ? "Store deactivated" : "Store activated",
      description: `${store.name} is now ${store.is_active ? "inactive" : "active"}.`,
    });
  }

  // ── Store created/edited callback ─────────────────────────────────────────
  function handleStoreSuccess(updated: Partial<StoreRow> & { id: string }) {
    setStores((prev) => {
      const exists = prev.find((s) => s.id === updated.id);
      if (exists) {
        return prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s));
      }
      // New store — prepend.
      // Approval status is null for SA/SP-created stores (no approval row);
      // photo URL is unknown client-side because uploads happen server-side
      // — the next page refresh will pick up the real values.
      return [
        {
          id: updated.id,
          name: updated.name ?? "",
          owner_name: updated.owner_name ?? null,
          phone: updated.phone ?? null,
          address: updated.address ?? null,
          gps_lat: updated.gps_lat ?? null,
          gps_lng: updated.gps_lng ?? null,
          area_id: updated.area_id ?? "",
          area_name: updated.area_name ?? null,
          zone_id: updated.zone_id ?? null,
          zone_name: updated.zone_name ?? null,
          primary_distributor_id: updated.primary_distributor_id ?? null,
          distributor_name: updated.distributor_name ?? null,
          is_active: updated.is_active ?? true,
          onboarded_by: updated.onboarded_by ?? "",
          created_at: updated.created_at ?? new Date().toISOString(),
          approval_status: updated.approval_status ?? null,
          approval_id: updated.approval_id ?? null,
          photo_url: updated.photo_url ?? null,
        },
        ...prev,
      ];
    });
    setAddOpen(false);
    setEditTarget(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* The pending-approvals banner that used to live here is now replaced by
          the dedicated Pending Approvals card below — same information, with
          actionable rows instead of a link out to a separate page. */}

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stores…"
            className="pl-8"
          />
        </div>

        {/* Zone filter */}
        <Select
          value={filterZoneId}
          onValueChange={(v) => setFilterZoneId(v)}
        >
          <SelectTrigger className="w-40">
            <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="All zones" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Zones</SelectItem>
            {zones.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Area filter (cascading) */}
        <Select
          value={filterAreaId}
          onValueChange={setFilterAreaId}
          disabled={filterZoneId === "all"}
        >
          <SelectTrigger className="w-40">
            <SelectValue
              placeholder={
                filterZoneId === "all" ? "Select zone first" : "All Areas"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Areas</SelectItem>
            {filterAreas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status toggle */}
        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {/* Add Store */}
        <Button onClick={() => setAddOpen(true)} size="sm" className="ml-auto">
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Store
        </Button>
      </div>

      {/* ── Pending Approvals card (SA only, only if there are any) ─────────── */}
      {callerRole === "super_admin" && pendingStores.length > 0 && (
        <StoreTableCard
          title="Pending Approvals"
          subtitle={
            pendingStores.length === 1
              ? "1 store waiting for your review"
              : `${pendingStores.length} stores waiting for your review`
          }
          accent="amber"
          stores={pendingStores}
          callerRole={callerRole}
          togglingId={togglingId}
          onEdit={(s) => setEditTarget(s)}
          onToggleActive={(s) => handleToggleActive(s)}
          // Empty-state copy not needed here — the card is only mounted when
          // pendingStores.length > 0.
          emptyHint=""
          countSuffix="pending"
        />
      )}

      {/* ── Main directory ──────────────────────────────────────────────────── */}
      <StoreTableCard
        title={callerRole === "super_admin" ? "All Stores" : undefined}
        subtitle={undefined}
        accent="default"
        stores={mainStores}
        callerRole={callerRole}
        togglingId={togglingId}
        onEdit={(s) => setEditTarget(s)}
        onToggleActive={(s) => handleToggleActive(s)}
        emptyHint={
          search || filterZoneId !== "all" || filterStatus !== "all"
            ? "Try clearing your filters."
            : ""
        }
        // Show "X of Y" relative to the non-pending universe so it doesn't
        // double-count rows with the pending card above.
        countSuffix={
          callerRole === "super_admin"
            ? `of ${stores.filter((s) => s.approval_status !== "pending").length}`
            : `of ${stores.length}`
        }
      />

      {/* ── Slide-over: Add Store ─────────────────────────────────────────────── */}
      {addOpen && (
        <StoreForm
          zones={zones}
          callerRole={callerRole}
          onSuccess={handleStoreSuccess}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* ── Slide-over: Edit Store ────────────────────────────────────────────── */}
      {editTarget && (
        <StoreForm
          store={editTarget}
          zones={zones}
          callerRole={callerRole}
          onSuccess={handleStoreSuccess}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  );
}

// ─── Reusable Table Card ──────────────────────────────────────────────────────
//
// Wraps the store table in a card with an optional title bar. We render this
// twice on the page (Pending Approvals on top, All Stores below) to keep the
// two queues visually separate without duplicating ~60 lines of <table>.

interface StoreTableCardProps {
  title?: string;
  subtitle?: string;
  /** "amber" gives the pending card an amber-tinted header strip. */
  accent: "amber" | "default";
  stores: StoreRow[];
  callerRole: AppRole;
  togglingId: string | null;
  onEdit: (s: StoreRow) => void;
  onToggleActive: (s: StoreRow) => void;
  emptyHint: string;
  countSuffix: string;
}

function StoreTableCard({
  title,
  subtitle,
  accent,
  stores,
  callerRole,
  togglingId,
  onEdit,
  onToggleActive,
  emptyHint,
  countSuffix,
}: StoreTableCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden",
        accent === "amber" && "border-amber-200 dark:border-amber-700/50"
      )}
    >
      {/* Header strip — only when we have a title. The pending card always
          shows a header so the SA's eye lands there first. */}
      {title && (
        <div
          className={cn(
            "flex items-center justify-between border-b px-4 py-3",
            accent === "amber"
              ? "bg-amber-50 dark:bg-amber-900/10"
              : "bg-muted/30"
          )}
        >
          <div>
            <h2
              className={cn(
                "text-sm font-semibold",
                accent === "amber"
                  ? "text-amber-800 dark:text-amber-300"
                  : "text-foreground"
              )}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className={cn(
                  "text-xs",
                  accent === "amber"
                    ? "text-amber-700/80 dark:text-amber-400/80"
                    : "text-muted-foreground"
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
          {accent === "amber" && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-500 px-2 text-[11px] font-bold text-white">
              <Clock className="h-3 w-3" />
              {stores.length}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Store Name
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Owner
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Phone
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Area
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Distributor
              </th>
              <th className="px-4 py-3 text-center font-semibold text-muted-foreground">
                GPS
              </th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {stores.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-16 text-center text-muted-foreground"
                >
                  <Store className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  No stores found.
                  {emptyHint && <p className="mt-1 text-xs">{emptyHint}</p>}
                </td>
              </tr>
            ) : (
              stores.map((store) => (
                <StoreTableRow
                  key={store.id}
                  store={store}
                  callerRole={callerRole}
                  toggling={togglingId === store.id}
                  onEdit={() => onEdit(store)}
                  onToggleActive={() => onToggleActive(store)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {stores.length} {countSuffix}
      </div>
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

interface StoreTableRowProps {
  store: StoreRow;
  callerRole: AppRole;
  toggling: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}

function StoreTableRow({
  store,
  callerRole,
  toggling,
  onEdit,
  onToggleActive,
}: StoreTableRowProps) {
  const hasGps = store.gps_lat !== null && store.gps_lng !== null;
  const canModify =
    callerRole === "super_admin" || callerRole === "sales_person";

  const areaZone = [store.zone_name, store.area_name]
    .filter(Boolean)
    .join(" / ");

  return (
    <tr
      className={cn(
        "transition-colors hover:bg-muted/20",
        !store.is_active && "opacity-60"
      )}
    >
      {/* Store Name */}
      <td className="px-4 py-3 font-medium text-foreground">
        <div className="flex items-center gap-2">
          {store.name}
        </div>
      </td>

      {/* Owner */}
      <td className="px-4 py-3 text-muted-foreground">
        {store.owner_name ?? "—"}
      </td>

      {/* Phone */}
      <td className="px-4 py-3 font-mono text-muted-foreground">
        {store.phone ?? "—"}
      </td>

      {/* Area */}
      <td className="px-4 py-3 text-muted-foreground text-xs">
        {areaZone || "—"}
      </td>

      {/* Distributor */}
      <td className="px-4 py-3 text-muted-foreground">
        {store.distributor_name ?? (
          <span className="italic text-xs">Unassigned</span>
        )}
      </td>

      {/* GPS badge */}
      <td className="px-4 py-3 text-center">
        {hasGps ? (
          <a
            href={`https://www.openstreetmap.org/?mlat=${store.gps_lat}&mlon=${store.gps_lng}#map=16/${store.gps_lat}/${store.gps_lng}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Lat: ${store.gps_lat}, Lng: ${store.gps_lng}`}
            className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
          >
            <MapPin className="h-3 w-3" />
            Yes
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <XCircle className="h-3 w-3" />
            No
          </span>
        )}
      </td>

      {/* Status — three-state pill: Pending / Active / Inactive.
          Pending takes priority over is_active because a freshly-submitted
          mobile store has is_active = false AND approval_status = 'pending'
          — we want it to render as "Pending Approval" rather than just
          "Inactive". A rejected store still shows as Inactive (it was
          declined, not waiting). */}
      <td className="px-4 py-3">
        {store.approval_status === "pending" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            Pending Approval
          </span>
        ) : store.is_active ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Inactive
          </span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {/* Review — opens the edit slide-over with all distributor-submitted
              details (form fields + photo). The form detects approval_status
              === 'pending' and adds Approve / Reject CTAs to its footer, so
              the SA can edit-and-approve in one place without leaving the
              directory. */}
          {callerRole === "super_admin" && store.approval_status === "pending" && (
            <Button
              size="sm"
              onClick={onEdit}
              className="h-7 gap-1 bg-amber-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-amber-700"
              title="Review and approve / reject this submission"
            >
              <Eye className="h-3.5 w-3.5" />
              Review
            </Button>
          )}

          {/* Edit */}
          {canModify && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              className="h-7 px-2 text-xs"
              title="Edit store"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Activate / Deactivate — hidden for pending rows; the Approve flow
              on the approvals page handles activation, and a manual toggle
              here would short-circuit the workflow. */}
          {callerRole === "super_admin" && store.approval_status !== "pending" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleActive}
              disabled={toggling}
              className={cn(
                "h-7 px-2 text-xs",
                store.is_active
                  ? "text-destructive hover:border-destructive/50 hover:text-destructive"
                  : "text-green-600 hover:border-green-300 hover:text-green-700"
              )}
              title={store.is_active ? "Deactivate store" : "Activate store"}
            >
              {store.is_active ? (
                <ToggleLeft className="h-3.5 w-3.5" />
              ) : (
                <ToggleRight className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
