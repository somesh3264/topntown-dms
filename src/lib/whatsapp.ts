// src/lib/whatsapp.ts
// ---------------------------------------------------------------------------
// Top N Town — Shared WhatsApp messaging service.
//
// Responsibilities
// ----------------
// • Route `sendMessage(phone, templateName, params)` to either WATI or Twilio
//   based on the WHATSAPP_PROVIDER env var.
// • Persist every attempt (success or failure) into `public.whatsapp_logs`
//   so admins can audit sends and retry failures.
// • Expose `retryLog(logId)` which replays a failed send using the stored
//   phone/template/params.
//
// Environment variables
// ---------------------
//   WHATSAPP_PROVIDER            "wati" | "twilio"     (required)
//
//   # WATI
//   WATI_API_URL                 e.g. https://live-server-XXXXX.wati.io
//   WATI_API_KEY                 Bearer token
//
//   # Twilio
//   TWILIO_ACCOUNT_SID           ACxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN            ****
//   TWILIO_WHATSAPP_FROM         e.g. whatsapp:+14155238886
//
// NOTE: This module uses the service-role Supabase client for logging and
// therefore MUST only be imported from trusted server-side code (route
// handlers, Server Actions, cron handlers). Never import in client code.
// ---------------------------------------------------------------------------

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  WHATSAPP_TEMPLATES,
  type WhatsappTemplateName,
  renderTemplatePreview,
} from "@/lib/whatsapp-templates";

// ─── Public types ─────────────────────────────────────────────────────────────

export type WhatsappProvider = "wati" | "twilio";

export interface SendMessageOptions {
  /** If provided, links the log row to a source entity (bill / delivery / etc). */
  context?: {
    entityType?: "bill" | "delivery" | "ledger" | string;
    entityId?: string | null;
  };
  /** If retrying a prior failure, pass the original log id — it will be updated in place. */
  retryOfLogId?: string;
}

export interface SendMessageResult {
  success: boolean;
  logId: string;
  providerMessageId?: string;
  error?: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function sendMessage<T extends WhatsappTemplateName>(
  phone: string,
  templateName: T,
  params: Record<string, string | number>,
  options: SendMessageOptions = {},
): Promise<SendMessageResult> {
  const provider = getProvider();
  const template = WHATSAPP_TEMPLATES[templateName];

  if (!template) {
    return {
      success: false,
      logId: await writeLog({
        phone,
        templateName,
        params,
        provider,
        status: "failed",
        errorMessage: `Unknown template: ${templateName}`,
        context: options.context,
        retryOfLogId: options.retryOfLogId,
      }),
      error: `Unknown template: ${templateName}`,
    };
  }

  // Validate params — missing values are a dev bug, not a runtime surprise.
  const missing = template.params.filter((p) => params[p] === undefined || params[p] === null);
  if (missing.length > 0) {
    const msg = `Missing template params for ${templateName}: ${missing.join(", ")}`;
    return {
      success: false,
      logId: await writeLog({
        phone,
        templateName,
        params,
        provider,
        status: "failed",
        errorMessage: msg,
        context: options.context,
        retryOfLogId: options.retryOfLogId,
      }),
      error: msg,
    };
  }

  const normalizedPhone = normalizePhone(phone);
  const renderedPreview = renderTemplatePreview(templateName, params);

  let providerResult: { ok: boolean; providerMessageId?: string; error?: string };

  try {
    if (provider === "twilio") {
      providerResult = await sendViaTwilio(normalizedPhone, template, params, renderedPreview);
    } else {
      providerResult = await sendViaWati(normalizedPhone, template, params);
    }
  } catch (err) {
    providerResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const logId = await writeLog({
    phone: normalizedPhone,
    templateName,
    params,
    provider,
    status: providerResult.ok ? "sent" : "failed",
    providerMessageId: providerResult.providerMessageId,
    errorMessage: providerResult.error,
    context: options.context,
    retryOfLogId: options.retryOfLogId,
    renderedPreview,
  });

  return {
    success: providerResult.ok,
    logId,
    providerMessageId: providerResult.providerMessageId,
    error: providerResult.error,
  };
}

// ─── Retry ───────────────────────────────────────────────────────────────────

/**
 * Retry a previously-failed send using the stored phone / template / params.
 * The original log row is marked `retried`; a new row records the outcome.
 */
export async function retryLog(logId: string): Promise<SendMessageResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_logs")
    .select("id, phone, template_name, params, entity_type, entity_id, status")
    .eq("id", logId)
    .single();

  if (error || !data) {
    return {
      success: false,
      logId,
      error: `Log not found: ${error?.message ?? logId}`,
    };
  }
  if (data.status === "sent") {
    return {
      success: true,
      logId,
      error: "Already delivered; nothing to retry.",
    };
  }

  // Mark original as retried for audit clarity.
  await supabase
    .from("whatsapp_logs")
    .update({ status: "retried", retried_at: new Date().toISOString() })
    .eq("id", logId);

  return sendMessage(
    data.phone as string,
    data.template_name as WhatsappTemplateName,
    (data.params ?? {}) as Record<string, string | number>,
    {
      context: {
        entityType: (data.entity_type as string | null) ?? undefined,
        entityId: (data.entity_id as string | null) ?? undefined,
      },
      retryOfLogId: logId,
    },
  );
}

// ─── Provider: WATI ──────────────────────────────────────────────────────────

async function sendViaWati(
  phone: string,
  template: (typeof WHATSAPP_TEMPLATES)[WhatsappTemplateName],
  params: Record<string, string | number>,
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  const base = mustEnv("WATI_API_URL");
  const key = mustEnv("WATI_API_KEY");

  // WATI send-template API. Positional params map 1:1 to {{1}}, {{2}}, ...
  const url = new URL(
    `${base.replace(/\/$/, "")}/api/v1/sendTemplateMessage`,
  );
  url.searchParams.set("whatsappNumber", stripPlus(phone));

  const body = {
    template_name: template.name,
    broadcast_name: `${template.name}_${Date.now()}`,
    parameters: template.params.map((p, i) => ({
      name: String(i + 1),
      value: String(params[p] ?? ""),
    })),
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }

  if (!res.ok) {
    return { ok: false, error: `WATI ${res.status}: ${text.slice(0, 300)}` };
  }

  const id = extractWatiMessageId(json);
  // WATI sometimes returns {result: false, info: "..."} with HTTP 200 — handle.
  if (json && typeof json === "object" && (json as { result?: boolean }).result === false) {
    return { ok: false, error: `WATI reported failure: ${text.slice(0, 300)}` };
  }

  return { ok: true, providerMessageId: id };
}

function extractWatiMessageId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const j = json as Record<string, unknown>;
  if (typeof j.message_id === "string") return j.message_id;
  if (typeof j.messageId === "string") return j.messageId;
  const messages = j.messages as Array<{ id?: string }> | undefined;
  if (Array.isArray(messages) && messages[0]?.id) return messages[0].id;
  return undefined;
}

