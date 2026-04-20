-- ============================================================================
-- 20260418_order_items_rls.sql
--
-- Row-Level Security policies for public.order_items.
--
-- Why this migration exists:
--   The Dashboard order detail page (src/app/(dashboard)/dashboard/orders/
--   [orderId]/page.tsx) uses the *authenticated* Supabase client to read
--   order_items. Before this migration, order_items had RLS enabled with no
--   SELECT policy for application roles, so even super_admin saw zero items
--   (the orders row was visible via the existing orders policy, but the
--   related items rows were filtered out).
--
-- Access model (mirrors the orders table):
--   • super_admin      reads ALL order_items
--   • super_stockist   reads items for orders placed by distributors in
--                      their ss_networks assignment
--   • sales_person     reads items for orders from distributors in the
--                      same area_id as the sales person
--   • distributor      reads items for their own orders
--   • service_role     full access (admin client used by cron / server
--                      actions that insert order_items)
-- ============================================================================

alter table public.order_items enable row level security;

-- Clean up any stale versions before re-creating (idempotent migration).
drop policy if exists order_items_super_admin_read on public.order_items;
drop policy if exists order_items_distributor_read on public.order_items;
drop policy if exists order_items_ss_read           on public.order_items;
drop policy if exists order_items_sales_person_read on public.order_items;
drop policy if exists order_items_service_role_all  on public.order_items;

-- ---- Super Admin ---------------------------------------------------------
create policy order_items_super_admin_read
on public.order_items
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'super_admin'
  )
);

-- ---- Distributor (owner) -------------------------------------------------
create policy order_items_distributor_read
on public.order_items
for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.distributor_id = auth.uid()
  )
);

-- ---- Super Stockist (network) --------------------------------------------
create policy order_items_ss_read
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.ss_networks n on n.distributor_id = o.distributor_id
    where o.id = order_items.order_id
      and n.super_stockist_id = auth.uid()
  )
);

-- ---- Sales Person (area scope) -------------------------------------------
-- Visible when the sales person's area_id matches the order's distributor's
-- area_id. We join profiles twice: once for the caller, once for the
-- distributor who placed the order.
create policy order_items_sales_person_read
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.profiles dp on dp.id = o.distributor_id
    join public.profiles sp on sp.id = auth.uid()
    where o.id = order_items.order_id
      and sp.role = 'sales_person'
      and sp.area_id is not null
      and sp.area_id = dp.area_id
  )
);

-- ---- Service role (cron / server actions / admin client) -----------------
create policy order_items_service_role_all
on public.order_items
for all
to service_role
using (true)
with check (true);
