-- supabase/migrations/0040_demo_group_writes.sql
-- Autorise le mode B (invitation par lien) en démo pour les testeurs
-- whitelistés (DEMO_TESTER_EMAILS) : écriture réelle marquée is_demo=true,
-- purgée par le cron api/cron/purge-demo après 7 jours. Colonne posée sur
-- booking_members en plus de bookings pour que le cron puisse nettoyer les
-- deux tables sans dépendre d'un JOIN vers une ligne bookings potentiellement
-- déjà supprimée (ordre de suppression, voir purge-demo/route.ts).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE booking_members ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
