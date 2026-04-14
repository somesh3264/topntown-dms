-- ============================================================================
-- 20260415_whatsapp_logs.sql
--
-- Audit log for every outbound WhatsApp send from Top N Town DMS.
-- Populated by src/lib/whatsapp.ts -> writeLog().
--
-- Admin UI:  /dashboard/system/whatsapp-log  (super_admin only)
-- ============================================================================

create table if not exists public.whatsapp_logs (
    id                  uuid            primary key default gen_random_uuid(),
    phone               text            not null,
    template_name       text            not null,
    params              jsonb           not null default '{}'::jsonb,
    provider            text            not null check (provider in ('wati', 'twilio')),
    status              text            not null check (status in ('sent', 'failed', 'retried')),
    provider_message_id text,
    error_message       text,
    rendered_preview    text,

    -- Link back to the entity that triggered this send (optional).
    entity_type         text,           -- 'bill' | 'delivery' | 'ledger' | ...
    entity_id           uuid,

    -- If this row is a retry attempt, points at the original failed log.
    retry_of_log_id     uuid            references public.whatsapp_logs(id)
                                          on update cascade on delete set null,

    created_at          timestamptz     not null default now(),
    retried_at          timestamptz
);

comment on table public.whatsapp_logs is
  'Outbound WhatsApp send audit log (bill_ready / delivery_receipt / ledger_summary).';

-- ---- Indexes --------------------------------------------------------------

create index if not exists whatsapp_logs_created_at_idx
    on public.whatsapp_logs (created_at desc);

create index if not exists whatsapp_logs_status_idx
    on public.whatsapp_logs (status, created_at desc);

create index if not exists whatsapp_logs_entity_idx
    on public.whatsapp_logs (entity_type, entity_id);

create index if not exists whatsapp_logs_template_idx
    on public.whatsapp_logs (template_name, created_at desc);

-- ---- RLS ------------------------------------------------------------------

alter table public.whatsapp_logs enable row level security;

drop policy if exists whatsapp_logs_super_admin_read on public.whatsapp_logs;
drop policy if exists whatsapp_logs_service_role_all on public.whatsapp_logs;

-- Super admin can read everything from the dashboard.
create policy whatsapp_logs_super_admin_read
on public.whatsapp_logs
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
);

-- Service role (Edge Functions + server actions) has full access.
create policy whatsapp_logs_service_role_all
on public.whatsapp_logs
for all
to service_role
using (true)
with check (true);
