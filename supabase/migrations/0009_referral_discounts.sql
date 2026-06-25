-- Historique des parrainages réussis (1 ligne par parrainé ayant honoré son 1er RDV)
create table if not exists referral_events (
  id                           uuid primary key default gen_random_uuid(),
  referrer_id                  uuid not null references app_users(id) on delete cascade,
  referred_id                  uuid not null references app_users(id) on delete cascade,
  triggered_at                 timestamptz not null default now(),
  parrain_discount_consumed    boolean not null default false,
  parrain_discount_consumed_at timestamptz,
  created_at                   timestamptz not null default now()
);

create index if not exists idx_referral_events_referrer on referral_events(referrer_id);
create index if not exists idx_referral_events_referred on referral_events(referred_id);

alter table referral_events enable row level security;

-- Le parrain voit ses événements, le parrainé voit le sien
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'referral_events'
      and policyname = 'referral_events_own_read'
  ) then
    execute $p$
      create policy "referral_events_own_read"
        on referral_events for select
        using (referrer_id = auth.uid() or referred_id = auth.uid())
    $p$;
  end if;
end $$;

-- Écriture réservée au service role (routes API serveur uniquement)

-- Réduction de parrainage en attente sur le compte client
alter table app_users
  add column if not exists pending_referral_discount_pct integer not null default 0;

-- Nom du parrain dénormalisé dans booking_members (visible par le pro sans jointure)
alter table booking_members
  add column if not exists referrer_name text,
  add column if not exists referral_discount_pct integer not null default 0;
