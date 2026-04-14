# generate-bill-pdf

Supabase Edge Function (Deno) that renders the Top N Town advance bill PDF,
uploads it to the `bills` Storage bucket, and writes the public URL back to
`public.bills.pdf_url`.

## Deploy

```bash
# from repo root
supabase functions deploy generate-bill-pdf --no-verify-jwt

# (optional) set the support contact shown in the PDF footer
supabase secrets set SUPPORT_CONTACT="support@topntown.in"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Invoke

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"billId":"<uuid>"}' \
  "$SUPABASE_URL/functions/v1/generate-bill-pdf"
```

Expected response:

```json
{
  "ok": true,
  "billId": "…",
  "billNumber": "TNT-2026-04-0001",
  "storagePath": "2026/04/TNT-2026-04-0001.pdf",
  "pdfUrl": "https://<project>.supabase.co/storage/v1/object/public/bills/2026/04/TNT-2026-04-0001.pdf"
}
```

## Pipeline

1. Cron job (e.g. `generate_advance_bills()`) inserts rows into
   `public.bills` + `public.bill_items`.
2. `AFTER INSERT` trigger on `bills` calls
   `public.invoke_generate_bill_pdf(bill_id)` which fires the Edge Function
   via `pg_net` (see `20260415_bill_pdf_cron_hook.sql`).
3. The function uploads to `bills/<year>/<month>/<bill_number>.pdf` and sets
   `bills.pdf_url`.
4. The distributor Android app (Prompt 3.5) renders a download button from
   that URL — no app changes needed.

## Back-fill

If the pg_net call failed (network / cold start), run:

```sql
select public.generate_missing_bill_pdfs(500);
```

…or schedule it via `pg_cron` as shown in the migration file.
