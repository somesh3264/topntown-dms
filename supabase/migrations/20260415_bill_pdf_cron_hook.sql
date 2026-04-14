-- ============================================================================
-- 20260415_bill_pdf_cron_hook.sql
--
-- Cron / trigger integration for the Advance Bill PDF generator Edge Function.
--
-- What this does
-- --------------
-- 1. Creates a Postgres helper `public.invoke_generate_bill_pdf(bill_id uuid)`
--    that calls the Edge Function via pg_net (HTTP from inside Postgres).
--    The function is owner-executed so the service role key never leaks to
--    the client.
-- 2. Installs an `AFTER INSERT` trigger on `public.bills` that fires the
--    helper asynchronously for every newly-created bill — this is what the
--    nightly advance-bill cron job depends on. Any other server-side code
--    that inserts into `bills` (e.g. the pg_cron-driven `generate_advance_bills()`
--    job) will get PDFs generated automatically.
-- 3. Exposes `public.generate_missing_bill_pdfs()` — a back-fill utility the
--    cron job can call once per run to retry any bills whose pdf_url is still
--    null (network blips, cold starts, etc.).
--
-- Required GUCs (set once, NOT committed to git):
--   select set_config('app.supabase_url',
--                     'https://<project>.supabase.co', false);
--   select set_config('app.service_role_key',
--                     '<service-role-key>', false);
--
-- The recommended approach on Supabase is to set these with
--   alter database postgres set app.supabase_url = '…';
--   alter database postgres set app.service_role_key = '…';
-- so they survive reconnects, or store them in Vault and read via
-- `vault.decrypted_secrets`.
--
-- Prerequisites:
--   create extension if not exists pg_net;
--   create extension if not exists pg_cron;  -- only needed for the cron job
-- ============================================================================

create extension if not exists pg_net;

-- ---- 1. Helper: invoke the Edge Function ----------------------------------

create or replace function public.invoke_generate_bill_pdf(p_bill_id uuid)
returns bigint        -- pg_net request id
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text := current_setting('app.supabase_url',    true);
  v_key   text := current_setting('app.service_role_key', true);
  v_req   bigint;
begin
  if v_url is null or v_key is null then
    raise warning
      '[invoke_generate_bill_pdf] app.supabase_url / app.service_role_key not configured; skipping bill %',
      p_bill_id;
    return null;
  end if;

  select net.http_post(
    url     := v_url || '/functions/v1/generate-bill-pdf',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('billId', p_bill_id),
    timeout_milliseconds := 30000
  )
  into v_req;

  return v_req;
end;
$$;

comment on function public.invoke_generate_bill_pdf(uuid) is
  'Fire-and-forget: enqueue a call to the generate-bill-pdf Edge Function for a bill.';

revoke all on function public.invoke_generate_bill_pdf(uuid) from public;
grant execute on function public.invoke_generate_bill_pdf(uuid)
  to service_role, postgres;

-- ---- 2. Trigger on bills insert -------------------------------------------

create or replace function public.bills_after_insert_generate_pdf()
returns trigger
language plpgsql
as $$
begin
  -- We don't want to block the inserting transaction if pg_net hiccups.
  -- net.http_post is async, but wrap in exception-safe block defensively.
  begin
    perform public.invoke_generate_bill_pdf(new.id);
  exception when others then
    raise warning
      '[bills_after_insert_generate_pdf] enqueue failed for bill %: %',
      new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_bills_generate_pdf on public.bills;

create trigger trg_bills_generate_pdf
after insert on public.bills
for each row
execute function public.bills_after_insert_generate_pdf();

-- ---- 3. Back-fill utility (idempotent; safe to call from pg_cron) ---------

create or replace function public.generate_missing_bill_pdfs(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id
      from public.bills
     where pdf_url is null
     order by created_at asc
     limit p_limit
  loop
    perform public.invoke_generate_bill_pdf(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.generate_missing_bill_pdfs(int) is
  'Re-enqueue PDF generation for bills whose pdf_url is still null.';

revoke all on function public.generate_missing_bill_pdfs(int) from public;
grant execute on function public.generate_missing_bill_pdfs(int)
  to service_role, postgres;

-- ---- 4. Optional: schedule the back-fill sweep ----------------------------
--
-- Uncomment once pg_cron is enabled in your project. Runs 5 minutes after the
-- advance-bill generation cron (so transient failures get a retry).
--
-- select cron.schedule(
--   'tnt-bill-pdf-backfill',
--   '5 * * * *',
--   $$ select public.generate_missing_bill_pdfs(500); $$
-- );
