// src/app/(dashboard)/users/_components/ManageNetworkDrawer.tsx
// ---------------------------------------------------------------------------
// Slide-in drawer for managing a Super Stockist's distributor network.
//
// Shows:
//   • Current distributors in the SS network (with Remove button each).
//   • "Add Distributor" search input filtered to unassigned distributors.
//
// Business rule:
//   Each distributor can belong to exactly ONE SS network.
//   addToNetwork() enforces this via a DB UNIQUE constraint check and returns
//   a descriptive error when a conflict is detected.
// ---------------------------------------------------------------------------

"use client";

import { useState, useEffect, useTransition } from "react";
import { X, Network, Loader2, UserMinus, UserPlus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  addToNetwork,
  removeFromNetwork,
  getNetworkDistributors,
  getUnassignedDistributors,
  type UserRow,
  type NetworkDistributor,
} from "../actions";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ManageNetworkDrawerProps {
  ss: UserRow;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ManageNetworkDrawer({ ss, onClose }: ManageNetworkDrawerProps) {
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const [networkDists, setNetworkDists] = useState<NetworkDistributor[]>([]);
  const [unassigned, setUnassigned] = useState<
    { id: string; full_name: string | null; phone: string | null }[]
  >([]);
  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [loadingUnassigned, setLoadingUnassigned] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  // ── Load data on mount ────────────────────────────────────────────────────

  useEffect(() => {
    setLoadingNetwork(true);
    getNetworkDistributors(ss.id).then((data) => {
      setNetworkDists(data);
      setLoadingNetwork(false);
    });

    setLoadingUnassigned(true);
    getUnassignedDistributors().then((data) => {
      setUnassigned(data);
      setLoadingUnassigned(false);
    });
  }, [ss.id]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleRemove(distId: string, distName: string | null) {
    setRemovingId(distId);
    const result = await removeFromNetwork(ss.id, distId);
    setRemovingId(null);

    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    // Move from network → unassigned
    const removed = networkDists.find((d) => d.id === distId);
    setNetworkDists((prev) => prev.filter((d) => d.id !== distId));
    if (removed) {
      setUnassigned((prev) => [
        { id: removed.id, full_name: removed.full_name, phone: removed.phone },
        ...prev,
      ]);
    }
    toast({ title: "Removed from network", description: `${distName ?? "Distributor"} removed.` });
  }

  async function handleAdd(distId: string, distName: string | null) {
    setAddingId(distId);
    const result = await addToNetwork(ss.id, distId);
    setAddingId(null);

    if (!result.success) {
      toast({ title: "Cannot add", description: result.error, variant: "destructive" });
      return;
    }

    // Move from unassigned → network (simplified — reloads full network record)
    setUnassigned((prev) => prev.filter((d) => d.id !== distId));
    // Reload network to get full data including zone/area
    startTransition(async () => {
      const updated = await getNetworkDistributors(ss.id);
      setNetworkDists(updated);
    });
    toast({ title: "Added to network", description: `${distName ?? "Distributor"} added.` });
  }

  // ── Filtered unassigned list ───────────────────────────────────────────────
  const filteredUnassigned = unassigned.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.full_name?.toLowerCase().includes(q) ||
      d.phone?.includes(q)
    );
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Drawer ────────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Manage network for ${ss.full_name}`}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col",
          "bg-background shadow-2xl",
          "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Network className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              Manage Network — {ss.full_name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {networkDists.length} distributor{networkDists.length !== 1 ? "s" : ""} in network
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Current network ─────────────────────────────────────────── */}
          <section className="border-b p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current Network
            </h3>

            {loadingNetwork ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : networkDists.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No distributors in this network yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {networkDists.map((dist) => (
                  <li
                    key={dist.id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {dist.full_name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dist.phone ?? "—"}
                        {dist.zone_name && (
                          <> · {[dist.zone_name, dist.area_name].filter(Boolean).join(" / ")}</>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={removingId === dist.id}
                      onClick={() => handleRemove(dist.id, dist.full_name)}
                      className="h-7 shrink-0 px-2 text-xs text-destructive hover:border-destructive/40 hover:text-destructive"
                    >
                      {removingId === dist.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <UserMinus className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Add distributor ─────────────────────────────────────────── */}
          <section className="p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add Distributor
            </h3>

            {/* Search input */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or phone…"
                className="pl-8"
              />
            </div>

            {loadingUnassigned ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUnassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? "No unassigned distributors match your search."
                  : "All distributors are already assigned to a network."}
              </p>
            ) : (
              <ul className="space-y-2">
                {filteredUnassigned.map((dist) => (
                  <li
                    key={dist.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {dist.full_name ?? "Unknown"}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {dist.phone ?? "—"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={addingId === dist.id}
                      onClick={() => handleAdd(dist.id, dist.full_name)}
                      className="h-7 shrink-0 px-2 text-xs"
                    >
                      {addingId === dist.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="mr-1 h-3.5 w-3.5" />
                          Add
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-4">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </>
  );
}
