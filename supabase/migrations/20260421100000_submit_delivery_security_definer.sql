-- Migration: fix stock not decrementing after a delivery is logged
-- ----------------------------------------------------------------------------
-- Bug: when a distributor submits a delivery via submit_delivery(), the
-- deliveries + delivery_items rows are created correctly, but the matching
-- stock_allocations.delivered_qty UPDATE silently affects 0 rows. As a result
-- the Stock tab, Home "SKUs Remaining" tile, and the per-store Deliver screen
-- all keep showing the original (pre-delivery) stock counts until the admin
-- manually re-allocates.
--
-- Root cause: submit_delivery() was declared SECURITY INVOKER, so the UPDATE
-- on public.stock_allocations runs under the caller's RLS scope. The live RLS
-- on that table (see rls_and_triggers.sql — policies sa_select, sa_modify)
-- only grants:
--     • SELECT to the owning distributor (sa_select)
--     • ALL to super_admin          (sa_modify)
-- Distributors have no UPDATE policy, so the decrement fails as a no-op with
-- no error — the RPC returns a success row back to the app and everything
-- looks fine client-side while stock never moves.
--
-- Fix: promote submit_delivery() to SECURITY DEFINER so the stock update
-- bypasses RLS. The function is already self-policing:
--   • auth.uid() is captured into v_uid up front
--   • store ownership is checked via primary_distributor_id = v_uid
--   • every stock_allocations query (pre-flight and FIFO decrement) is scoped
--     to sa.distributor_id = v_uid
--   • deliveries rows are inserted with distributor_id = v_uid
-- so lifting RLS inside the function does not widen the caller's authority —
-- they can still only affect their own allocations.
--
-- We also harden the function with an explicit auth.uid() null-guard. Today
-- this is unreachable because EXECUTE is only granted to `authenticated`,
-- but it makes the intent obvious and avoids relying solely on the grant.
--
-- RLS on stock_allocations is intentionally NOT loosened — granting direct
-- UPDATE on that table to distributors via PostgREST would let them edit
-- delivered_qty to any value, bypassing the pre-flight stock check, the FIFO
-- decrement order, and the paired deliveries/delivery_items write. The RPC
-- is the correct chokepoint for stock mutations.
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
SECURITY DEFINER
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
  -- Iterate into explicit scalars instead of a RECORD variable. Supabase's
  -- function-body checker (triggered on CREATE OR REPLACE under SECURITY
  -- DEFINER) tries to validate `v_allocation.id` eagerly; because v_allocation
  -- is an untyped record, the field lookup is deferred to runtime and the
  -- checker mis-parses it as a missing table alias ("missing FROM-clause
  -- entry for table v_allocation"). Scalars sidestep the whole thing.
  v_alloc_id       uuid;
  v_alloc_capacity numeric;
  v_remaining   numeric;
  v_take        numeric;
BEGIN
  -- SECURITY DEFINER: guard explicitly against an unauthenticated call.
  -- Grant is `authenticated`-only, but belt-and-suspenders.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

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
    -- Iterating into (v_alloc_id, v_alloc_capacity) instead of a RECORD avoids
    -- the parser ambiguity documented in the DECLARE block above.
    v_remaining := v_qty;
    FOR v_alloc_id, v_alloc_capacity IN
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
      v_take := LEAST(v_remaining, v_alloc_capacity);
      -- This UPDATE previously silently affected 0 rows under SECURITY INVOKER
      -- because distributors have no UPDATE policy on stock_allocations. Under
      -- SECURITY DEFINER the function owner bypasses RLS, and the scoping on
      -- v_uid above ensures a distributor can still only decrement their own
      -- allocations. The target table is aliased (`sa`) and all columns are
      -- qualified so there is no way for the checker to mis-parse the scalar
      -- variables as missing table references.
      UPDATE public.stock_allocations AS sa
         SET delivered_qty = sa.delivered_qty + v_take
       WHERE sa.id = v_alloc_id
         AND sa.distributor_id = v_uid;  -- defence-in-depth: re-check ownership
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      -- Unreachable thanks to the pre-flight + SECURITY DEFINER; kept as a
      -- safety net. Under SECURITY INVOKER this was ALSO unreachable because
      -- the UPDATE silently did nothing — which is how the bug slipped in.
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

-- Re-grant EXECUTE (CREATE OR REPLACE preserves grants, but re-assert to make
-- the migration self-contained if applied against a drifted schema).
GRANT EXECUTE ON FUNCTION public.submit_delivery(uuid, jsonb, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
