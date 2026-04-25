-- Migration: add get_dashboard_mtd_revenue() RPC for the dashboard KPI
-- ----------------------------------------------------------------------------
-- Bug: the "Revenue (MTD)" KPI on /dashboard always showed ₹0. The Server
-- Component (src/app/(dashboard)/dashboard/page.tsx :: RevenueMTD) filtered
-- public.orders by status = 'delivered', but nothing in the system ever
-- writes that status.
--
-- Actual order lifecycle in the live codebase:
--   draft      (distributor started a cart)
--   confirmed  (distributor submitted — set by /api/orders/submit)
--   billed     (nightly cron — set in src/lib/billing.ts)
--   dispatched (admin "Mark picked up" — set in dashboard/orders/actions.ts)
--   delivered  (NEVER WRITTEN — declared in the CHECK constraint and the TS
--               OrderStatus union, but no code path transitions to it; the
--               delivery flow lives in the deliveries table, not orders.status)
--
-- Fix: centralise the MTD aggregate in a server-side RPC so the dashboard
-- stops relying on a status that never materialises. Revenue recognition for
-- TopNTown happens at bill time, so the RPC sums every order that is `billed`
-- or later (billed + dispatched + delivered). If we ever wire a real
-- delivered-transition later, the query still works unchanged.
--
-- Why an RPC and not a fixed client query:
--   • Aggregation runs server-side — no PostgREST row-cap (default 1000)
--     risk on a busy month.
--   • One authoritative number instead of row-by-row JS sum.
--   • SECURITY DEFINER so the computation doesn't depend on each dashboard
--     role's RLS surface on public.orders. The dashboard is already middleware-
--     gated to super_admin / super_stockist / sales_person; we re-assert that
--     inside the function so a distributor calling the RPC directly via
--     PostgREST can't see the platform-wide revenue number.
--   • IST-anchored month boundary via `order_date` (a date column stored in
--     IST) — mirrors how get_todays_deliveries and get_distributor_home
--     already handle "today"; avoids the Mar-31-IST / Apr-1-UTC drift the
--     previous client-side `created_at` filter was vulnerable to.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_dashboard_mtd_revenue();

CREATE OR REPLACE FUNCTION public.get_dashboard_mtd_revenue()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_role        text;
  v_month_start date := date_trunc(
    'month',
    (now() at time zone 'Asia/Kolkata')::date
  )::date;
  v_total       numeric := 0;
BEGIN
  -- Role gate — only dashboard audiences are allowed this aggregate.
  -- fn_my_role() is itself SECURITY DEFINER (see rls_and_triggers.sql) and
  -- returns the caller's profiles.role, so distributors and unauthenticated
  -- callers both land outside this set and get rejected.
  v_role := public.fn_my_role();
  IF v_role NOT IN ('super_admin', 'super_stockist', 'sales_person') THEN
    RAISE EXCEPTION 'Not authorised to view MTD revenue.';
  END IF;

  -- Revenue recognition: bill generated or later. `billed` = invoiced,
  -- `dispatched` = physically handed over from factory, `delivered` = the
  -- (currently unused) fully-delivered terminal state we keep in the set so
  -- this query keeps working if we wire that transition in the future.
  --
  -- Scoping: platform-wide for every dashboard role. This matches the
  -- existing RecentDeliveriesPanel on the same page, which also uses the
  -- admin client to aggregate across all distributors regardless of role.
  -- If/when we want per-network or per-area scoping, extend this function
  -- using fn_is_my_distributor() rather than the client query.
  --
  -- Scalar-subquery assignment (`:=`) instead of SELECT ... INTO: the
  -- Supabase function-body checker mis-parses INTO-targets as relation
  -- references ("relation v_total does not exist") under SECURITY DEFINER.
  -- The existing distributor_app_rpcs migration uses this same workaround
  -- for the same reason — see comments there.
  v_total := COALESCE((
    SELECT SUM(o.total_amount)
      FROM public.orders o
     WHERE o.status IN ('billed', 'dispatched', 'delivered')
       AND o.order_date >= v_month_start
  ), 0)::numeric;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_mtd_revenue() TO authenticated;

NOTIFY pgrst, 'reload schema';
