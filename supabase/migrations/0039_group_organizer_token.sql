-- supabase/migrations/0039_group_organizer_token.sql
-- Token d'organisateur pour les réservations de groupe : permet à
-- removeInvite (src/app/api/bookings/group/route.ts) de vérifier que
-- l'appelant est bien l'organisateur, sans supposer qu'il est connecté
-- (l'organisateur peut être anonyme — voir audit sécurité 23/07, faille
-- sur removeInvite : n'importe quel détenteur du lien invité pouvait
-- retirer n'importe quel participant). Le lien invité partagé
-- (/rejoindre/[bookingId], ShareGroupLink.tsx) reste inchangé et ne
-- contient jamais ce token.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS organizer_token TEXT;

-- Backfill : les groupes déjà créés avant cette migration doivent recevoir
-- un token, sinon leurs organisateurs perdent tout accès à removeInvite.
UPDATE bookings SET organizer_token = gen_random_uuid()::text WHERE organizer_token IS NULL;

ALTER TABLE bookings ALTER COLUMN organizer_token SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN organizer_token SET DEFAULT gen_random_uuid()::text;
