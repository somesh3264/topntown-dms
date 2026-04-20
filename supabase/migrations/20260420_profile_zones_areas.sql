-- Migration: multi-zone / multi-area assignment for users (profiles)
-- ----------------------------------------------------------------------------
-- Context
--   Previously, profiles.zone_id / profiles.area_id allowed exactly one zone
--   and one area per user. Distributors (and Super Stockists / Sales Persons)
--   frequently cover multiple zones and areas, so we move to many-to-many via
--   junction tables while leaving the legacy singular columns in place (now
--   treated as "primary" zone/area — nullable, not authoritative).
--
-- What this does
--   1. Creates public.profile_zones  (profile_id, zone_id)
--   2. Creates public.profile_areas  (profile_id, area_id)
--   3. Backfills both tables from the existing profiles.zone_id / area_id
--   4. Adds RLS policies:
--        • super_admin: full access
--        • a user can read their own assignments
--        • authenticated users: read-only on both tables (needed for joins /
--          scope checks that still work from the SS portal etc.)
--   5. Refreshes the PostgREST schema cache.
--
-- Rollback
--   DROP TABLE public.profile_areas; DROP TABLE public.profile_zones;
--   (legacy profiles.zone_id / area_id columns are untouched, so rolling back
--   is safe — reads still work against the old columns.)
-- ----------------------------------------------------------------------------

-- ── profile_zones ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_zones (
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  zone_id     uuid        NOT NULL REFERENCES public.zones(id)     ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_zones_profile ON public.profile_zones (profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_zones_zone    ON public.profile_zones (zone_id);

-- ── profile_areas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_areas (
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  area_id     uuid        NOT NULL REFERENCES public.areas(id)     ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_areas_profile ON public.profile_areas (profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_areas_area    ON public.profile_areas (area_id);

-- ── Backfill from legacy singular columns ────────────────────────────────────
-- Every existing user with a zone_id gets one row in profile_zones.
-- Every existing user with an area_id gets one row in profile_areas.
INSERT INTO public.profile_zones (profile_id, zone_id)
  SELECT id, zone_id
  FROM public.profiles
  WHERE zone_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.profile_areas (profile_id, area_id)
  SELECT id, area_id
  FROM public.profiles
  WHERE area_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.profile_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_areas ENABLE ROW LEVEL SECURITY;

-- super_admin: full access
CREATE POLICY "super_admin_all_profile_zones"
  ON public.profile_zones
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "super_admin_all_profile_areas"
  ON public.profile_areas
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- a user can read their own scope rows
CREATE POLICY "self_read_profile_zones"
  ON public.profile_zones
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "self_read_profile_areas"
  ON public.profile_areas
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- authenticated users: read-only (needed for SS network scope checks and
-- cross-role joins that previously relied on profiles.zone_id / area_id)
CREATE POLICY "authenticated_read_profile_zones"
  ON public.profile_zones
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_profile_areas"
  ON public.profile_areas
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Refresh PostgREST schema cache ───────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
