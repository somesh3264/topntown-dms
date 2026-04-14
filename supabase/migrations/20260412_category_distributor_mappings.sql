-- Migration: create category_distributor_mappings table
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.category_distributor_mappings (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  category         text          NOT NULL,
  distributor_id   uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_exclusive     boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now(),

  -- Enforce one row per category+distributor pair (supports upsert onConflict)
  CONSTRAINT uq_category_distributor UNIQUE (category, distributor_id)
);

-- Index for fast look-ups by distributor
CREATE INDEX IF NOT EXISTS idx_cdm_distributor_id
  ON public.category_distributor_mappings (distributor_id);

-- Index for fast look-ups by category
CREATE INDEX IF NOT EXISTS idx_cdm_category
  ON public.category_distributor_mappings (category);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.category_distributor_mappings ENABLE ROW LEVEL SECURITY;

-- super_admin: full access
CREATE POLICY "super_admin_all_cdm"
  ON public.category_distributor_mappings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- authenticated users: read-only (so distributors can see their own mappings)
CREATE POLICY "authenticated_read_cdm"
  ON public.category_distributor_mappings
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Refresh PostgREST schema cache ────────────────────────────────────────────
-- Run this after creating the table so the app can see it immediately
-- without restarting the Supabase project.
NOTIFY pgrst, 'reload schema';
