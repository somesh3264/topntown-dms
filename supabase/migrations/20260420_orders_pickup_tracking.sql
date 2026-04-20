-- Migration: add pickup (dispatch) audit fields on orders
-- ----------------------------------------------------------------------------
-- Why
--   The order edit window closes when the distributor physically picks the
--   stock up from the factory (status → 'dispatched'). Tracking *when* and
--   *who* flipped the status gives us:
--     • an exact cutoff timestamp for disputes ("when did they take it?")
--     • audit trail when a pickup was recorded by an admin vs. sales person
--     • a value the distributor's Android app can show on the order card
--       ("Picked up 06:42 IST") without recomputing from status-change logs
--
-- Both columns are nullable — existing rows have neither, and any order
-- whose status is still 'draft'/'confirmed'/'billed' won't have a pickup
-- timestamp yet. Backfilling old dispatched rows isn't possible (no source
-- of truth) so we leave them NULL and the UI treats that as "unknown".
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists picked_up_at         timestamptz,
  add column if not exists picked_up_by_user_id uuid references public.profiles(id);

-- Helpful for "orders picked up today" dashboards / cron sweeps.
create index if not exists idx_orders_picked_up_at on public.orders (picked_up_at);

notify pgrst, 'reload schema';
