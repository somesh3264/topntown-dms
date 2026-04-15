// src/app/(dashboard)/users/_components/UsersClient.tsx
// ---------------------------------------------------------------------------
// Client Component — full User Management table with:
//   • Role-filter tabs (All | Super Stockist | Distributor | Sales Person)
//   • Add User modal (form with conditional zone/area fields + pw generator)
//   • Impersonate button → calls startImpersonation server action
//   • Deactivate / Reactivate buttons with guard feedback
//   • Manage Network button for Super Stockist rows
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition, useEffect } from "react";
import {
  UserPlus,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  Network,
  UserCheck,
  UserX,
  ShieldCheck,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  startImpersonation,
  getAreasForZone,
  type UserRow,
  type AppRole,
} from "../actions";
import { ManageNetworkDrawer } from "./ManageNetworkDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsersClientProps {
  initialUsers: UserRow[];
  zones: { id: string; name: string }[];
}

type RoleFilter = "all" | "super_stockist" | "distributor" | "sales_person";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  super_stockist: "Super Stockist",
  distributor: "Distributor",
  sales_person: "Sales Person",
};

const ROLE_BADGE_STYLES: Record<AppRole, string> = {
  super_admin:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  super_stockist:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  distributor:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  sales_person:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

function generatePassword(length = 12): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

// ─── Add User Modal ───────────────────────────────────────────────────────────

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  zones: { id: string; name: string }[];
  onSuccess: (user: UserRow) => void;
}

