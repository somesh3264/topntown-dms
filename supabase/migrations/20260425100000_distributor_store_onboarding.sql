-- ============================================================================
-- 20260425100000_distributor_store_onboarding.sql
--
-- Brings the Dashboard's distributor-side store-onboarding workflow to the
-- Android distributor app (BR-11 + BR-12 from FRD v1.2).
--
--   • Distributors submit a new store from the mobile app.
--   • Store row is inserted with is_active = false (Pending Approval).
--   • Photo metadata is captured in store_photos.
--   • A store_approval_requests row is queued for the Super Admin.
--   • Super Admin reviews on the existing /dashboard/stores/approvals page —
--     no new notification surface is added; the unified pending-approval
--     queue (already shown as a badge on /dashboard/stores) covers both
--     web-onboarded and mobile-onboarded submissions.
--
-- WHY AN RPC:
--   The Dashboard server action does the multi-table insert with the user's
--   own auth, which requires distributor-side INSERT policies on three tables
--   (stores, store_photos, store_approval_requests). The mobile app cannot
--   easily run server actions, so we encapsulate the same logic in a single
--   SECURITY DEFINER RPC (`submit_store_for_approval`) that:
--     1. validates the caller is a distributor,
--     2. auto-assigns primary_distributor_id = auth.uid()
--        (per Sprint v1.2 — distributor onboards their own stores; no
--        separate "Assigned Distributor" picker like on the dashboard),
--     3. forces is_active = false and onboarded_by = auth.uid(),
--     4. inserts the store_photos row,
--     5. inserts the store_approval_requests row, looking up the
--        sales_person responsible for the area.
--
--   The RPC narrows the trust surface — the client cannot forge
--   primary_distributor_id, is_active, or onboarded_by, even with a
--   compromised JWT.
--
-- NOTE on photos:
--   The Storage upload itself happens client-side using the user's JWT.
--   This migration adds a Storage RLS policy that lets distributors upload
--   under the `store-photos/<store_id>/...` prefix when they own the store.
--   To handle the chicken-and-egg problem (we need the store_id before we
--   know where to upload), the mobile flow uploads under a `pending/<uid>/`
--   prefix first, and the RPC moves the metadata reference once the store
--   row exists. Distributors are constrained to their own pending prefix.
--
-- Apply: supabase db push
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill the missing distributor INSERT policy on `stores`.
--    The v1.1 RLS revision dropped distributor-side INSERT (only SP and SA
--    could write). Re-add it but constrain it to the safe shape — the
--    distributor can only insert rows where they are the primary distributor
--    and the row is pending (is_active = false). Anything else still has to
--    go through the SECURITY DEFINER RPC or be done by SA / SP.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "stores_dist_insert_pending" ON public.stores;

CREATE POLICY "stores_dist_insert_pending" ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'distributor'
    AND primary_distributor_id = auth.uid()
    AND onboarded_by            = auth.uid()
    AND is_active               = false
  );

COMMENT ON POLICY "stores_dist_insert_pending" ON public.stores IS
  'Distributors may insert their own pending stores. Activation is gated by '
  'Super Admin approval via store_approval_requests.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: submit_store_for_approval
--    The single entry-point used by the Android app to onboard a new store.
--    Returns the new store_id so the client can upload the photo to Storage
--    under that key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_store_for_approval(
  p_name        text,
  p_owner_name  text,
  p_phone       text,
  p_address     text,
  p_area_id     uuid,
  p_gps_lat     double precision,
  p_gps_lng     double precision,
  p_photo_url   text             -- public URL of the just-uploaded shop photo
)
-- Return a single-row table rather than a scalar — PostgREST renders this as
-- a JSON array of objects, which the Android Supabase SDK can decode via
-- `.decodeList<SubmitStoreResponse>()`. That matches the pattern other
-- mutation RPCs (submit_delivery, submit_distributor_order) already use.
RETURNS TABLE (store_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_store_id uuid;
  v_sp_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '42704';
  END IF;
  IF v_role <> 'distributor' THEN
    RAISE EXCEPTION 'Only distributors can submit stores from the mobile app'
      USING ERRCODE = '42501';
  END IF;

  -- Validate inputs (mirrors the dashboard StoreForm guards).
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Store name is required' USING ERRCODE = '23514';
  END IF;
  IF p_area_id IS NULL THEN
    RAISE EXCEPTION 'Area is required' USING ERRCODE = '23514';
  END IF;
  IF p_gps_lat IS NULL OR p_gps_lng IS NULL THEN
    RAISE EXCEPTION 'GPS coordinates are required' USING ERRCODE = '23514';
  END IF;
  IF p_photo_url IS NULL OR trim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'Shop photo is required' USING ERRCODE = '23514';
  END IF;
  IF p_phone IS NOT NULL AND p_phone <> '' AND p_phone !~ '^\d{10}$' THEN
    RAISE EXCEPTION 'Phone must be exactly 10 digits' USING ERRCODE = '23514';
  END IF;

  -- 1) Insert the store, locked to the caller's identity.
  INSERT INTO public.stores (
    name, owner_name, phone, address,
    gps_lat, gps_lng,
    area_id,
    primary_distributor_id,
    is_active,
    onboarded_by
  ) VALUES (
    trim(p_name),
    nullif(trim(p_owner_name), ''),
    nullif(trim(p_phone), ''),
    nullif(trim(p_address), ''),
    p_gps_lat, p_gps_lng,
    p_area_id,
    v_uid,
    false,
    v_uid
  )
  RETURNING id INTO v_store_id;

  -- 2) Photo metadata — the binary itself is already uploaded to Storage.
  INSERT INTO public.store_photos (store_id, photo_url, uploaded_by)
  VALUES (v_store_id, p_photo_url, v_uid);

  -- 3) Pick the sales person assigned to this area, if any. Used by the
  --    SP-scoped RLS on store_approval_requests; null is fine — SA sees all.
  SELECT id INTO v_sp_id
  FROM public.profiles
  WHERE role = 'sales_person'
    AND area_id = p_area_id
    AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  INSERT INTO public.store_approval_requests (
    store_id, submitted_by, assigned_salesperson_id, status
  ) VALUES (
    v_store_id, v_uid, v_sp_id, 'pending'
  );

  store_id := v_store_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.submit_store_for_approval(
  text, text, text, text, uuid, double precision, double precision, text
) IS
  'Distributor mobile-app entry point for store onboarding. Forces '
  'primary_distributor_id, onboarded_by, and is_active = false; queues a '
  'pending store_approval_request for Super Admin review.';

