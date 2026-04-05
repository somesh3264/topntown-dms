import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-center px-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Page not found</h2>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="text-sm font-medium text-primary hover:underline"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