// ─── Provider: Twilio ────────────────────────────────────────────────────────

async function sendViaTwilio(
  phone: string,
  template: (typeof WHATSAPP_TEMPLATES)[WhatsappTemplateName],
  params: Record<string, string | number>,
  preview: string,
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  const sid = mustEnv("TWILIO_ACCOUNT_SID");
  const token = mustEnv("TWILIO_AUTH_TOKEN");
  const from = mustEnv("TWILIO_WHATSAPP_FROM"); // e.g. whatsapp:+14155238886

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = `Basic ${btoa(`${sid}:${token}`)}`;

  // Twilio content templates use ContentSid + ContentVariables for approved
  // templates; when a template isn't configured we fall back to a freeform
  // body (valid inside the 24h session window only).
  const contentSid = template.twilioContentSid;
  const form = new URLSearchParams();
  form.set("To", phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`);
  form.set("From", from);

  if (contentSid) {
    form.set("ContentSid", contentSid);
    const variables: Record<string, string> = {};
    template.params.forEach((p, i) => {
      variables[String(i + 1)] = String(params[p] ?? "");
    });
    form.set("ContentVariables", JSON.stringify(variables));
  } else {
    form.set("Body", preview);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 300)}` };
  }

  let providerMessageId: string | undefined;
  try {
    const parsed = JSON.parse(text) as { sid?: string };
    providerMessageId = parsed.sid;
  } catch { /* ignore */ }

  return { ok: true, providerMessageId };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

interface WriteLogInput {
  phone: string;
  templateName: string;
  params: Record<string, string | number>;
  provider: WhatsappProvider;
  status: "sent" | "failed" | "retried";
  providerMessageId?: string;
  errorMessage?: string;
  renderedPreview?: string;
  context?: SendMessageOptions["context"];
  retryOfLogId?: string;
}

async function writeLog(input: WriteLogInput): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_logs")
    .insert({
      phone: input.phone,
      template_name: input.templateName,
      params: input.params as unknown as Record<string, unknown>,
      provider: input.provider,
      status: input.status,
      provider_message_id: input.providerMessageId ?? null,
      error_message: input.errorMessage ?? null,
      rendered_preview: input.renderedPreview ?? null,
      entity_type: input.context?.entityType ?? null,
      entity_id: input.context?.entityId ?? null,
      retry_of_log_id: input.retryOfLogId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // As a last-ditch diagnostic, log to server console — never throw from here.
    console.error("[whatsapp.writeLog] Failed to persist log:", error);
    return "";
  }
  return data.id as string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProvider(): WhatsappProvider {
  const raw = (process.env.WHATSAPP_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "wati" || raw === "twilio") return raw;
  // Default to WATI — most Indian distributor deployments use it.
  return "wati";
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/** Ensure phones are E.164, defaulting to +91 (India) when unqualified. */
export function normalizePhone(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\s+/g, "");
  if (!trimmed) throw new Error("Empty phone number");
  if (trimmed.startsWith("+")) return trimmed;
  // 10-digit Indian mobile — prepend country code.
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  // Otherwise assume caller already included a country code without the "+".
  return `+${trimmed.replace(/^0+/, "")}`;
}

function stripPlus(p: string) { return p.startsWith("+") ? p.slice(1) : p; }
