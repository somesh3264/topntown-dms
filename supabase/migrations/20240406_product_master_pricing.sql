-- =============================================================================
-- Migration: Product Master & Pricing Engine
-- Sprint 2 — TopNTown DMS v1.1
-- =============================================================================
-- Tables created:
--   products                     — SKU master
--   price_overrides              — per-user price overrides (distributor/retailer)
--   discount_slabs               — quantity/value discount slabs per product
--   category_distributor_mappings — category → distributor exclusivity mapping
-- =============================================================================

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null check (category in ('Bread','Biscuits','Cakes','Rusk','Other')),
  mrp           numeric(10,2) not null check (mrp >= 0),
  base_price    numeric(10,2) check (base_price >= 0),
  weight_size   text not null default '',
  tax_rate      numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Trigger: keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- RLS
alter table public.products enable row level security;

-- Super admin: full access
create policy "super_admin can manage products"
  on public.products for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );

-- All authenticated users: read active products only
create policy "authenticated users can read active products"
  on public.products for select
  using (is_active = true and auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- price_overrides
-- ---------------------------------------------------------------------------
create table if not exists public.price_overrides (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id) on delete cascade,
  tier           text not null check (tier in ('distributor','retailer')),
  user_id        uuid not null references auth.users(id) on delete cascade,
  price          numeric(10,2) not null check (price >= 0),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),

  -- One override row per (product, tier, user) — upsert target
  unique (product_id, tier, user_id)
);

alter table public.price_overrides enable row level security;

create policy "super_admin can manage price_overrides"
  on public.price_overrides for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );

-- Distributors can read their own overrides
create policy "distributor reads own price_overrides"
  on public.price_overrides for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- discount_slabs
-- ---------------------------------------------------------------------------
create table if not exists public.discount_slabs (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products(id) on delete cascade,
  slab_type        text not null check (slab_type in ('quantity','value')),
  min_value        numeric(10,2) not null check (min_value >= 0),
  max_value        numeric(10,2) check (max_value is null or max_value >= min_value),
  discount_percent numeric(5,2) not null check (discount_percent >= 0 and discount_percent <= 100),
  applicable_tier  text not null check (applicable_tier in ('distributor','retailer')),
  created_at       timestamptz not null default now()
);

alter table public.discount_slabs enable row level security;

create policy "super_admin can manage discount_slabs"
  on public.discount_slabs for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );

-- Distributors/retailers can read slabs for their tier
create policy "authenticated can read relevant discount_slabs"
  on public.discount_slabs for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- category_distributor_mappings
-- ---------------------------------------------------------------------------
create table if not exists public.category_distributor_mappings (
  id              uuid primary key default gen_random_uuid(),
  category        text not null check (category in ('Bread','Biscuits','Cakes','Rusk','Other')),
  distributor_id  uuid not null references auth.users(id) on delete cascade,
  is_exclusive    boolean not null default true,
  created_at      timestamptz not null default now(),

  -- Upsert target: one row per (category, distributor)
  unique (category, distributor_id)
);

alter table public.category_distributor_mappings enable row level security;

create policy "super_admin can manage category_distributor_mappings"
  on public.category_distributor_mappings for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );

create policy "authenticated can read category_distributor_mappings"
  on public.category_distributor_mappings for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Indexes for common queries
-- ---------------------------------------------------------------------------
create index if not exists idx_products_category on public.products (category);
create index if not exists idx_products_is_active on public.products (is_active);
create index if not exists idx_price_overrides_product_tier on public.price_overrides (product_id, tier);
create index if not exists idx_discount_slabs_product on public.discount_slabs (product_id);
create index if not exists idx_cdm_category on public.category_distributor_mappings (category);
