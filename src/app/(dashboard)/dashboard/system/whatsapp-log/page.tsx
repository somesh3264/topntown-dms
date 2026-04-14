// src/app/(dashboard)/dashboard/system/whatsapp-log/page.tsx
// ---------------------------------------------------------------------------
// WhatsApp send log (super_admin only).
//
// Shows the most recent 200 attempts, filterable by status and template, with
// a one-click retry button on failed rows.
// ---------------------------------------------------------------------------

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WhatsappLogClient, type WhatsappLogRow } from "./_components/WhatsappLogClient";

export const metadata: Metadata = { title: "WhatsApp Log" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: { status?: string; template?: string };
}

export default async function WhatsappLogPage({ searchParams }: PageProps) {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if ((profile as { role?: string } | null)?.role !== "super_admin") {
    redirect("/dashboard");
  }

  const status = searchParams?.status ?? "all";
  const template = searchParams?.template ?? "all";

  let query = supabase
    .from("whatsapp_logs")
    .select(
      "id, created_at, phone, template_name, provider, status, provider_message_id, error_message, rendered_preview, entity_type, entity_id, retry_of_log_id",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status !== "all") query = query.eq("status", status);
  if (template !== "all") query = query.eq("template_name", template);

  const { data, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">WhatsApp Log</h1>
        <p className="text-sm text-red-600">
          Failed to load logs: {error.message}
        </p>
      </div>
    );
  }

  const rows: WhatsappLogRow[] = (data ?? []) as WhatsappLogRow[];

  // Counts for the filter chips.
  const { count: sentCount } = await supabase
    .from("whatsapp_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent");
  const { count: failedCount } = await supabase
    .from("whatsapp_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  const { count: retriedCount } = await supabase
    .from("whatsapp_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "retried");

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold">WhatsApp Log</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Outbound WhatsApp sends across all templates. Failed rows can be retried.
      </p>

      <WhatsappLogClient
        rows={rows}
        currentStatus={status}
        currentTemplate={template}
        counts={{
          sent: sentCount ?? 0,
          failed: failedCount ?? 0,
          retried: retriedCount ?? 0,
        }}
      />
    </div>
  );
}
