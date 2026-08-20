-- supabase/migrations/0062_client_loyalty_for_pro.sql
-- Chantier FicheClientIntelligente (audit navigateur 20/08/2026) : la route
-- api/pro/client-stats interrogeait app_users directement via le client RLS
-- du pro, jamais habilité à lire la ligne d'un client (policy
-- app_users_select, migration 0022 : id = auth.uid() OR is_admin()).
-- Résultat, jamais vu avant faute d'un vrai parcours navigateur : appUser
-- est toujours resté null, pour tout pro sur tout client, depuis le tout
-- premier commit (21/06/2026) — la section fidélité de la fiche client
-- s'est toujours affichée vide, sans jamais afficher les vraies données.
--
-- Fonction dédiée plutôt qu'un service role sans filtrage (qui exposerait
-- toute la ligne app_users — rôle, biz_id, code de parrainage...) ou une
-- policy RLS élargie (qui donnerait accès à TOUTE la ligne, pas seulement
-- aux 4 colonnes fidélité). Règle d'éligibilité strictement identique à
-- celle qui protège déjà booking_members (policy booking_members_select,
-- migration 0022 : USING (check_booking_access(booking_id, phone))) — on
-- réutilise cette même fonction plutôt que d'en réécrire une équivalente,
-- pour ne jamais diverger entre les deux (voir 0057 : check_booking_access
-- reste la source unique pour "un pro a-t-il un lien de réservation réel
-- avec ce téléphone").
create or replace function public.get_client_loyalty_for_pro(p_phone text)
returns table (
  statut text,
  jokers_disponibles integer,
  jokers_utilises integer,
  rdv_honores integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_has_access boolean;
begin
  -- p_phone normalisé ici (pas seulement côté appelant TS) : les téléphones
  -- sont normalisés en base depuis 0059/0060, mais un futur appelant de
  -- cette fonction (nouvelle route, appel RPC direct) pourrait transmettre
  -- un numéro brut — cette fonction ne doit pas en dépendre silencieusement.
  select exists (
    select 1
    from public.booking_members bm
    where bm.phone = v_phone
      and public.check_booking_access(bm.booking_id, bm.phone)
  ) into v_has_access;

  if not v_has_access then
    return;
  end if;

  -- Cast nécessaire sur statut (confirmé 20/08 : ENUM Postgres
  -- loyalty_status, pas text — RETURN QUERY exige un type EXACTEMENT
  -- identique au OUT déclaré, pas seulement assignable). Les 3 compteurs
  -- sont déjà des integer en base, aucun cast requis (confirmé par
  -- information_schema.columns le même jour) — sans ça : "structure of
  -- query does not match function result type" (prouvé par appel réel via
  -- scripts/audit/client-loyalty-rpc-probe.mjs).
  return query
    select u.statut::text, u.jokers_disponibles, u.jokers_utilises, u.rdv_honores
    from public.app_users u
    where u.phone = v_phone;
end;
$$;

-- PostgreSQL accorde EXECUTE à public par défaut sur toute nouvelle
-- fonction — combiné à SECURITY DEFINER, ça laisserait n'importe qui,
-- y compris un visiteur anonyme muni de la seule clé anon publique, appeler
-- cette RPC. L'éligibilité via check_booking_access protège en pratique
-- (un anonyme n'a pas d'auth.uid()), mais on ne laisse pas une fonction à
-- privilèges élevés ouverte à anon par défaut — retrait explicite, accès
-- réservé aux sessions authentifiées.
revoke execute on function public.get_client_loyalty_for_pro(text) from public, anon;
grant execute on function public.get_client_loyalty_for_pro(text) to authenticated;

-- Vérification post-migration (lecture seule) : la fonction doit exister
-- avec SECURITY DEFINER, le search_path fixé, et EXECUTE retiré de public/anon.
select proname, prosecdef, proconfig
from pg_proc
where proname = 'get_client_loyalty_for_pro';

select grantee, privilege_type
from information_schema.routine_privileges
where routine_name = 'get_client_loyalty_for_pro';
