// Shared placeholder for routes not yet implemented.
import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-center px-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Construction className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {description ?? "This section is under development and will be available in the next sprint."}
        </p>
      </div>
    </div>
  );
}
