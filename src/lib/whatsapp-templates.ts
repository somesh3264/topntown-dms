// src/lib/whatsapp-templates.ts
// ---------------------------------------------------------------------------
// Top N Town — WhatsApp template registry.
//
// The three templates here are also submitted for approval in Meta Business
// Manager (see docs/whatsapp-templates.md for the exact copy text).
//
// When Meta approves a template, fill in `twilioContentSid` (only needed if
// you use Twilio — WATI references templates by `name`).
// ---------------------------------------------------------------------------

export type WhatsappTemplateName =
  | "bill_ready"
  | "delivery_receipt"
  | "ledger_summary";

export interface WhatsappTemplate {
  /** Canonical Meta template name, lowercased with underscores. */
  name: WhatsappTemplateName;
  /** Template category — utility is the correct class for all three. */
  category: "UTILITY";
  /** Language tag used at Meta. */
  language: "en" | "en_IN";
  /** Ordered list of parameter keys — maps 1:1 to {{1}}, {{2}}, ... */
  params: string[];
  /** Human-readable body with `{{n}}` placeholders (for preview + Meta copy). */
  body: string;
  /** Twilio Content SID (filled in after Meta approval if using Twilio). */
  twilioContentSid?: string;
}

export const WHATSAPP_TEMPLATES: Record<WhatsappTemplateName, WhatsappTemplate> = {
  bill_ready: {
    name: "bill_ready",
    category: "UTILITY",
    language: "en",
    // {{1}} distributor_name, {{2}} bill_number, {{3}} amount_inr, {{4}} pdf_url
    params: ["distributor_name", "bill_number", "amount_inr", "pdf_url"],
    body:
      "Hello {{1}}, your Top N Town advance bill {{2}} for INR {{3}} is ready. View: {{4}}",
  },
  delivery_receipt: {
    name: "delivery_receipt",
    category: "UTILITY",
    language: "en",
    // {{1}} store_name, {{2}} item_count, {{3}} total_inr, {{4}} delivered_on, {{5}} payment_inr
    params: ["store_name", "item_count", "total_inr", "delivered_on", "payment_inr"],
    body:
      "Bill delivered to {{1}}: {{2}} items worth INR {{3}} on {{4}}. Payment received: INR {{5}}.",
  },
  ledger_summary: {
    name: "ledger_summary",
    category: "UTILITY",
    language: "en",
    // {{1}} store_name, {{2}} outstanding_inr, {{3}} last_delivery_date, {{4}} payments_inr
    params: ["store_name", "outstanding_inr", "last_delivery_date", "payments_inr"],
    body:
      "Hi {{1}}, your outstanding: INR {{2}}. Last delivery: {{3}}. Payments received: INR {{4}}.",
  },
};

/**
 * Render a template with its params for preview / fallback freeform sending.
 * This is what we store in `whatsapp_logs.rendered_preview` so admins can
 * see exactly what went out (or would have gone out).
 */
export function renderTemplatePreview(
  name: WhatsappTemplateName,
  params: Record<string, string | number>,
): string {
  const t = WHATSAPP_TEMPLATES[name];
  return t.params.reduce<string>((acc, key, idx) => {
    const token = `{{${idx + 1}}}`;
    const value = params[key];
    return acc.replaceAll(token, value === undefined || value === null ? "" : String(value));
  }, t.body);
}
