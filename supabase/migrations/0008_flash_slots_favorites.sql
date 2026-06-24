-- Flash slots : créneaux dernière minute publiés par les pros
create table if not exists flash_slots (
  id uuid primary key default gen_random_uuid(),
  biz_id uuid not null references businesses(id) on delete cascade,
  biz_name text not null,
  service_id uuid references services(id) on delete set null,
  service_name text,
  date date not null,
  time time not null,
  original_deposit numeric(10,2),
  flash_deposit numeric(10,2),
  booking_id uuid references bookings(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table flash_slots enable row level security;

-- Lecture publique des slots actifs
create policy if not exists "flash_slots_public_read"
  on flash_slots for select
  using (active = true);

-- Écriture réservée au pro propriétaire ou admin
create policy if not exists "flash_slots_pro_write"
  on flash_slots for all
  using (
    exists (
      select 1 from app_users
      where id = auth.uid()
      and (biz_id = flash_slots.biz_id or role = 'admin')
    )
  );

-- Favoris clients
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  biz_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, biz_id)
);

alter table favorites enable row level security;

create policy if not exists "favorites_own"
  on favorites for all
  using (user_id = auth.uid());
