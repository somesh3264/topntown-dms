-- Migration: introduce the dispatch_manager role
-- ----------------------------------------------------------------------------
-- Context
--   Previously only super_admin / sales_person could mark an order as picked
--   up (see markOrderPickedUp in orders/actions.ts). That coupled the field
--   sales team with a factory-gate operation they don't do. We're introducing
--   a narrow role whose sole responsibility is to stamp pickup on orders as
--   distributors physically collect stock from the factory.
--
-- Scope
--   • Users with role = 'dispatch_manager' can sign in, see ONLY the
--     /dashboard/dispatch screen, and invoke markOrderPickedUp via that UI.
--   • They do NOT need a zone or area — they operate at a single factory.
--   • They cannot place, edit, bill, cancel, or view financials on orders.
--
-- This migration
--   • Widens any CHECK constraint on profiles.role that would otherwise
--     reject the new value. Idempotent — safe to run on databases that
--     don't have the constraint.
--   • Does NOT insert any users. Use the User Management UI (Super Admin
--     only) to create the first dispatch_manager.
--
-- Rollback
--   Set affected users' role back to an existing value, then:
--     ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
--     ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--       CHECK (role IN ('super_admin','super_stockist','sales_person','distributor'));
-- ----------------------------------------------------------------------------

-- Widen the role CHECK constraint (if any). We drop-then-recreate so this is
-- safe to re-run. If the column uses a Postgres ENUM type instead of a CHECK,
-- this block is a no-op and the ENUM must be widened manually with
--   ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'dispatch_manager';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'super_admin',
    'super_stockist',
    'sales_person',
    'distributor',
    'dispatch_manager'
  ));

NOTIFY pgrst, 'reload schema';
