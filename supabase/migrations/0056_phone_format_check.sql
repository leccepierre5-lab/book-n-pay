-- supabase/migrations/0056_phone_format_check.sql
-- Bug trouvé le 15/08 : le champ téléphone du formulaire d'inscription
-- acceptait "okokokok" sans aucune validation de format. L'audit qui a
-- suivi a révélé que src/lib/booking-utils.ts::phonesMatch() (corrigé dans
-- le même chantier, voir commit associé) servait à de l'AUTORISATION
-- (bookings/cancel, post-visit-status/ack) — deux téléphones invalides
-- normalisaient tous les deux vers '' et matchaient entre eux. Le format
-- est désormais validé côté serveur (isValidPhoneFormat) sur chaque route
-- qui reçoit un `phone`. Cette migration ajoute la même contrainte en base,
-- filet de sécurité pour tout chemin d'écriture qui l'oublierait à l'avenir
-- (ex. un script, une migration manuelle) — jamais une réponse au client,
-- juste une garantie que la table elle-même ne peut pas dériver.
--
-- Reconnaissance avant migration (script jetable, lecture seule) : 1 valeur
-- invalide sur 7 dans app_users.phone, 1 sur 17 dans booking_members.phone,
-- 0 sur 2 dans businesses.phone — les deux seules invalides sont le compte
-- de test créé en direct pour démontrer le bug, pas de la dette historique.
update public.app_users
  set phone = null
  where phone is not null
    and phone !~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$';

update public.booking_members
  set phone = null
  where phone is not null
    and phone !~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$';

update public.businesses
  set phone = null
  where phone is not null
    and phone !~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$';

-- Format FR + DOM-TOM : 0 ou +33 pour la métropole, +590/+594/+596/+262/+269
-- pour Guadeloupe/Saint-Martin/Saint-Barthélemy, Guyane, Martinique, Réunion
-- et Mayotte — 9 chiffres significatifs, premier non nul. Doit rester
-- synchro avec isValidPhoneFormat() (src/lib/booking-utils.ts) : la colonne
-- ne contient QUE des valeurs déjà normalisées (jamais d'espaces/points/
-- tirets), contrairement au format toléré en saisie côté formulaire.
alter table public.app_users
  add constraint app_users_phone_format_check
  check (phone is null or phone ~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$');

alter table public.booking_members
  add constraint booking_members_phone_format_check
  check (phone is null or phone ~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$');

alter table public.businesses
  add constraint businesses_phone_format_check
  check (phone is null or phone ~ '^(0|\+(33|590|594|596|262|269))[1-9][0-9]{8}$');

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname like '%phone%';
