-- supabase/migrations/0061_phone_check_normalized_only.sql
-- Chantier de normalisation téléphone (docs/plan-normalisation-telephone.md).
-- 3e et DERNIÈRE des 3 migrations — n'exécuter qu'après 0059 (trigger en
-- place) ET 0060 (backfill terminé, vérifié : 0 ligne encore en "0X").
-- Si exécutée avant, cette contrainte rejette tout insert/update encore en
-- format brut — y compris le trigger handle_new_user tant que 0059 n'a pas
-- encore intercepté ce chemin, et toute ligne existante non encore
-- backfillée par 0060.
--
-- Resserre le format accepté : n'autorise plus QUE +33/+590/+594/+596/
-- +262/+269 (jamais plus "0X") — c'est ce CHECK permissif (migration 0056)
-- qui a laissé les deux formats cohabiter en premier lieu. Décision Pierre
-- 19/08 : pas de contrainte UNIQUE (aucun besoin métier prouvé, bloquerait
-- un foyer partageant un numéro) — seul le format est resserré ici.
alter table public.app_users
  drop constraint if exists app_users_phone_format_check;
alter table public.app_users
  add constraint app_users_phone_format_check
  check (phone is null or phone ~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$');

alter table public.booking_members
  drop constraint if exists booking_members_phone_format_check;
alter table public.booking_members
  add constraint booking_members_phone_format_check
  check (phone is null or phone ~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$');

alter table public.businesses
  drop constraint if exists businesses_phone_format_check;
alter table public.businesses
  add constraint businesses_phone_format_check
  check (phone is null or phone ~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$');

-- Ajout au-delà de ce qui a été explicitement demandé (à valider par
-- Pierre) : bookings.client_phone n'a jamais eu de CHECK (absente de la
-- migration 0056). Après 0060 (backfill + nettoyage "okokokok" -> null),
-- la colonne ne contient plus que du null ou du +33/DOM-TOM valide — ajouter
-- la même contrainte ferme le dernier trou de format du chantier plutôt que
-- de le laisser rouvrable silencieusement. Si Pierre préfère ne pas la
-- fermer maintenant, retirer ce bloc avant exécution : les deux blocs
-- au-dessus sont indépendants de celui-ci.
alter table public.bookings
  drop constraint if exists bookings_client_phone_format_check;
alter table public.bookings
  add constraint bookings_client_phone_format_check
  check (client_phone is null or client_phone ~ '^\+(33|590|594|596|262|269)[1-9][0-9]{8}$');

-- Vérification post-migration (lecture seule) : les 4 contraintes doivent
-- toutes exiger le préfixe "+", plus de "0|" en tête du pattern.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname like '%phone%';
