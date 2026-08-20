-- supabase/migrations/0060_phone_normalize_backfill.sql
-- Chantier de normalisation téléphone (docs/plan-normalisation-telephone.md).
-- 2e des 3 migrations, dans cet ORDRE STRICT — n'exécuter qu'APRÈS 0059
-- (trigger de normalisation) vérifié en place. NE PAS exécuter 0061 (CHECK
-- resserré) avant celle-ci : le CHECK rejetterait encore le format brut "0X"
-- sur des lignes non encore backfillées.
--
-- Comptage exact au 19/08/2026 (lecture service_role, juste avant cette
-- migration) : app_users.phone 3 lignes à normaliser / 1 déjà +33 ;
-- booking_members.phone 12/2 ; businesses.phone 2/0 ; bookings.client_phone
-- 12 lignes valides à normaliser, 2 déjà +33, 1 invalide ("okokokok",
-- booking déjà clos, décision Pierre 19/08 : mettre à null plutôt que
-- laisser une valeur non-téléphone dans une colonne téléphone).
--
-- BEGIN/COMMIT explicite (différent des autres migrations de ce repo,
-- volontaire ici) : le plan a identifié un risque d'atomicité si les 4
-- tables n'étaient pas normalisées ensemble — la fenêtre entre deux étapes
-- séparées est exactement l'état actuel qui casse déjà l'accès de 2 vrais
-- clients récurrents (numéro en double format). En les regroupant dans une
-- seule transaction, elles deviennent visibles ensemble ou pas du tout.
begin;

-- app_users.phone : seules les lignes en format brut "0X" changent (le
-- CHECK existant, migration 0056, garantit qu'il n'y a rien d'invalide ici).
update public.app_users
  set phone = public.normalize_phone(phone)
  where phone ~ '^0'
  returning id, phone;

update public.booking_members
  set phone = public.normalize_phone(phone)
  where phone ~ '^0'
  returning id, booking_id, phone;

update public.businesses
  set phone = public.normalize_phone(phone)
  where phone ~ '^0'
  returning id, phone;

-- bookings.client_phone n'a AUCUNE contrainte de format (jamais touché par
-- la 0056) : peut contenir une valeur non-téléphone ("okokokok"). Normalise
-- si le format est valide (brut ou déjà +33/DOM-TOM), sinon null — décision
-- Pierre 19/08. Les lignes déjà en +33/DOM-TOM valide sont exclues du WHERE,
-- rien à leur faire.
update public.bookings
  set client_phone = case
    when client_phone ~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$'
      then public.normalize_phone(client_phone)
    else null
  end
  where client_phone is not null
    and client_phone !~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$'
  returning id, client_phone;

commit;

-- Vérification post-migration (lecture seule) : plus aucune ligne en format
-- brut "0X" sur les 3 premières tables, et bookings.client_phone ne doit
-- plus contenir que du null ou du +33/DOM-TOM valide.
select 'app_users' as table_name, count(*) as lignes_encore_brutes from public.app_users where phone ~ '^0'
union all
select 'booking_members', count(*) from public.booking_members where phone ~ '^0'
union all
select 'businesses', count(*) from public.businesses where phone ~ '^0'
union all
select 'bookings.client_phone', count(*) from public.bookings
  where client_phone is not null and client_phone !~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$';
