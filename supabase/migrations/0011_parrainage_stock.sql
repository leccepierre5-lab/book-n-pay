-- 0011_parrainage_stock.sql
-- Stock de réductions cumulatives pour le parrainage (parrain -20%, bonus palier frais offerts)
--
-- ⚠️ Ce SQL a été exécuté manuellement dans Supabase SQL Editor le 26/06/2026.
-- Ce fichier documente la migration pour permettre la reproduction sur un nouveau projet.

-- Colonnes de stock sur app_users
alter table app_users
  add column if not exists referral_discounts_available    integer not null default 0,
  add column if not exists free_management_fees_available  integer not null default 0;

-- RPC atomiques — GREATEST(0, …) protège contre un stock négatif en cas de race condition

create or replace function incr_referral_discounts(uid uuid)
returns void language sql security definer as $$
  update app_users
  set referral_discounts_available = referral_discounts_available + 1
  where id = uid;
$$;

create or replace function decr_referral_discounts(uid uuid)
returns void language sql security definer as $$
  update app_users
  set referral_discounts_available = GREATEST(0, referral_discounts_available - 1)
  where id = uid;
$$;

create or replace function incr_free_management_fees(uid uuid)
returns void language sql security definer as $$
  update app_users
  set free_management_fees_available = free_management_fees_available + 1
  where id = uid;
$$;

create or replace function decr_free_management_fees(uid uuid)
returns void language sql security definer as $$
  update app_users
  set free_management_fees_available = GREATEST(0, free_management_fees_available - 1)
  where id = uid;
$$;

-- Migration : anciens parrains récompensés avec pending_referral_discount_pct = 20
-- (avant le passage au système de stock) → convertis en referral_discounts_available = 1
update app_users
set
  referral_discounts_available  = 1,
  pending_referral_discount_pct = 0
where pending_referral_discount_pct = 20;
