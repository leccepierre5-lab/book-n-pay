-- 0054_search_misses.sql
-- Écran zéro résultat sur /recherche (Bloc B, 14/08) : capte la donnée la
-- plus utile pour le démarchage commercial (quel métier, quelle ville sont
-- demandés) — aujourd'hui une recherche sans résultat ne laisse aucune trace.
--
-- Deux natures de données bien séparées dans cette table :
-- 1. Le journal silencieux (action='none') est écrit SANS consentement à
--    chaque recherche vide, même sans geste du visiteur — c'est de la donnée
--    d'usage anonyme, pas de la donnée personnelle, À CONDITION qu'aucun
--    champ ne permette de relier deux lignes à une même personne. Décision
--    actée le 14/08 : pas de session_id ni d'IP sur cette table pour cette
--    raison — n'en ajoute jamais un sans revalider ce point.
-- 2. Les deux actions consenties (notify/invite) créent chacune leur PROPRE
--    ligne, jamais un update du journal silencieux — ça garantit qu'aucun
--    identifiant ne relie une ligne 'none' à une ligne 'notify'/'invite'.
create table if not exists public.search_misses (
  id uuid primary key default gen_random_uuid(),
  query text,
  category text,
  city text,
  postal_code text,
  user_email text,
  action text not null default 'none'
    check (action in ('none', 'notify', 'invite')),
  invited_business_name text,
  invited_business_contact text,
  -- Article 14 RGPD : les coordonnées d'un pro invité sont une donnée d'un
  -- tiers non consentant — informed_at est la preuve qu'il a été informé de
  -- la source au premier contact. Rempli à la main depuis
  -- /admin/recherches-vides, jamais automatiquement (pas d'envoi d'email
  -- automatique dans ce lot).
  informed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Cohérence : une ligne 'notify' porte un email, une ligne 'invite' porte
  -- un nom de pro — évite qu'une donnée personnelle atterrisse ici sans son
  -- action de consentement associée.
  check (
    (action = 'none')
    or (action = 'notify' and user_email is not null)
    or (action = 'invite' and invited_business_name is not null)
  )
);

create index if not exists search_misses_created_at_idx
  on public.search_misses (created_at desc);

create index if not exists search_misses_category_city_idx
  on public.search_misses (category, city);

alter table public.search_misses enable row level security;
-- service_role uniquement, aucune policy client — même schéma que
-- refund_failures (0052) : fermé à anon/authenticated par défaut, toute
-- écriture (journal ou action visiteur) passe par une route serveur.