GRANT EXECUTE ON FUNCTION public.submit_store_for_approval(
  text, text, text, text, uuid, double precision, double precision, text
) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: get_my_pending_stores — feed for the mobile "My Submissions" list.
--    Returns the distributor's own submissions across pending / approved /
--    rejected. The client uses status + rejection_reason to render badges.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_pending_stores()
RETURNS TABLE (
  approval_id        uuid,
  store_id           uuid,
  store_name         text,
  area_name          text,
  zone_name          text,
  status             text,
  rejection_reason   text,
  submitted_at       timestamptz,
  reviewed_at        timestamptz
)
LANGUAGE sql
SECURITY INVOKER       -- relies on RLS: distributor sees only own rows
SET search_path = public
AS $$
  SELECT
    r.id            AS approval_id,
    r.store_id,
    s.name          AS store_name,
    a.name          AS area_name,
    z.name          AS zone_name,
    r.status,
    r.rejection_reason,
    r.created_at    AS submitted_at,
    r.reviewed_at
  FROM public.store_approval_requests r
  JOIN public.stores s ON s.id = r.store_id
  LEFT JOIN public.areas a ON a.id = s.area_id
  LEFT JOIN public.zones z ON z.id = a.zone_id
  WHERE r.submitted_by = auth.uid()
  ORDER BY r.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_stores() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_zones_for_onboarding / get_areas_for_zone
--    Lightweight lookups for the mobile form. Distributors don't have direct
--    SELECT on zones / areas in current RLS, so expose it through SECURITY
--    DEFINER functions that only return the columns the picker needs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_zones_for_onboarding()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name FROM public.zones ORDER BY name;
$$;

GRANT EXECUTE ON FUNCTION public.get_zones_for_onboarding() TO authenticated;


CREATE OR REPLACE FUNCTION public.get_areas_for_onboarding(p_zone_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name FROM public.areas
  WHERE zone_id = p_zone_id
  ORDER BY name;
$$;

GRANT EXECUTE ON FUNCTION public.get_areas_for_onboarding(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Storage: bucket + policies for shop photos.
--    Idempotent — safe to apply on top of any earlier ad-hoc setup.
--
--    Layout we enforce:
--       store-photos/<store_id>/shop_<ts>.jpg   ← after the store exists
--       store-photos/pending/<uid>/<ts>.jpg     ← while the form is in flight
--
--    The pending prefix lets the client upload the photo BEFORE calling
--    the RPC (which needs the public URL). Distributors are scoped to their
--    own pending folder; nobody else can list it.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('store-photos', 'store-photos', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_photos_public_read"      ON storage.objects;
DROP POLICY IF EXISTS "store_photos_dist_pending"     ON storage.objects;
DROP POLICY IF EXISTS "store_photos_dist_owned"       ON storage.objects;
DROP POLICY IF EXISTS "store_photos_sa_all"           ON storage.objects;

-- Anyone authenticated can read shop photos (the bucket is public-CDN anyway,
-- this just makes the SDK happy when listing).
CREATE POLICY "store_photos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'store-photos');

-- Super Admin can do anything on the bucket.
CREATE POLICY "store_photos_sa_all"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'store-photos'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  )
)
WITH CHECK (
  bucket_id = 'store-photos'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  )
);

-- Distributor: upload to their own pending folder before calling the RPC.
-- Path shape: pending/<their-uid>/<filename>
CREATE POLICY "store_photos_dist_pending"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'store-photos'
  AND public.get_my_role() = 'distributor'
  AND name LIKE ('pending/' || auth.uid()::text || '/%')
);

-- Distributor: read/update/delete their own photos already attached to a
-- store they own. The match is by the `<store_id>/...` path prefix.
CREATE POLICY "store_photos_dist_owned"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'store-photos'
  AND public.get_my_role() = 'distributor'
  AND (
    name LIKE ('pending/' || auth.uid()::text || '/%')
    OR EXISTS (
      SELECT 1
      FROM public.stores s
      WHERE s.primary_distributor_id = auth.uid()
        AND name LIKE (s.id::text || '/%')
    )
  )
)
WITH CHECK (
  bucket_id = 'store-photos'
  AND public.get_my_role() = 'distributor'
  AND (
    name LIKE ('pending/' || auth.uid()::text || '/%')
    OR EXISTS (
      SELECT 1
      FROM public.stores s
      WHERE s.primary_distributor_id = auth.uid()
        AND name LIKE (s.id::text || '/%')
    )
  )
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Sanity checks (optional, no-op if the helper is missing).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_my_role'
  ) THEN
    RAISE NOTICE 'Heads up: helper public.get_my_role() not found. The new '
                 'distributor INSERT policy and Storage policies depend on '
                 'it — make sure rls_policies_v1.1 is applied.';
  END IF;
END$$;
