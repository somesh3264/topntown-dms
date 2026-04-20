// src/app/(dashboard)/dashboard/orders/new/_components/ProductPicker.tsx
// ---------------------------------------------------------------------------
// Single-select product picker with built-in search. Used by the New Order /
// Edit Order line-item editors.
//
// Why not a plain <select>? With hundreds of products and category prefixes
// in the names, a native dropdown is slow to scan. This widget gives you a
// search box that filters live by name + category, plus the unit price
// preview right in the option row so the user picks correctly the first
// time.
// ---------------------------------------------------------------------------

"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductOption } from "../../../../orders/actions";

interface ProductPickerProps {
  products: ProductOption[];
  value: string;
  onChange: (productId: string) => void;
  /** Product IDs already used by sibling lines — hidden from the option list
   *  so the user can't accidentally double-add. The current value is always
   *  shown regardless. */
  excludeIds?: string[];
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ProductPicker({
  products,
  value,
  onChange,
  excludeIds,
  id,
  placeholder = "Search products…",
  disabled,
  className,
}: ProductPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — same pattern as MultiSelect.
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

  const exclude = React.useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const selected = products.find((p) => p.id === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => p.id === value || !exclude.has(p.id))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q)
        );
      });
  }, [products, exclude, query, value]);

  function pick(productId: string) {
    onChange(productId);
    setOpen(false);
    setQuery("");
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm ring-offset-background",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">
          {selected ? (
            <span className="flex items-center gap-2">
              <span className="font-medium">{selected.name}</span>
              {selected.category && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {selected.category}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={clear}
              className="rounded-sm text-muted-foreground/70 hover:text-foreground"
              aria-label="Clear selection"
              title="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or category…"
              className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No products match.
              </div>
            ) : (
              filtered.map((p) => {
                const selectedRow = p.id === value;
                const previewPrice = p.distributor_price ?? p.mrp;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => pick(p.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 truncate">
                        {selectedRow && <Check className="h-3.5 w-3.5 text-primary" />}
                        <span className="truncate font-medium">{p.name}</span>
                      </span>
                      {p.category && (
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {p.category}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatInr(previewPrice)}
                    </span>
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
