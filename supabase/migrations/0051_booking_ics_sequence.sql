-- supabase/migrations/0051_booking_ics_sequence.sql
-- Compteur RFC 5545 SEQUENCE pour le fichier .ics joint aux emails de RDV
-- (confirmation, annulation — voir src/lib/ics.ts). Incrémenté à chaque
-- modification envoyée au client (annulation aujourd'hui, report demain si
-- la fonctionnalité existe) pour que son agenda mette à jour l'événement au
-- lieu d'en créer un doublon.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ics_sequence INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN bookings.ics_sequence IS
  'RFC 5545 SEQUENCE du dernier .ics envoyé au client — +1 à chaque nouvel envoi (annulation, report) sur le même UID.';
