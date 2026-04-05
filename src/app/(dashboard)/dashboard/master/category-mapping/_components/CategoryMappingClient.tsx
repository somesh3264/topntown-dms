// src/app/(dashboard)/master/category-mapping/_components/CategoryMappingClient.tsx
// ---------------------------------------------------------------------------
// Client Component for the Category → Distributor mapping table.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { Shield, ShieldOff, Trash2, Plus, Check, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  assignCategoryDistributor,
  removeCategoryDistributor,
} from "@/app/(dashboard)/dashboard/products/actions";
import type {
  CategoryDistributorMapping,
  Distributor,
  ProductCategory,
} from "@/app/(dashboard)/dashboard/products/actions";
import { toast } from "@/hooks/use-toast";

// ─── All categories the system knows about ────────────────────────────────────

const ALL_CATEGORIES: ProductCategory[] = [
  "Bread",
  "Biscuits",
  "Cakes",
  "Rusk",
  "Other",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface CategoryMappingClientProps {
  mappings: CategoryDistributorMapping[];
  distributors: Distributor[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Group mappings by category */
function groupByCategory(
  mappings: CategoryDistributorMapping[]
): Record<string, CategoryDistributorMapping[]> {
  const map: Record<string, CategoryDistributorMapping[]> = {};
  for (const m of mappings) {
    if (!map[m.category]) map[m.category] = [];
    map[m.category].push(m);
  }
  return map;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CategoryMappingClient({
  mappings,
  distributors,
}: CategoryMappingClientProps) {
  // Local optimistic state — start from server data
  const [localMappings, setLocalMappings] =
    useState<CategoryDistributorMapping[]>(mappings);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCategory, setDialogCategory] = useState<ProductCategory>("Bread");
  const [selectedDistId, setSelectedDistId] = useState("");
  const [isExclusive, setIsExclusive] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const grouped = groupByCategory(localMappings);

  // ── Open assign dialog ─────────────────────────────────────────────────────
  function openAssignDialog(category: ProductCategory) {
    setDialogCategory(category);
    setSelectedDistId("");
    setIsExclusive(true);
    setDialogOpen(true);
  }

  // ── Assign handler ─────────────────────────────────────────────────────────
  async function handleAssign() {
    if (!selectedDistId) {
      toast({ title: "Please select a distributor", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      const result = await assignCategoryDistributor(
        dialogCategory,
        selectedDistId,
        isExclusive
      );

      if (result.success) {
        // Optimistic update
        const dist = distributors.find((d) => d.id === selectedDistId);
        const existing = localMappings.find(
          (m) => m.category === dialogCategory && m.distributor_id === selectedDistId
        );
        if (!existing) {
          setLocalMappings((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              category: dialogCategory,
              distributor_id: selectedDistId,
              distributor_name: dist?.full_name ?? selectedDistId,
              is_exclusive: isExclusive,
              created_at: new Date().toISOString(),
            },
          ]);
        } else {
          setLocalMappings((prev) =>
            prev.map((m) =>
              m.id === existing.id ? { ...m, is_exclusive: isExclusive } : m
            )
          );
        }

        toast({ title: "Mapping saved!", variant: "default" });
        setDialogOpen(false);
      } else {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  // ── Toggle exclusivity inline ──────────────────────────────────────────────
  async function handleToggleExclusive(mapping: CategoryDistributorMapping) {
    startTransition(async () => {
      const result = await assignCategoryDistributor(
        mapping.category,
        mapping.distributor_id,
        !mapping.is_exclusive
      );
      if (result.success) {
        setLocalMappings((prev) =>
          prev.map((m) =>
            m.id === mapping.id
              ? { ...m, is_exclusive: !m.is_exclusive }
              : m
          )
        );
        toast({
          title: mapping.is_exclusive
            ? "Switched to Shared"
            : "Switched to Exclusive",
          variant: "default",
        });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    });
  }

  // ── Remove handler ─────────────────────────────────────────────────────────
  async function handleRemove(mapping: CategoryDistributorMapping) {
    if (
      !confirm(
        `Remove ${mapping.distributor_name ?? mapping.distributor_id} from ${mapping.category}?`
      )
    )
      return;

    setRemovingId(mapping.id);
    startTransition(async () => {
      const result = await removeCategoryDistributor(
        mapping.category,
        mapping.distributor_id
      );
      if (result.success) {
        setLocalMappings((prev) => prev.filter((m) => m.id !== mapping.id));
        toast({ title: "Mapping removed", variant: "default" });
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
      setRemovingId(null);
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Summary cards per category */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_CATEGORIES.map((cat) => {
          const catMappings = grouped[cat] ?? [];
          const hasExclusive = catMappings.some((m) => m.is_exclusive);

          return (
            <div
              key={cat}
              className="rounded-xl border bg-card p-4 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{cat}</span>
                  {hasExclusive && (
                    <Badge variant="secondary" className="text-[10px] text-blue-700 bg-blue-100">
                      <Shield className="h-2.5 w-2.5 mr-0.5" />
                      Exclusive
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openAssignDialog(cat)}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Assign
                </Button>
              </div>

              {catMappings.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No distributor assigned — open to all.
                </p>
              ) : (
                <ul className="space-y-2">
                  {catMappings.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {m.distributor_name ?? m.distributor_id}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {m.is_exclusive ? "Exclusive" : "Shared"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Switch
                          checked={m.is_exclusive}
                          onCheckedChange={() => handleToggleExclusive(m)}
                          disabled={isPending}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={removingId === m.id}
                          onClick={() => handleRemove(m)}
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Full table view ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">All Mappings</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Distributor</TableHead>
              <TableHead>Exclusivity</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {localMappings.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-20 text-center text-muted-foreground text-sm"
                >
                  No mappings configured. Use the cards above to assign distributors.
                </TableCell>
              </TableRow>
            ) : (
              localMappings.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.category}</TableCell>
                  <TableCell>
                    {m.distributor_name ?? m.distributor_id}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={m.is_exclusive}
                        onCheckedChange={() => handleToggleExclusive(m)}
                        disabled={isPending}
                      />
                      <span className="text-xs text-muted-foreground">
                        {m.is_exclusive ? (
                          <span className="flex items-center gap-1 text-blue-700 font-medium">
                            <Shield className="h-3 w-3" /> Exclusive
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <ShieldOff className="h-3 w-3" /> Shared
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(m.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={removingId === m.id}
                      onClick={() => handleRemove(m)}
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Assign Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Distributor — {dialogCategory}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Distributor select */}
            <div className="space-y-1.5">
              <Label>Select Distributor</Label>
              <select
                value={selectedDistId}
                onChange={(e) => setSelectedDistId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Choose distributor —</option>
                {distributors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name ?? d.id}
                  </option>
                ))}
              </select>
              {distributors.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active distributors found. Add distributor profiles first.
                </p>
              )}
            </div>

            {/* Exclusivity toggle */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-blue-600" />
                  Exclusive Rights
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, only this distributor can stock{" "}
                  <strong>{dialogCategory}</strong> products.
                </p>
              </div>
              <Switch
                checked={isExclusive}
                onCheckedChange={setIsExclusive}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={isPending}>
              <Check className="h-4 w-4 mr-1" />
              {isPending ? "Saving…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
