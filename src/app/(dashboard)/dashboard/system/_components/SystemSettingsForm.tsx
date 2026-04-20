// src/app/(dashboard)/dashboard/system/_components/SystemSettingsForm.tsx
// ---------------------------------------------------------------------------
// Client component — form for System Settings (Super Admin only).
//
// Fields:
//   • cut_off_enabled  → toggle (master switch)
//   • cut_off_time     → HH:MM time input (IST)
//   • support_contact  → phone number shown to users after cut-off
//
// Initial values come from the parent server component, which calls
// getSystemSettings() against system_config.
// ---------------------------------------------------------------------------

"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import { updateSystemSettings, type SystemSettings } from "../actions";

// ─── Props ────────────────────────────────────────────────────────────────────

interface SystemSettingsFormProps {
  initial: SystemSettings;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SystemSettingsForm({ initial }: SystemSettingsFormProps) {
  const { toast } = useToast();

  const [cutoffTime, setCutoffTime] = useState(initial.cutoffTime);
  const [cutoffEnabled, setCutoffEnabled] = useState(initial.cutoffEnabled);
  const [supportContact, setSupportContact] = useState(initial.supportContact);

  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData();
    fd.set("cut_off_time", cutoffTime);
    fd.set("cut_off_enabled", cutoffEnabled ? "on" : "off");
    fd.set("support_contact", supportContact);

    startTransition(async () => {
      const result = await updateSystemSettings(fd);
      if (result.success) {
        toast({
          title: "Settings saved",
          description: cutoffEnabled
            ? `Cut-off active at ${cutoffTime} IST.`
            : "Cut-off enforcement is paused — orders can be placed any time.",
        });
      } else {
        toast({
          title: "Could not save settings",
          description: result.error ?? "Unexpected error.",
          variant: "destructive",
        });
      }
    });
  }

  // ── Derived status line ────────────────────────────────────────────────────
  const statusLabel = cutoffEnabled
    ? `Cut-off enforced at ${cutoffTime} IST`
    : "Cut-off paused — orders accepted around the clock";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      {/* ── Master toggle ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <Label htmlFor="cut_off_enabled" className="text-base">
            Enforce daily order cut-off
          </Label>
          <p className="text-sm text-muted-foreground">
            When off, the server accepts orders at any hour. Turn on for
            production to enforce the configured cut-off time.
          </p>
        </div>
        <Switch
          id="cut_off_enabled"
          checked={cutoffEnabled}
          onCheckedChange={setCutoffEnabled}
          disabled={isPending}
        />
      </div>

      {/* ── Cut-off time ───────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="cut_off_time">Cut-off time (IST)</Label>
        <Input
          id="cut_off_time"
          type="time"
          step={60}
          value={cutoffTime}
          onChange={(e) => setCutoffTime(e.target.value)}
          disabled={isPending || !cutoffEnabled}
          required
          className="max-w-[180px]"
        />
        <p className="text-xs text-muted-foreground">
          24-hour format. Orders placed after this time fall back to the
          support contact below.
        </p>
      </div>

      {/* ── Support contact ────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="support_contact">Support contact number</Label>
        <Input
          id="support_contact"
          type="tel"
          inputMode="tel"
          placeholder="+91-9876543210"
          value={supportContact}
          onChange={(e) => setSupportContact(e.target.value)}
          disabled={isPending}
          required
          className="max-w-[260px]"
        />
        <p className="text-xs text-muted-foreground">
          Shown to distributors in the app when cut-off has passed.
        </p>
      </div>

      {/* ── Status + submit ────────────────────────────────────────────────── */}
      <div className="flex flex-col-reverse items-start gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={[
            "text-sm",
            cutoffEnabled ? "text-foreground" : "text-amber-700 dark:text-amber-400",
          ].join(" ")}
        >
          {statusLabel}
        </p>
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
