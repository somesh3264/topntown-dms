// src/components/stores/GpsCapture.tsx
// ---------------------------------------------------------------------------
// GPS Capture Component (v1.1)
//
// • "Capture GPS Location" button using browser navigator.geolocation
// • Shows lat/lng after capture with OpenStreetMap iframe preview
// • Displays "Location captured: [Lat, Lng]" with a green checkmark
// • If permission denied: shows red error "Location permission denied."
// • Manual entry is NOT available (GPS capture is mandatory per FRD)
// • Calls onCapture(lat, lng) once location is acquired
// ---------------------------------------------------------------------------

"use client";

import { useState, useCallback } from "react";
import { MapPin, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GpsCaptureProps {
  /** Called once GPS coordinates are successfully acquired */
  onCapture: (lat: number, lng: number) => void;
  /** Pre-populated lat/lng when editing an existing store */
  initialLat?: number | null;
  initialLng?: number | null;
  className?: string;
}

type GpsState = "idle" | "requesting" | "captured" | "denied" | "error";

// ─── Component ────────────────────────────────────────────────────────────────

export function GpsCapture({
  onCapture,
  initialLat,
  initialLng,
  className,
}: GpsCaptureProps) {
  const [state, setState] = useState<GpsState>(
    initialLat && initialLng ? "captured" : "idle"
  );
  const [lat, setLat] = useState<number | null>(initialLat ?? null);
  const [lng, setLng] = useState<number | null>(initialLng ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Map URL (OpenStreetMap static-like embed) ─────────────────────────────
  const mapSrc =
    lat !== null && lng !== null
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.005},${lng + 0.005},${lat + 0.005}&layer=mapnik&marker=${lat},${lng}`
      : null;

  // ── Capture handler ───────────────────────────────────────────────────────
  const captureLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState("error");
      setErrorMsg("Geolocation is not supported by this browser.");
      return;
    }

    setState("requesting");
    setErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLat(latitude);
        setLng(longitude);
        setState("captured");
        onCapture(latitude, longitude);
      },
      (err) => {
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          setState("denied");
          setErrorMsg(
            "Location permission denied. GPS is required to add a store."
          );
        } else if (err.code === GeolocationPositionError.POSITION_UNAVAILABLE) {
          setState("error");
          setErrorMsg("Location unavailable. Please try again.");
        } else if (err.code === GeolocationPositionError.TIMEOUT) {
          setState("error");
          setErrorMsg("Location request timed out. Please try again.");
        } else {
          setState("error");
          setErrorMsg("An unexpected error occurred. Please try again.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0,
      }
    );
  }, [onCapture]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Label ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          GPS Location
          <span className="ml-1 text-destructive">*</span>
        </span>
        {state === "captured" && lat !== null && lng !== null && (
          <span className="text-xs text-muted-foreground font-mono">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </span>
        )}
      </div>

      {/* ── Capture button ───────────────────────────────────────────────────── */}
      <Button
        type="button"
        variant={state === "captured" ? "outline" : "default"}
        size="sm"
        onClick={captureLocation}
        disabled={state === "requesting"}
        className={cn(
          "w-full gap-2",
          state === "captured" &&
            "border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-700 dark:text-green-400"
        )}
      >
        {state === "requesting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state === "captured" ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
        {state === "requesting"
          ? "Acquiring location…"
          : state === "captured"
          ? "Recapture GPS Location"
          : "Capture GPS Location"}
      </Button>

      {/* ── Success state ────────────────────────────────────────────────────── */}
      {state === "captured" && lat !== null && lng !== null && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Location captured:{" "}
              <span className="font-mono font-semibold">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </span>
            </span>
          </div>

          {/* OpenStreetMap preview */}
          {mapSrc && (
            <div className="overflow-hidden rounded-lg border bg-muted">
              <iframe
                src={mapSrc}
                width="100%"
                height="180"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                title="Store GPS Location"
                className="pointer-events-none"
                loading="lazy"
              />
              <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                <span>
                  Map data © OpenStreetMap contributors
                </span>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open in OSM ↗
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Error / denied state ─────────────────────────────────────────────── */}
      {(state === "denied" || state === "error") && errorMsg && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
