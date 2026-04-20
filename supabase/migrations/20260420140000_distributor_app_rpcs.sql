-- Migration: distributor-app RPCs (Home, Order, Deliver, Pay, Stock)
-- ----------------------------------------------------------------------------
-- Ships the full set of read + write server functions the new /app/* screens
-- call from the distributor web/mobile client. Keeping everything in one
-- migration so the schema layer is one cohesive unit; splitting by feature
-- would force cross-migration ordering.
--
-- Design notes
--   • All functions are SECURITY INVOKER — they rely on auth.uid() and the
--     caller's RLS scope. None of them elevate privileges.
--   • IST everywhere. "Today" is always (now() at time zone 'Asia/Kolkata')::date
--     matched against deliveries.delivery_date (a date column, NOT NULL).
--   • Stock visibility: a delivery can only consume stock from orders whose
--     status = 'dispatched'. This is the pickup gate we agreed on — billed
--     orders are visible as bills but not as deliverable stock until the
--     Dispatch Manager marks them picked up.
--   • Cash model: there is no separate payment step. deliveries.total_value
--     is the cash captured at delivery time; "Cash Collected" is just a sum
--     of today's total_value.
--   • Denormalised columns: deliveries.total_value and deliveries.item_count
--     are set by submit_delivery after delivery_items are inserted. Both are
--     added by this migration if missing so existing code that reads them
--     (api/delivery/notify, ss/network, reports) also starts working.
--   • All functions are idempotent to (re-)create (CREATE OR REPLACE).
-- ----------------------------------------------------------------------------

-- Ensure denormalised columns exist. Safe to re-run.
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS item_count  int           NOT NULL DEFAULT 0;
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS total_value numeric(12,2) NOT NULL DEFAULT 0;

-- Ensure any previous shapes are cleared so CREATE OR REPLACE succeeds across
-- signature changes.
DROP FUNCTION IF EXISTS public.get_distributor_home();
DROP FUNCTION IF EXISTS public.get_todays_deliveries();
DROP FUNCTION IF EXISTS public.get_order_form_products();
DROP FUNCTION IF EXISTS public.get_stores_for_beat();
DROP FUNCTION IF EXISTS public.get_store_delivery_context(uuid);
DROP FUNCTION IF EXISTS public.get_pay_summary();
DROP FUNCTION IF EXISTS public.get_stock_balance();
DROP FUNCTION IF EXISTS public.submit_delivery(uuid, jsonb);

-- ── Home screen ──────────────────────────────────────────────────────────────
-- One call returns every scalar the Home tiles + header need. The client
-- computes the countdown from cut_off_time rather than us embedding it.
CREATE OR REPLACE FUNCTION public.get_distributor_home()
RETURNS TABLE (
  full_name        text,
  deliveries_count int,
  cash_collected   numeric,
  skus_remaining   numeric,
  stores_on_beat   int,
  cutoff_time      text,    -- "HH:MM"
  cutoff_enabled   boolean,
  support_contact  text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
BEGIN
  RETURN QUERY
  SELECT
    p.full_name,
    COALESCE((
      SELECT COUNT(*)::int FROM public.deliveries d
       WHERE d.distributor_id = v_uid
         AND d.delivery_date = v_date
    ), 0) AS deliveries_count,
    COALESCE((
      SELECT SUM(d.total_value)::numeric FROM public.deliveries d
       WHERE d.distributor_id = v_uid
         AND d.delivery_date = v_date
    ), 0) AS cash_collected,
    -- STRICT: only dispatched-order allocations count toward remaining stock.
    COALESCE((
      SELECT SUM(sa.allocated_qty - sa.delivered_qty)::numeric
        FROM public.stock_allocations sa
        JOIN public.bills  b ON b.id = sa.bill_id
        JOIN public.orders o ON o.id = b.order_id
       WHERE sa.distributor_id = v_uid
         AND o.status = 'dispatched'
    ), 0) AS skus_remaining,
    COALESCE((
      SELECT COUNT(*)::int FROM public.stores s
       WHERE s.primary_distributor_id = v_uid
         AND s.is_active = true
    ), 0) AS stores_on_beat,
    COALESCE(
      (SELECT sc.value FROM public.system_config sc WHERE sc.key = 'cut_off_time'),
      '14:00'
    ) AS cutoff_time,
    COALESCE(
      (SELECT sc.value FROM public.system_config sc WHERE sc.key = 'cut_off_enabled')::boolean,
      true
    ) AS cutoff_enabled,
    (SELECT sc.value FROM public.system_config sc WHERE sc.key = 'support_contact') AS support_contact
  FROM public.profiles p
  WHERE p.id = v_uid;
END;
$$;

-- ── Today's Deliveries list (Home) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_todays_deliveries()
RETURNS TABLE (
  delivery_id  uuid,
  store_id     uuid,
  store_name   text,
  item_count   int,
  delivered_at timestamptz,
  total_value  numeric
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.store_id,
    s.name,
    d.item_count,
    d.created_at,
    d.total_value
  FROM public.deliveries d
  JOIN public.stores s ON s.id = d.store_id
  WHERE d.distributor_id = auth.uid()
    AND d.delivery_date = (now() at time zone 'Asia/Kolkata')::date
  ORDER BY d.created_at DESC;
$$;

-- ── Order screen: product catalog for this distributor ──────────────────────
-- Filters by category_distributor_mappings so a distributor only sees
-- categories they're mapped to. Falls back to "all active products" if the
-- distributor has no mappings (treating absence as unrestricted).
CREATE OR REPLACE FUNCTION public.get_order_form_products()
RETURNS TABLE (
  id               uuid,
  name             text,
  sku_code         text,
  category         text,
  weight           text,
  distributor_price numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid    := auth.uid();
  -- Inline init avoids a SELECT ... INTO statement, which the Supabase SQL
  -- parser mis-resolves as a table reference on some function-body checks.
  v_has_mappings boolean := EXISTS (
    SELECT 1 FROM public.category_distributor_mappings
     WHERE distributor_id = auth.uid()
  );
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.sku_code,
    p.category,
    p.weight,
    p.distributor_price
  FROM public.products p
  WHERE p.is_active = true
    AND (
      NOT v_has_mappings
      OR p.category IN (
        SELECT category FROM public.category_distributor_mappings
         WHERE distributor_id = v_uid
      )
    )
  ORDER BY p.category, p.name;
END;
$$;

-- ── Deliver screen: stores for this distributor ─────────────────────────────
-- Returns every active store where primary_distributor_id = me, with the
-- fields the card needs: name, owner, area, last delivery date, GPS coords
-- (client computes distance + sorts).
CREATE OR REPLACE FUNCTION public.get_stores_for_beat()
RETURNS TABLE (
  id              uuid,
  name            text,
  owner_name      text,
  area_name       text,
  -- stores.gps_lat/lng are double precision in the table; Postgres is strict
  -- on RETURNS TABLE type matching so the declaration must match exactly.
  gps_lat         double precision,
  gps_lng         double precision,
  last_delivered  timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.owner_name,
    a.name,
    s.gps_lat,
    s.gps_lng,
    (
      SELECT MAX(d.created_at) FROM public.deliveries d
       WHERE d.store_id = s.id
         AND d.distributor_id = auth.uid()
    ) AS last_delivered
  FROM public.stores s
  LEFT JOIN public.areas a ON a.id = s.area_id
  WHERE s.primary_distributor_id = auth.uid()
    AND s.is_active = true
  ORDER BY s.name;
$$;

-- ── Per-store delivery context (for the entry screen) ───────────────────────
-- For a specific store the distributor taps, return the products they can
-- deliver + how much of each is currently deliverable (stock remaining,
-- strict). The "stock remaining" is global to the distributor, not per-store
-- (stock is allocated to a distributor, not a distributor+store pair).
CREATE OR REPLACE FUNCTION public.get_store_delivery_context(p_store_id uuid)
RETURNS TABLE (
  store_id         uuid,
  store_name       text,
  store_area       text,
  -- stores.gps_lat/lng are double precision in the table. RETURNS TABLE
  -- types must match exactly — Postgres doesn't implicit-cast here.
  store_gps_lat    double precision,
  store_gps_lng    double precision,
  product_id       uuid,
  product_name     text,
  product_weight   text,
  unit_price       numeric,
  stock_remaining  numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH my_stock AS (
    SELECT
      sa.product_id,
      -- Explicit numeric cast: underlying qty columns may resolve to bigint
      -- via SUM(), and Postgres is strict about RETURNS TABLE type matching.
      SUM(sa.allocated_qty - sa.delivered_qty)::numeric AS remaining
    FROM public.stock_allocations sa
    JOIN public.bills  b ON b.id = sa.bill_id
    JOIN public.orders o ON o.id = b.order_id
    WHERE sa.distributor_id = v_uid
      AND o.status = 'dispatched'
    GROUP BY sa.product_id
    HAVING SUM(sa.allocated_qty - sa.delivered_qty) > 0
  )
  SELECT
    s.id,
    s.name,
    a.name,
    s.gps_lat,
    s.gps_lng,
    p.id,
    p.name,
    p.weight,
    p.retailer_price::numeric,   -- distributor sells to retailer at retailer_price
    ms.remaining
  FROM public.stores s
  LEFT JOIN public.areas a ON a.id = s.area_id
  CROSS JOIN my_stock ms
  JOIN public.products p ON p.id = ms.product_id AND p.is_active = true
  WHERE s.id = p_store_id
    AND s.primary_distributor_id = v_uid
  ORDER BY p.category, p.name;
END;
$$;

-- ── submit_delivery — atomic write ──────────────────────────────────────────
-- Input:
--   p_store_id — UUID of the target store
--   p_items    — JSONB array [{"product_id": uuid, "quantity": numeric}, ...]
--   p_gps_lat  — optional latitude captured at submit time
--   p_gps_lng  — optional longitude captured at submit time
--
-- Behaviour:
--   1. Validate the store belongs to this distributor.
--   2. For each item, confirm sum(allocated_qty - delivered_qty) on dispatched
--      allocations >= requested quantity. Reject the whole submission if any
--      line fails — all-or-nothing, no partial writes.
--   3. Insert one row in deliveries with total_value = Σ(qty × retailer_price)
--      and item_count = Σ(qty) (distinct items).
--   4. Insert one row per item in delivery_items.
--   5. Decrement stock_allocations in oldest-bill-first order until the
--      quantity for each product is satisfied.
--
-- Returns: the new delivery_id and total_value for the success screen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_delivery(
  p_store_id uuid,
  p_items    jsonb,
  p_gps_lat  numeric DEFAULT NULL,
  p_gps_lng  numeric DEFAULT NULL
)
RETURNS TABLE (
  delivery_id uuid,
  total_value numeric,
  item_count  int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_delivery_id uuid;
  v_total       numeric := 0;
  v_count       int := 0;
  v_item        jsonb;
  v_pid         uuid;
  v_qty         numeric;
  v_price       numeric;
  v_available   numeric;
  v_allocation  record;
  v_remaining   numeric;
  v_take        numeric;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items provided.';
  END IF;

  -- 1. Store must belong to this distributor.
  IF NOT EXISTS (
    SELECT 1 FROM public.stores
     WHERE id = p_store_id
       AND primary_distributor_id = v_uid
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Store not found or not assigned to you.';
  END IF;

  -- 2. Pre-flight stock check — fail fast before any inserts.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for product %.', v_pid;
    END IF;

    -- Scalar-subquery assignment instead of SELECT ... INTO, to avoid the
    -- parser mis-resolving v_available as a relation during function body check.
    v_available := COALESCE((
      SELECT SUM(sa.allocated_qty - sa.delivered_qty)
        FROM public.stock_allocations sa
        JOIN public.bills  b ON b.id = sa.bill_id
        JOIN public.orders o ON o.id = b.order_id
       WHERE sa.distributor_id = v_uid
         AND sa.product_id = v_pid
         AND o.status = 'dispatched'
    ), 0);

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %.',
        v_pid, v_available, v_qty;
    END IF;
  END LOOP;

  -- 3. Create the delivery row. total_value is computed below; seed with 0.
  --    status is NOT NULL on the table — 'completed' is the one terminal state
  --    we use from this flow (drafts / pending states aren't supported here).
  INSERT INTO public.deliveries
    (store_id, distributor_id, delivery_date, status, gps_lat, gps_lng, total_value, item_count)
  VALUES
    (p_store_id, v_uid, (now() at time zone 'Asia/Kolkata')::date, 'completed',
     p_gps_lat, p_gps_lng, 0, 0)
  RETURNING id INTO v_delivery_id;

  -- 4. For each item: insert delivery_items, decrement stock_allocations FIFO,
  --    accumulate total.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    v_price := (SELECT p.retailer_price FROM public.products p WHERE p.id = v_pid);
    IF v_price IS NULL THEN
      RAISE EXCEPTION 'Product % has no retailer_price configured.', v_pid;
    END IF;

    INSERT INTO public.delivery_items (delivery_id, product_id, quantity, unit_price)
    VALUES (v_delivery_id, v_pid, v_qty, v_price);

    v_total := v_total + (v_qty * v_price);
    v_count := v_count + 1;

    -- FIFO decrement — iterate dispatched allocations oldest bill first.
    v_remaining := v_qty;
    FOR v_allocation IN
      SELECT sa.id, (sa.allocated_qty - sa.delivered_qty) AS capacity
        FROM public.stock_allocations sa
        JOIN public.bills  b ON b.id = sa.bill_id
        JOIN public.orders o ON o.id = b.order_id
       WHERE sa.distributor_id = v_uid
         AND sa.product_id = v_pid
         AND o.status = 'dispatched'
         AND (sa.allocated_qty - sa.delivered_qty) > 0
       ORDER BY b.bill_date ASC, b.created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_allocation.capacity);
      UPDATE public.stock_allocations
         SET delivered_qty = delivered_qty + v_take
       WHERE id = v_allocation.id;
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      -- Should be unreachable thanks to the pre-flight, but keep as a safety net.
      RAISE EXCEPTION 'Stock race — could not fully allocate product %.', v_pid;
    END IF;
  END LOOP;

  -- 5. Finalise total_value + item_count on the delivery row.
  UPDATE public.deliveries
     SET total_value = v_total,
         item_count  = v_count
   WHERE id = v_delivery_id;

  RETURN QUERY
  SELECT v_delivery_id, v_total, v_count;
END;
$$;

-- ── Pay screen: today's deliveries grouped by store ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_pay_summary()
RETURNS TABLE (
  store_id          uuid,
  store_name        text,
  deliveries_count  int,
  total_value       numeric,
  latest_delivered  timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.store_id,
    s.name,
    COUNT(*)::int,
    SUM(d.total_value),
    MAX(d.created_at)
  FROM public.deliveries d
  JOIN public.stores s ON s.id = d.store_id
  WHERE d.distributor_id = auth.uid()
    AND d.delivery_date = (now() at time zone 'Asia/Kolkata')::date
  GROUP BY d.store_id, s.name
  ORDER BY SUM(d.total_value) DESC;
$$;

-- ── Stock screen: per-SKU allocated / delivered / remaining ─────────────────
-- Strict: dispatched orders only. Mirrors the Home "SKUs Remaining" tile.
CREATE OR REPLACE FUNCTION public.get_stock_balance()
RETURNS TABLE (
  product_id     uuid,
  product_name   text,
  sku_code       text,
  category       text,
  allocated_qty  numeric,
  delivered_qty  numeric,
  remaining_qty  numeric
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.sku_code,
    p.category,
    SUM(sa.allocated_qty)::numeric,
    SUM(sa.delivered_qty)::numeric,
    SUM(sa.allocated_qty - sa.delivered_qty)::numeric
  FROM public.stock_allocations sa
  JOIN public.bills   b ON b.id = sa.bill_id
  JOIN public.orders  o ON o.id = b.order_id
  JOIN public.products p ON p.id = sa.product_id
  WHERE sa.distributor_id = auth.uid()
    AND o.status = 'dispatched'
  GROUP BY p.id, p.name, p.sku_code, p.category
  HAVING SUM(sa.allocated_qty) > 0
  ORDER BY p.category, p.name;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
-- All functions are SECURITY INVOKER and use auth.uid(); we just need to
-- grant EXECUTE to authenticated users. RLS on the underlying tables still
-- applies.
GRANT EXECUTE ON FUNCTION public.get_distributor_home()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_todays_deliveries()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_form_products()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stores_for_beat()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_delivery_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_delivery(uuid, jsonb, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pay_summary()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_balance()              TO authenticated;

NOTIFY pgrst, 'reload schema';
