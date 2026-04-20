-- Migration: widen orders.status CHECK to include 'dispatched'
-- ----------------------------------------------------------------------------
-- Why
--   The 'dispatched' status was added to the order lifecycle when we
--   introduced the pickup tracking flow (see 20260420_orders_pickup_tracking).
--   The application sets status = 'dispatched' from markOrderPickedUp(), but
--   the original orders_status_check CHECK constraint predates that status
--   and rejected the UPDATE with a 23514.
--
--   This migration replaces the constraint with the full set of statuses
--   the application actually uses: draft, confirmed, billed, dispatched,
--   delivered, cancelled.
--
-- Idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft','confirmed','billed','dispatched','delivered','cancelled'));

NOTIFY pgrst, 'reload schema';