function AddUserModal({ open, onClose, zones, onSuccess }: AddUserModalProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AppRole | "">("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);

  // Roles that need zone/area
  const needsZone = role === "super_stockist" || role === "distributor" || role === "sales_person";
  const needsArea = role === "distributor" || role === "sales_person";

  // Load areas when zone changes
  useEffect(() => {
    if (!zoneId) { setAreas([]); setAreaId(""); return; }
    setAreasLoading(true);
    setAreaId("");
    getAreasForZone(zoneId).then((data) => {
      setAreas(data);
      setAreasLoading(false);
    });
  }, [zoneId]);

  // Reset when role changes
  useEffect(() => {
    setZoneId("");
    setAreaId("");
    setAreas([]);
  }, [role]);

  function reset() {
    setFullName(""); setPhone(""); setRole(""); setPassword("");
    setShowPw(false); setZoneId(""); setAreaId(""); setAreas([]);
  }

  function handleClose() { reset(); onClose(); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("full_name", fullName);
    fd.set("phone", phone);
    fd.set("role", role);
    fd.set("password", password);
    if (zoneId) fd.set("zone_id", zoneId);
    if (areaId) fd.set("area_id", areaId);

    startTransition(async () => {
      const result = await createUser(fd);
      if (!result.success) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "User created", description: `${fullName} has been added.` });
      // Build partial UserRow for optimistic update
      onSuccess({
        id: result.data!.id,
        full_name: fullName,
        phone,
        role: role as AppRole,
        zone_id: zoneId || null,
        zone_name: zones.find((z) => z.id === zoneId)?.name ?? null,
        area_id: areaId || null,
        area_name: areas.find((a) => a.id === areaId)?.name ?? null,
        is_active: true,
        created_at: new Date().toISOString(),
      });
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>
            Creates an auth account and profile for the new user.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="au-name">Full Name</Label>
            <Input
              id="au-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ravi Kumar"
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="au-phone">Phone (10 digits)</Label>
            <Input
              id="au-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="9876543210"
              inputMode="numeric"
              required
            />
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="au-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger id="au-role">
                <SelectValue placeholder="Select a role…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super_stockist">Super Stockist</SelectItem>
                <SelectItem value="distributor">Distributor</SelectItem>
                <SelectItem value="sales_person">Sales Person</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Zone (conditional) */}
          {needsZone && (
            <div className="space-y-1.5">
              <Label htmlFor="au-zone">Zone</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger id="au-zone">
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
            </div>
          )}

          {/* Area (conditional) */}
          {needsArea && (
            <div className="space-y-1.5">
              <Label htmlFor="au-area">Area</Label>
              <Select
                value={areaId}
                onValueChange={setAreaId}
                disabled={!zoneId || areasLoading}
              >
                <SelectTrigger id="au-area">
                  <SelectValue
                    placeholder={
                      !zoneId
                        ? "Select a zone first"
                        : areasLoading
                        ? "Loading…"
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
            </div>
          )}

          {/* Password */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="au-pw">Password</Label>
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <RefreshCw className="h-3 w-3" />
                Generate
              </button>
            </div>
            <div className="relative">
              <Input
                id="au-pw"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password && showPw && (
              <p className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                {password}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit User Modal ──────────────────────────────────────────────────────────

interface EditUserModalProps {
  user: UserRow | null;
  zones: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: (user: UserRow) => void;
}

/**
 * Edit an existing user's profile. Pre-fills from the row, omits the password
 * field (password resets live in a separate flow), and preserves the same
 * conditional Zone/Area logic as AddUserModal so roles that don't need scoping
 * don't leave stale zone/area IDs on the profile.
 *
 * When the role changes, zone & area reset just like in the Add flow. When the
 * zone changes (either manually or after a role change) we refetch the areas
 * list — but crucially, if the zone is unchanged from the initial load we do
 * NOT clear the pre-filled area. Otherwise opening the dialog for an existing
 * distributor would silently blank out their area until the user re-selects it.
 */
function EditUserModal({ user, zones, onClose, onSuccess }: EditUserModalProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AppRole | "">("");
  const [zoneId, setZoneId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);

  // Remember the user's original zone id so we know whether a zone-change
  // side-effect should clear the pre-filled area.
  const [initialZoneId, setInitialZoneId] = useState<string>("");

  const needsZone =
    role === "super_stockist" || role === "distributor" || role === "sales_person";
  const needsArea = role === "distributor" || role === "sales_person";

  // Seed form state whenever the target user changes (i.e. the modal opens).
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? "");
    setPhone(user.phone ?? "");
    setRole(user.role);
    setZoneId(user.zone_id ?? "");
    setAreaId(user.area_id ?? "");
    setInitialZoneId(user.zone_id ?? "");
    setAreas([]);
  }, [user]);

  // Load areas when zone changes. We *don't* wipe areaId when the zone matches
  // the initial load, so the pre-filled area survives the first render.
  useEffect(() => {
    if (!zoneId) {
      setAreas([]);
      setAreaId("");
      return;
    }
    setAreasLoading(true);
    if (zoneId !== initialZoneId) {
      setAreaId("");
    }
    getAreasForZone(zoneId).then((data) => {
      setAreas(data);
      setAreasLoading(false);
    });
  }, [zoneId, initialZoneId]);

  // If role changes to one that doesn't need zone/area, clear them so the
  // server action writes NULLs.
  useEffect(() => {
    if (!needsZone) {
      setZoneId("");
      setAreaId("");
      setAreas([]);
    }
    if (needsZone && !needsArea) {
      setAreaId("");
    }
  }, [role, needsZone, needsArea]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData();
    fd.set("full_name", fullName);
    fd.set("phone", phone);
    fd.set("role", role);
    if (zoneId) fd.set("zone_id", zoneId);
    if (areaId) fd.set("area_id", areaId);

    startTransition(async () => {
      const result = await updateUser(user.id, fd);
      if (!result.success) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "User updated", description: `${fullName}'s details have been saved.` });

      // Prefer the server-returned row (joined zone/area names). Fall back to a
      // locally-built row when the refresh step failed but the update didn't.
      const updated: UserRow = result.data ?? {
        ...user,
        full_name: fullName,
        phone,
        role: role as AppRole,
        zone_id: zoneId || null,
        zone_name: zones.find((z) => z.id === zoneId)?.name ?? null,
        area_id: areaId || null,
        area_name: areas.find((a) => a.id === areaId)?.name ?? null,
      };
      onSuccess(updated);
      onClose();
    });
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update this user's details. Changing the phone number also updates
            their login identifier.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="eu-name">Full Name</Label>
            <Input
              id="eu-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ravi Kumar"
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="eu-phone">Phone (10 digits)</Label>
            <Input
              id="eu-phone"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              placeholder="9876543210"
              inputMode="numeric"
              required
            />
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="eu-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger id="eu-role">
                <SelectValue placeholder="Select a role…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super_stockist">Super Stockist</SelectItem>
                <SelectItem value="distributor">Distributor</SelectItem>
                <SelectItem value="sales_person">Sales Person</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Zone (conditional) */}
          {needsZone && (
            <div className="space-y-1.5">
              <Label htmlFor="eu-zone">Zone</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger id="eu-zone">
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
            </div>
          )}

          {/* Area (conditional) */}
          {needsArea && (
            <div className="space-y-1.5">
              <Label htmlFor="eu-area">Area</Label>
              <Select
                value={areaId}
                onValueChange={setAreaId}
                disabled={!zoneId || areasLoading}
              >
                <SelectTrigger id="eu-area">
                  <SelectValue
                    placeholder={
                      !zoneId
                        ? "Select a zone first"
                        : areasLoading
                        ? "Loading…"
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
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm Deactivate Dialog ────────────────────────────────────────────────

interface ConfirmDeactivateProps {
  user: UserRow | null;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}

function ConfirmDeactivateDialog({
  user,
  onConfirm,
  onCancel,
  pending,
}: ConfirmDeactivateProps) {
  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Deactivate User?</DialogTitle>
          <DialogDescription>
            <strong>{user?.full_name}</strong> will lose access immediately.
            Open orders and deliveries will be checked before proceeding.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UsersClient({ initialUsers, zones }: UsersClientProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [tab, setTab] = useState<RoleFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [deactivatePending, startDeactivateTransition] = useTransition();
  const [networkTarget, setNetworkTarget] = useState<UserRow | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filtered = users.filter((u) => {
    if (tab === "all") return u.role !== "super_admin";
    return u.role === tab;
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleUserCreated(user: UserRow) {
    setUsers((prev) => [user, ...prev]);
  }

  function handleUserUpdated(updated: UserRow) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  function confirmDeactivate(user: UserRow) {
    setDeactivateTarget(user);
  }

  function executeDeactivate() {
    if (!deactivateTarget) return;
    const target = deactivateTarget;
    startDeactivateTransition(async () => {
      const result = await deactivateUser(target.id);
      setDeactivateTarget(null);
      if (!result.success) {
        toast({
          title: "Cannot deactivate",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, is_active: false } : u))
      );
      toast({ title: "User deactivated", description: `${target.full_name} has been deactivated.` });
    });
  }

  async function handleActivate(user: UserRow) {
    const result = await activateUser(user.id);
    if (!result.success) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, is_active: true } : u))
    );
    toast({ title: "User activated", description: `${user.full_name} is now active.` });
  }

  async function handleImpersonate(user: UserRow) {
    setImpersonatingId(user.id);
    // startImpersonation calls redirect() internally — no need to handle return
    await startImpersonation(user.id, user.role);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const TABS: { value: RoleFilter; label: string; count?: number }[] = [
    {
      value: "all",
      label: "All",
      count: users.filter((u) => u.role !== "super_admin").length,
    },
    {
      value: "super_stockist",
      label: "Super Stockist",
      count: users.filter((u) => u.role === "super_stockist").length,
    },
    {
      value: "distributor",
      label: "Distributor",
      count: users.filter((u) => u.role === "distributor").length,
    },
    {
      value: "sales_person",
      label: "Sales Person",
      count: users.filter((u) => u.role === "sales_person").length,
    },
  ];

  return (
    <>
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as RoleFilter)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                {t.label}
                {t.count !== undefined && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {t.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button onClick={() => setAddOpen(true)} size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Phone
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Zone / Area
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onEdit={setEditTarget}
                    onDeactivate={confirmDeactivate}
                    onActivate={handleActivate}
                    onImpersonate={handleImpersonate}
                    onManageNetwork={setNetworkTarget}
                    impersonating={impersonatingId === user.id}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals / Drawers ─────────────────────────────────────────────────── */}
      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        zones={zones}
        onSuccess={handleUserCreated}
      />

      <EditUserModal
        user={editTarget}
        zones={zones}
        onClose={() => setEditTarget(null)}
        onSuccess={handleUserUpdated}
      />

      <ConfirmDeactivateDialog
        user={deactivateTarget}
        onConfirm={executeDeactivate}
        onCancel={() => setDeactivateTarget(null)}
        pending={deactivatePending}
      />

      {networkTarget && (
        <ManageNetworkDrawer
          ss={networkTarget}
          onClose={() => setNetworkTarget(null)}
        />
      )}
    </>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: UserRow;
  onEdit: (u: UserRow) => void;
  onDeactivate: (u: UserRow) => void;
  onActivate: (u: UserRow) => Promise<void>;
  onImpersonate: (u: UserRow) => Promise<void>;
  onManageNetwork: (u: UserRow) => void;
  impersonating: boolean;
}

function UserRow({
  user,
  onEdit,
  onDeactivate,
  onActivate,
  onImpersonate,
  onManageNetwork,
  impersonating,
}: UserRowProps) {
  const [activating, setActivating] = useState(false);

  async function handleActivate() {
    setActivating(true);
    await onActivate(user);
    setActivating(false);
  }

  const zoneLine = [user.zone_name, user.area_name]
    .filter(Boolean)
    .join(" / ");

  return (
    <tr className={cn("transition-colors hover:bg-muted/20", !user.is_active && "opacity-60")}>
      {/* Name */}
      <td className="px-4 py-3">
        <span className="font-medium text-foreground">
          {user.full_name ?? "—"}
        </span>
      </td>

      {/* Phone */}
      <td className="px-4 py-3 font-mono text-muted-foreground">
        {user.phone ?? "—"}
      </td>

      {/* Role */}
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            ROLE_BADGE_STYLES[user.role] ?? "bg-muted text-muted-foreground"
          )}
        >
          {ROLE_LABELS[user.role] ?? user.role}
        </span>
      </td>

      {/* Zone / Area */}
      <td className="px-4 py-3 text-muted-foreground">
        {zoneLine || "—"}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            user.is_active
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              user.is_active ? "bg-green-500" : "bg-red-500"
            )}
          />
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          {/* Manage Network — SS only */}
          {user.role === "super_stockist" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onManageNetwork(user)}
              className="h-7 px-2 text-xs"
            >
              <Network className="mr-1 h-3.5 w-3.5" />
              Network
            </Button>
          )}

          {/* Edit */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(user)}
            className="h-7 px-2 text-xs"
            title="Edit user details"
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>

          {/* Impersonate */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onImpersonate(user)}
            disabled={impersonating || !user.is_active}
            className="h-7 px-2 text-xs"
            title="View as this user"
          >
            {impersonating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
            )}
            Impersonate
          </Button>

          {/* Activate / Deactivate */}
          {user.is_active ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeactivate(user)}
              className="h-7 px-2 text-xs text-destructive hover:border-destructive/50 hover:text-destructive"
            >
              <UserX className="mr-1 h-3.5 w-3.5" />
              Deactivate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleActivate}
              disabled={activating}
              className="h-7 px-2 text-xs text-green-600 hover:border-green-300 hover:text-green-700"
            >
              {activating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCheck className="mr-1 h-3.5 w-3.5" />
              )}
              Activate
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
