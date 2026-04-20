// src/components/ui/multi-select.tsx
// ---------------------------------------------------------------------------
// Lightweight multi-select dropdown with checkbox-style options.
//
// Self-contained — no Radix Popover/Combobox dependency. Click the trigger to
// open a panel of checkboxes, click outside (or press Escape) to close. Options
// can be filtered with a search input. Selected values render as chips inside
// the trigger.
//
// Designed to be a drop-in for the single-select <Select> wherever the form
// needs multiple values (e.g., distributor → zones / areas).
// ---------------------------------------------------------------------------
"use client";

import * as React from "react";
import { Check, ChevronDown, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Show a search input above the option list. Defaults to true when there
   *  are >5 options. */
  searchable?: boolean;
  /** When true, clicking the trigger does nothing and shows the placeholder. */
  loading?: boolean;
  className?: string;
  id?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No options.",
  disabled,
  searchable,
  loading,
  className,
  id,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  const showSearch = searchable ?? options.length > 5;

  // Close on outside click / Escape
  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // When the available option set shrinks (e.g., area list re-filtered after a
  // zone was removed), prune any selected values that are no longer valid so
  // the form doesn't submit dangling IDs.
  React.useEffect(() => {
    if (value.length === 0) return;
    const valid = new Set(options.map((o) => o.value));
    const pruned = value.filter((v) => valid.has(v));
    if (pruned.length !== value.length) onChange(pruned);
    // We intentionally exclude `value` and `onChange` from deps — we only want
    // to react to the option list changing, not to our own pruning callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const selectedSet = React.useMemo(() => new Set(value), [value]);
  const selectedOptions = React.useMemo(
    () => options.filter((o) => selectedSet.has(o.value)),
    [options, selectedSet]
  );

  const filteredOptions = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(val: string) {
    if (selectedSet.has(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  }

  function removeOne(val: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(value.filter((v) => v !== val));
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Trigger */}
      <button
        type="button"
        id={id}
        disabled={disabled || loading}
        onClick={() => !disabled && !loading && setOpen((v) => !v)}
        className={cn(
          "flex min-h-10 w-full items-start justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-left text-sm ring-offset-background",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <div className="flex flex-1 flex-wrap gap-1 py-0.5">
          {loading ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : selectedOptions.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
              >
                {opt.label}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => removeOne(opt.value, e)}
                  className="rounded-sm opacity-60 hover:opacity-100"
                  aria-label={`Remove ${opt.label}`}
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 self-center">
          {value.length > 0 && !disabled && !loading && (
            <span
              role="button"
              tabIndex={-1}
              onClick={clearAll}
              className="rounded-sm text-muted-foreground/70 hover:text-foreground"
              aria-label="Clear all"
              title="Clear all"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </div>
      </button>

      {/* Panel */}
      {open && (
        <div
          className={cn(
            "absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95"
          )}
          role="listbox"
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {options.length === 0 ? emptyText : "No matches."}
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const selected = selectedSet.has(opt.value);
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background"
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
