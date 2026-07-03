-- 0023_staff_planning.sql
-- Planning par praticien — étape 1/4 (contrainte anti-conflit uniquement).
-- Prépare le terrain pour l'assignation automatique de staff_id à la réservation
-- (voir parties 2-4 du plan : disponibilité par praticien, assignation au
-- checkout, UI client — pas encore implémentées à ce stade).
--
-- ⚠️ Comme les migrations précédentes (0011, 0014...), à exécuter manuellement
-- dans le Supabase SQL Editor.
--
-- ⚠️ bookings.date / bookings.time : la table est créée par 0001_schema.sql,
-- absent de ce dépôt (voir commentaire en tête de src/lib/database.types.ts).
-- Ce fichier suppose des colonnes natives DATE / TIME (convention confirmée par
-- flash_slots.date / flash_slots.time dans 0008_flash_slots_favorites.sql, qui
-- suit le même modèle que bookings). Si l'exécution échoue avec une erreur de
-- type sur `time`, c'est que cette hypothèse est fausse — à corriger avant de
-- rejouer.
--
-- ⚠️ Portée volontairement limitée : cet index ne bloque que les collisions à
-- l'heure exacte (staff_id + date + time identiques). Il ne détecte PAS un
-- chevauchement de durée (ex. praticien pris de 10:00 à 11:00 sur un service
-- 60 min, re-réservé à 10:30) — bookings n'a pas de end_time et le calcul de
-- durée dépend de services.duration_minutes, résolu en application (partie 2 :
-- src/lib/staff-availability.ts, pas encore écrit). Cet index reste un
-- garde-fou utile contre la race condition sur le cas simple, pas une
-- garantie complète à lui seul.

-- Empêche d'assigner deux fois le même praticien au même créneau exact.
-- Filtré sur staff_id IS NOT NULL (les réservations "pas de préférence" non
-- encore assignées, ou les services collectifs sans staff dédié, ne sont pas
-- concernés) et status != 'cancelled' (une réservation annulée libère le
-- praticien, ne doit pas bloquer une nouvelle prise sur ce créneau).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_staff_slot_unique
  ON bookings (staff_id, date, time)
  WHERE staff_id IS NOT NULL AND status != 'cancelled';

-- Perf : lookups d'occupation par praticien (calcul de disponibilité partie 2,
-- et re-vérification à l'insertion partie 3) — filtrées par staff_id + date
-- avant de charger les réservations du jour pour vérifier les chevauchements.
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date
  ON bookings (staff_id, date)
  WHERE staff_id IS NOT NULL;

-- staff_schedules (créée en 0014_onboarding_pro.sql) : schéma déjà suffisant
-- pour ce chantier, aucune colonne à ajouter.
--   staff_id, biz_id, day_of_week (0=Dim..6=Sam), open_time, close_time
--   UNIQUE (staff_id, day_of_week)
-- Limite connue et acceptée pour cette V1 (pas demandée, donc hors scope) :
-- pas de gestion des absences ponctuelles (congé, maladie) — seulement un
-- planning hebdomadaire récurrent. Un praticien sans aucune ligne ici retombe
-- sur les horaires du business (décision actée, voir partie 2 — le fallback
-- lui-même est un comportement applicatif, rien à modifier ici côté schéma).
