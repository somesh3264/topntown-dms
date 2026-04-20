-- ============================================================================
-- 20260418_system_config_cutoff_controls.sql
--
-- Adds admin-controlled cut-off management.
--
-- 1. Ensures the `system_config` table exists (idempotent — matches the shape
--    already consumed by src/lib/cutoff.ts and src/app/api/orders/submit).
-- 2. Seeds / upserts the three keys used by the new Settings page:
--        cut_off_time     — "HH:MM" in IST (24-hour)
--        cut_off_enabled  — "true" | "false" master switch
--        support_contact  — phone shown when cut-off is active and passed
-- 3. Initialises cut_off_enabled = 'false' so developers can test order
--    submission at any time without tripping the cut-off check. Flip to
--    'true' from the UI (Dashboard → System) before go-live.
--
-- Admin UI:  /dashboard/system  (super_admin only)
-- ============================================================================

-- ---- Table ----------------------------------------------------------------

create table if not exists public.system_config (
    key         text        primary key,
    value       text        not null,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users(id) on delete set null
);

comment on table public.system_config is
  'Singleton key/value store for global DMS settings (cut-off time, support contact, etc.).';

-- Defensive: in case the table pre-existed with a subset of columns.
alter table public.system_config
    add column if not exists updated_at  timestamptz not null default now();

alter table public.system_config
    add column if not exists updated_by  uuid references auth.users(id) on delete set null;

-- ---- updated_at trigger ---------------------------------------------------

create or replace function public.system_config_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_system_config_touch on public.system_config;

create trigger trg_system_config_touch
before update on public.system_config
for each row
execute function public.system_config_touch_updated_at();

-- ---- Seed / upsert defaults -----------------------------------------------
-- Use ON CONFLICT DO NOTHING for cut_off_time + support_contact so we do not
-- clobber values an admin may have already tuned in production.
--
-- cut_off_enabled is forcibly set to 'false' in this migration so that
-- developers can place test orders at any hour. Flip from the Settings UI.
-- ---------------------------------------------------------------------------

insert into public.system_config (key, value)
values ('cut_off_time', '14:00')
on conflict (key) do nothing;

insert into public.system_config (key, value)
values ('support_contact', '+91-9999999999')
on conflict (key) do nothing;

insert into public.system_config (key, value)
values ('cut_off_enabled', 'false')
on conflict (key) do update set value = excluded.value;

-- ---- RLS ------------------------------------------------------------------

alter table public.system_config enable row level security;

drop policy if exists system_config_super_admin_read on public.system_config;
drop policy if exists system_config_service_role_all on public.system_config;

-- Super admin can read all keys (used by the Settings page).
create policy system_config_super_admin_read
on public.system_config
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
);

-- Service role (admin client in server actions / API routes) bypasses RLS
-- entirely; this explicit policy documents the intent and keeps behaviour
-- consistent if the admin client were ever swapped for an authenticated one.
create policy system_config_service_role_all
on public.system_config
for all
to service_role
using (true)
with check (true);
