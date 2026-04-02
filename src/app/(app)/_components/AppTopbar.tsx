// src/app/(app)/_components/AppTopbar.tsx
"use client";

import { Bell } from "lucide-react";

interface AppTopbarProps {
  displayName: string;
}

export default function AppTopbar({ displayName }: AppTopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 safe-pt">
      <span className="text-base font-bold text-brand-700">TopNTown</span>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
          {displayName}
        </span>
        <button
          aria-label="Notifications"
          className="relative rounded-full p-1.5 hover:bg-accent"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {/* Notification badge — conditionally rendered */}
          {/* <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" /> */}
        </button>
      </div>
    </header>
  );
}
