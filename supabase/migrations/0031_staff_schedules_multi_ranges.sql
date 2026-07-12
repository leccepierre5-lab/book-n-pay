-- 0031_staff_schedules_multi_ranges.sql
-- Planning par praticien — horaires coupés (ex. 9h-12h / 14h-18h).
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- staff_schedules (0014_onboarding_pro.sql) porte aujourd'hui
-- UNIQUE (staff_id, day_of_week) : une seule plage horaire par praticien et
-- par jour, impossible d'insérer une pause déjeuner comme deux lignes
-- distinctes (INSERT #2 rejeté en conflit). Cette migration lève cette
-- contrainte et la remplace par UNIQUE (staff_id, day_of_week, open_time),
-- qui autorise plusieurs plages le même jour tout en empêchant un doublon
-- littéral (même praticien, même jour, même heure de début).
--
-- Aucune donnée à migrer : staff_schedules a 0 ligne en prod à ce jour
-- (vérifié le 12/07/2026 — 23 praticiens actifs, tous encore en fallback
-- horaires business, aucun n'a encore utilisé le panneau horaires de
-- /pro/equipe). Aucun risque de perte/incohérence sur ce point.
--
-- Le nom de contrainte ci-dessous (staff_schedules_staff_id_day_of_week_key)
-- est le nom que Postgres génère automatiquement pour un UNIQUE(...) déclaré
-- inline dans un CREATE TABLE, sans nom explicite (c'est le cas dans 0014).
-- La requête de vérification en bas de fichier confirme le nom réel après
-- coup, au cas où — voir le pitfall sur les migrations qui divergent
-- silencieusement de ce qu'on attend (fichier local vs état réel en base).

ALTER TABLE staff_schedules
  DROP CONSTRAINT IF EXISTS staff_schedules_staff_id_day_of_week_key;

ALTER TABLE staff_schedules
  ADD CONSTRAINT staff_schedules_staff_id_day_of_week_open_time_key
  UNIQUE (staff_id, day_of_week, open_time);

-- ⚠️ VÉRIFICATION OBLIGATOIRE APRÈS EXÉCUTION — colle le résultat ici avant
-- de considérer la migration terminée :
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'staff_schedules'::regclass AND contype = 'u';
-- Doit renvoyer UNE seule ligne UNIQUE, sur (staff_id, day_of_week, open_time)
-- — pas de ligne résiduelle sur l'ancienne définition (staff_id, day_of_week)
-- seule, et pas de doublon de contrainte.
