-- ============================================================================
-- 20260415_bills_storage.sql
--
-- Storage configuration for the Advance Bill PDF generation system.
--   * Creates the "bills" Storage bucket (public read for the PDF download URL
--     used by the distributor Android app).
--   * Locks down writes to the service role only (the Edge Function uses the
--     service role key — no client may upload here directly).
--   * Adds row-level policies so super_admin can always see every object and
--     distributors can only see/list objects corresponding to their own bills.
--
-- Apply: supabase db push  (or include in your migration pipeline).
-- ============================================================================

-- ---- 1. Bucket ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('bills', 'bills', true)
on conflict (id) do update
   set public = excluded.public;

-- ---- 2. Make sure RLS is on (it is by default on storage.objects) ---------

alter table storage.objects enable row level security;

-- ---- 3. Clean up earlier iterations (idempotent migration) ----------------

drop policy if exists "bills_public_read"            on storage.objects;
drop policy if exists "bills_service_role_write"     on storage.objects;
drop policy if exists "bills_super_admin_all"        on storage.objects;
drop policy if exists "bills_distributor_read_own"   on storage.objects;

-- ---- 4. Public read ( Android app downloads via public URL ) ---------------

-- The bucket is public, so any signed-out HTTP GET works through the CDN;
-- this policy keeps the authenticated Supabase SDK happy when it lists/reads.
create policy "bills_public_read"
on storage.objects
for select
using (bucket_id = 'bills');

-- ---- 5. Writes restricted to the service role -----------------------------

create policy "bills_service_role_write"
on storage.objects
for all
to service_role
using (bucket_id = 'bills')
with check (bucket_id = 'bills');

-- ---- 6. Super admin: full access ------------------------------------------

create policy "bills_super_admin_all"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'bills'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
)
with check (
  bucket_id = 'bills'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
);

-- ---- 7. Distributor: read only their own bills ----------------------------
--
-- Object keys follow the pattern `<year>/<month>/<bill_number>.pdf`. The last
-- path segment, stripped of its extension, is the bill_number — which the
-- Edge Function ensures is unique per bill. We join on that to scope reads.
-- The authenticated user must be the bill's distributor.

create policy "bills_distributor_read_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'bills'
  and exists (
    select 1
    from public.bills b
    where b.distributor_id = auth.uid()
      -- Object path: <year>/<month>/<bill_number>.pdf
      -- storage.filename(name) returns "<bill_number>.pdf"; strip the suffix.
      and b.bill_number = split_part(storage.filename(name), '.', 1)
  )
);
