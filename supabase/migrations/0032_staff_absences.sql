-- 0032_staff_absences.sql
-- Planning par praticien — morceau 2/3 : congés et absences ponctuelles.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Modèle unique start_at/end_at (TIMESTAMPTZ), décision actée : une absence
-- "journée entière" et une absence "plage horaire précise" (ex. après-midi)
-- utilisent la même paire de colonnes — la distinction est un détail de
-- saisie/affichage côté UI (morceau 4 de ce fichier), pas un branchement de
-- schéma. Pas de biz_id redondant nécessaire pour la logique (staff_id suffit
-- à retrouver le business via staff.biz_id), mais demandé explicitement pour
-- rester cohérent avec staff_schedules (filtrage direct par biz_id sans
-- jointure sur staff dans les policies/requêtes).

CREATE TABLE IF NOT EXISTS staff_absences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  biz_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  start_at   TIMESTAMPTZ NOT NULL,
  end_at     TIMESTAMPTZ NOT NULL,
  reason     TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

-- Perf : requête de disponibilité filtrée par praticien puis période
-- (start_at/end_at pour le chevauchement avec le créneau demandé).
CREATE INDEX IF NOT EXISTS idx_staff_absences_staff_period
  ON staff_absences(staff_id, start_at, end_at);

-- RLS — même pattern que staff_schedules (0014) : lecture publique, écriture
-- réservée au pro propriétaire via service_role (route API dédiée), aucune
-- policy INSERT/UPDATE/DELETE pour anon/authenticated.
ALTER TABLE staff_absences ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY IF NOT EXISTS n'existe pas en PostgreSQL, d'où le bloc DO.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'staff_absences' AND policyname = 'staff_absences_select_all'
  ) THEN
    CREATE POLICY staff_absences_select_all ON staff_absences FOR SELECT USING (true);
  END IF;
END $$;

-- ⚠️ VÉRIFICATION APRÈS EXÉCUTION :
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'staff_absences'::regclass;
--   SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'staff_absences';
-- Doit montrer : 2 FK (staff_id, biz_id) + 1 CHECK (end_at > start_at),
-- et une seule policy SELECT (staff_absences_select_all, USING true).
