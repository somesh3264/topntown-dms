// src/components/stores/ShopPhotoCapture.tsx
// ---------------------------------------------------------------------------
// Shop Photo Capture Component (v1.1 — mandatory during onboarding)
//
// • "Take Shop Photo" button opens camera via
//   <input type="file" accept="image/*" capture="environment">
// • Shows preview thumbnail after capture with "Retake" option
// • Photo is returned as a base64 data URL (uploaded in createStore action)
// • Submit button DISABLED until photo is captured (enforced via prop)
// • Calls onCapture(dataUrl) once a photo is selected/taken
// ---------------------------------------------------------------------------

"use client";

import { useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, CheckCircle2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShopPhotoCaptureProps {
  /** Called with a base64 data URL once a photo is selected */
  onCapture: (dataUrl: string) => void;
  /** Called when photo is cleared (e.g. retake) */
  onClear?: () => void;
  /** Pre-existing photo URL (edit mode) */
  initialPhotoUrl?: string | null;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShopPhotoCapture({
  onCapture,
  onClear,
  initialPhotoUrl,
  className,
}: ShopPhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // If editing and there's an existing photo URL, start as "captured"
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialPhotoUrl ?? null
  );
  const [error, setError] = useState<string | null>(null);

  // ── Open camera / file picker ─────────────────────────────────────────────
  const triggerCapture = useCallback(() => {
    setError(null);
    inputRef.current?.click();
  }, []);

  // ── Handle file selection ─────────────────────────────────────────────────
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith("image/")) {
        setError("Selected file is not an image. Please try again.");
        return;
      }

      // Max size guard: 10 MB
      if (file.size > 10 * 1024 * 1024) {
        setError("Image is too large (max 10 MB). Please try again.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPreviewUrl(dataUrl);
        setError(null);
        onCapture(dataUrl);
      };
      reader.onerror = () => {
        setError("Failed to read image. Please try again.");
      };
      reader.readAsDataURL(file);

      // Reset input so same file can be re-selected after retake
      e.target.value = "";
    },
    [onCapture]
  );

  // ── Clear / retake ────────────────────────────────────────────────────────
  const handleRetake = useCallback(() => {
    setPreviewUrl(null);
    setError(null);
    onClear?.();
    // Small timeout ensures input reset propagates before re-trigger
    setTimeout(() => inputRef.current?.click(), 50);
  }, [onClear]);

  const isCaptured = Boolean(previewUrl);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Label ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none">
          Shop Photo
          <span className="ml-1 text-destructive">*</span>
        </span>
        {isCaptured && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Photo captured
          </span>
        )}
      </div>

      {/* ── Hidden file input (camera-first on mobile) ───────────────────────── */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* ── Pre-capture state ────────────────────────────────────────────────── */}
      {!isCaptured && (
        <button
          type="button"
          onClick={triggerCapture}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 py-8 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <Camera className="h-8 w-8" />
          <div className="text-center">
            <p className="text-sm font-medium">Take Shop Photo</p>
            <p className="mt-0.5 text-xs">
              Opens your camera to capture the store front
            </p>
          </div>
        </button>
      )}

      {/* ── Post-capture preview ─────────────────────────────────────────────── */}
      {isCaptured && previewUrl && (
        <div className="space-y-2">
          {/* Thumbnail */}
          <div className="relative overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Shop photo preview"
              className="h-48 w-full object-cover"
            />
            {/* Overlay badge */}
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              Photo captured
            </div>
          </div>

          {/* Retake button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetake}
            className="w-full gap-2 text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retake Photo
          </Button>
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
