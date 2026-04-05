// src/app/(dashboard)/master/_components/ZoneAreaClient.tsx
// ---------------------------------------------------------------------------
// Client Component — interactive split-panel for Zone & Area management.
//
// Left panel  : List of zones. Click to select. Click name to edit inline.
//               Add Zone button. Delete button (zones with areas are blocked).
// Right panel : Areas for the selected zone. Click name to edit inline.
//               Add Area button. Delete button.
//
// Inline editing pattern:
//   - Normal state: name rendered as plain text with a pencil icon on hover.
//   - Editing state: text input pre-filled with current name.
//     • Enter / blur → save via server action.
//     • Escape       → cancel and revert.
// ---------------------------------------------------------------------------

"use client";

import { useState, useRef, useEffect, useTransition, useCallback } from "react";
import { Plus, Trash2, MapPin, Layers, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createZone,
  updateZone,
  deleteZone,
  createArea,
  updateArea,
  deleteArea,
  getAreas,
  type Zone,
  type Area,
} from "../actions";
import { useToast } from "@/hooks/use-toast";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ZoneAreaClientProps {
  initialZones: Zone[];
}

// ─── Inline editable row ──────────────────────────────────────────────────────

interface EditableRowProps {
  id: string;
  name: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onSave: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canDelete?: boolean;
  cantDeleteReason?: string;
  badge?: string;
  isSaving?: boolean;
}

