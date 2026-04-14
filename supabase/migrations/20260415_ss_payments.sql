-- 20260415_ss_payments.sql
-- ---------------------------------------------------------------------------
-- Super Stockist → Top N Town payments.
--
-- Captures payments made by a super stockist to Top N Town at (or near) order
-- time. The SS-facing UI (src/app/(dashboard)/ss/payments) logs rows here as
-- status='pending'; finance confirms later, which flips status='confirmed' and
-- feeds the SS's outstanding-balance card.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.ss_payments (
  id                  uuid primary key default gen_random_uuid(),
  super_stockist_id   uuid not null references public.profiles(id) on delete restrict,
  order_id            uuid null references public.orders(id) on delete set null,
  amount              numeric(14, 2) not null check (amount > 0),
  method              text not null check (method in ('upi', 'bank_transfer', 'cheque', 'cash', 'other')),
  status              text not null default 'pending'
                        check (status in ('pending', 'confirmed', 'failed', 'refunded')),
  reference_number    text null,
  paid_at             timestamptz not null,
  note                text null,
  logged_by           uuid not null references public.profiles(id) on delete restrict,
  confirmed_by        uuid null references public.profiles(id) on delete set null,
  confirmed_at        timestamptz null,
  created_at          timestamptz not null default now()
);

create index if not exists ss_payments_ss_paid_at_idx
  on public.ss_payments (super_stockist_id, paid_at desc);

create index if not exists ss_payments_status_idx
  on public.ss_payments (status)
  where status in ('pending', 'failed');

create index if not exists ss_payments_order_id_idx
  on public.ss_payments (order_id)
  where order_id is not null;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.ss_payments enable row level security;

-- SS reads only their own rows.
drop policy if exists ss_payments_ss_read_own on public.ss_payments;
create policy ss_payments_ss_read_own
  on public.ss_payments for select
  using (
    super_stockist_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'finance')
    )
  );

-- SS inserts only their own rows, only in pending status.
drop policy if exists ss_payments_ss_insert_own on public.ss_payments;
create policy ss_payments_ss_insert_own
  on public.ss_payments for insert
  with check (
    super_stockist_id = auth.uid() and status = 'pending'
  );

-- Only super_admin / finance can update status (confirm, mark failed, refund).
drop policy if exists ss_payments_staff_update on public.ss_payments;
create policy ss_payments_staff_update
  on public.ss_payments for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'finance')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'finance')
    )
  );

-- Service role bypasses RLS automatically — used by the "log payment" server
-- action since it's already scope-guarded application-side.

commit;
