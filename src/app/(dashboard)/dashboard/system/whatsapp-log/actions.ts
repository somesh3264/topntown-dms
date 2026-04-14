// src/app/(dashboard)/dashboard/system/whatsapp-log/actions.ts
// ---------------------------------------------------------------------------
// Server actions for the WhatsApp log admin page.
//   • retryWhatsappLog(logId) — re-send a failed message using stored inputs.
//
// Authorization: super_admin only.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { retryLog } from "@/lib/whatsapp";

export interface RetryResult {
  ok: boolean;
  error?: string;
  newLogId?: string;
}

export async function retryWhatsappLog(logId: string): Promise<RetryResult> {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { ok: false, error: "Not authenticated." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if ((profile as { role?: string } | null)?.role !== "super_admin") {
    return { ok: false, error: "Only super_admin may retry WhatsApp sends." };
  }

  const result = await retryLog(logId);

  // Refresh the log table — Next.js App Router cache.
  revalidatePath("/dashboard/system/whatsapp-log");

  return {
    ok: result.success,
    error: result.error,
    newLogId: result.logId,
  };
}