function EditableRow({
  id,
  name,
  isSelected,
  onSelect,
  onSave,
  onDelete,
  canDelete = true,
  cantDeleteReason,
  badge,
  isSaving,
}: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external name changes
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commitEdit() {
    if (value.trim() === name.trim()) {
      setEditing(false);
      return;
    }
    if (!value.trim()) {
      setValue(name);
      setEditing(false);
      return;
    }
    setEditing(false);
    await onSave(id, value.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === "Escape") {
      setValue(name);
      setEditing(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canDelete) return;
    setDeleting(true);
    await onDelete(id);
    setDeleting(false);
  }

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect(); } : undefined}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors",
        onSelect && "cursor-pointer",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "min-w-0 flex-1 rounded border bg-background px-2 py-0.5 text-sm text-foreground outline-none ring-1 ring-primary",
            isSelected && "bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60"
          )}
          maxLength={100}
          autoComplete="off"
        />
      ) : (
        <button
          onClick={startEdit}
          title="Click to rename"
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm font-medium",
            isSelected
              ? "text-primary-foreground"
              : "text-foreground"
          )}
        >
          {name}
        </button>
      )}

      {/* Badge (area count) */}
      {badge !== undefined && !editing && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            isSelected
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {badge}
        </span>
      )}

      {/* Selected chevron */}
      {isSelected && !editing && (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary-foreground/70" />
      )}

      {/* Saving spinner */}
      {isSaving && (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}

      {/* Delete button */}
      {!editing && (
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          title={!canDelete ? cantDeleteReason : "Delete"}
          className={cn(
            "shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100",
            isSelected && "opacity-100",
            canDelete
              ? "text-destructive/70 hover:text-destructive"
              : "cursor-not-allowed text-muted-foreground/40",
            "focus-visible:opacity-100"
          )}
          aria-label="Delete"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

// ─── Add-item row ─────────────────────────────────────────────────────────────

interface AddRowProps {
  placeholder: string;
  onAdd: (name: string) => Promise<void>;
}

function AddRow({ placeholder, onAdd }: AddRowProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startAdding() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function commit() {
    if (!value.trim()) {
      cancel();
      return;
    }
    setSaving(true);
    await onAdd(value.trim());
    setSaving(false);
    setValue("");
    setOpen(false);
  }

  function cancel() {
    setValue("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") cancel();
  }

  if (open) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={100}
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none ring-1 ring-primary"
          autoComplete="off"
          disabled={saving}
        />
        {saving && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <button
      onClick={startAdding}
      className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Plus className="h-3.5 w-3.5" />
      <span>Add {placeholder.replace("Zone name…", "zone").replace("Area name…", "area")}</span>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ZoneAreaClient({ initialZones }: ZoneAreaClientProps) {
  const { toast } = useToast();
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(
    initialZones[0]?.id ?? null
  );
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);
  const [savingZoneId, setSavingZoneId] = useState<string | null>(null);
  const [savingAreaId, setSavingAreaId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Load areas whenever selected zone changes ──────────────────────────────
  const loadAreas = useCallback(async (zoneId: string) => {
    setAreasLoading(true);
    const fetched = await getAreas(zoneId);
    setAreas(fetched);
    setAreasLoading(false);
  }, []);

  useEffect(() => {
    if (selectedZoneId) {
      loadAreas(selectedZoneId);
    } else {
      setAreas([]);
    }
  }, [selectedZoneId, loadAreas]);

  // ── Zone actions ──────────────────────────────────────────────────────────

  async function handleAddZone(name: string) {
    const result = await createZone(name);
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    // Optimistically add — re-fetch to get area_count
    startTransition(async () => {
      const { getZones } = await import("../actions");
      const updated = await getZones();
      setZones(updated);
      if (result.data?.id) setSelectedZoneId(result.data.id);
    });
    toast({ title: "Zone created", description: `"${name}" has been added.` });
  }

  async function handleUpdateZone(id: string, newName: string) {
    setSavingZoneId(id);
    const result = await updateZone(id, newName);
    setSavingZoneId(null);
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    setZones((prev) =>
      prev.map((z) => (z.id === id ? { ...z, name: newName } : z))
    );
  }

  async function handleDeleteZone(id: string) {
    const result = await deleteZone(id);
    if (!result.success) {
      toast({ title: "Cannot delete zone", description: result.error, variant: "destructive" });
      return;
    }
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (selectedZoneId === id) {
      const remaining = zones.filter((z) => z.id !== id);
      setSelectedZoneId(remaining[0]?.id ?? null);
    }
    toast({ title: "Zone deleted" });
  }

  // ── Area actions ──────────────────────────────────────────────────────────

  async function handleAddArea(name: string) {
    if (!selectedZoneId) return;
    const result = await createArea(selectedZoneId, name);
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    await loadAreas(selectedZoneId);
    // Bump zone area_count
    setZones((prev) =>
      prev.map((z) =>
        z.id === selectedZoneId ? { ...z, area_count: z.area_count + 1 } : z
      )
    );
    toast({ title: "Area created", description: `"${name}" has been added.` });
  }

  async function handleUpdateArea(id: string, newName: string) {
    setSavingAreaId(id);
    const result = await updateArea(id, newName);
    setSavingAreaId(null);
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    setAreas((prev) =>
      prev.map((a) => (a.id === id ? { ...a, name: newName } : a))
    );
  }

  async function handleDeleteArea(id: string) {
    if (!selectedZoneId) return;
    const result = await deleteArea(id);
    if (!result.success) {
      toast({ title: "Cannot delete area", description: result.error, variant: "destructive" });
      return;
    }
    setAreas((prev) => prev.filter((a) => a.id !== id));
    setZones((prev) =>
      prev.map((z) =>
        z.id === selectedZoneId ? { ...z, area_count: Math.max(0, z.area_count - 1) } : z
      )
    );
    toast({ title: "Area deleted" });
  }

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ── LEFT: Zone list ──────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Panel header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <MapPin className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Zones</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {zones.length} zone{zones.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Zone rows */}
        <div className="min-h-[280px] p-2">
          {zones.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
              <MapPin className="mb-2 h-8 w-8 opacity-30" />
              No zones yet. Add your first zone below.
            </div>
          ) : (
            <div className="space-y-0.5">
              {zones.map((zone) => (
                <EditableRow
                  key={zone.id}
                  id={zone.id}
                  name={zone.name}
                  isSelected={zone.id === selectedZoneId}
                  onSelect={() => setSelectedZoneId(zone.id)}
                  onSave={handleUpdateZone}
                  onDelete={handleDeleteZone}
                  canDelete={zone.area_count === 0}
                  cantDeleteReason="Remove all areas first"
                  badge={String(zone.area_count)}
                  isSaving={savingZoneId === zone.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add zone row */}
        <div className="border-t p-2">
          <AddRow placeholder="Zone name…" onAdd={handleAddZone} />
        </div>
      </div>

      {/* ── RIGHT: Area list ─────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Panel header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {selectedZone
              ? `Areas — ${selectedZone.name}`
              : "Areas"}
          </h2>
          {selectedZone && (
            <span className="ml-auto text-xs text-muted-foreground">
              {areas.length} area{areas.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Area rows */}
        <div className="min-h-[280px] p-2">
          {!selectedZoneId ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
              <Layers className="mb-2 h-8 w-8 opacity-30" />
              Select a zone to manage its areas.
            </div>
          ) : areasLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : areas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
              <Layers className="mb-2 h-8 w-8 opacity-30" />
              No areas in this zone yet.
            </div>
          ) : (
            <div className="space-y-0.5">
              {areas.map((area) => (
                <EditableRow
                  key={area.id}
                  id={area.id}
                  name={area.name}
                  onSave={handleUpdateArea}
                  onDelete={handleDeleteArea}
                  isSaving={savingAreaId === area.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add area row */}
        <div className="border-t p-2">
          {selectedZoneId ? (
            <AddRow placeholder="Area name…" onAdd={handleAddArea} />
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Select a zone to add areas.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
