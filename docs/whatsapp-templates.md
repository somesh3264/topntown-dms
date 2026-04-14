# WhatsApp Templates — Meta Submission Copy

Submit the three templates below in **Meta Business Manager → WhatsApp Manager → Message Templates**.

All three are **Category: UTILITY**, **Language: English**. No header or buttons are required.

---

## 1. `bill_ready`

**Body:**

```
Hello {{1}}, your Top N Town advance bill {{2}} for INR {{3}} is ready. View: {{4}}
```

**Sample values for approval:**

| Placeholder | Sample |
|-------------|--------|
| `{{1}}` | Rajesh Kumar |
| `{{2}}` | TNT-20260415-RK-001 |
| `{{3}}` | 12,450.00 |
| `{{4}}` | https://example.supabase.co/storage/v1/object/public/bills/2026/04/TNT-20260415-RK-001.pdf |

---

## 2. `delivery_receipt`

**Body:**

```
Bill delivered to {{1}}: {{2}} items worth INR {{3}} on {{4}}. Payment received: INR {{5}}.
```

**Sample values for approval:**

| Placeholder | Sample |
|-------------|--------|
| `{{1}}` | Sharma General Store |
| `{{2}}` | 12 |
| `{{3}}` | 4,820.00 |
| `{{4}}` | 15 Apr 2026 |
| `{{5}}` | 2,000.00 |

---

## 3. `ledger_summary`

**Body:**

```
Hi {{1}}, your outstanding: INR {{2}}. Last delivery: {{3}}. Payments received: INR {{4}}.
```

**Sample values for approval:**

| Placeholder | Sample |
|-------------|--------|
| `{{1}}` | Sharma General Store |
| `{{2}}` | 3,250.00 |
| `{{3}}` | 12 Apr 2026 |
| `{{4}}` | 8,000.00 |

---

## After approval

**If using WATI:** WATI references templates by the exact `name` — no extra wiring needed, the sender is fully keyed by `template_name` in `src/lib/whatsapp-templates.ts`.

**If using Twilio:** copy the **Content SID** (`HXxxxx…`) from Twilio Content Editor into the matching template in `src/lib/whatsapp-templates.ts` under `twilioContentSid`. Twilio requires the Content SID for WhatsApp template sends outside the 24-hour session window.
