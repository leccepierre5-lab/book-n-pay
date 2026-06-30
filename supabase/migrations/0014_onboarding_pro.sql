-- 0014_onboarding_pro.sql
-- Onboarding pro guidé :
--   1. Gate de publication : is_published sur businesses
--   2. Staff soft-deactivation (démission sans perdre l'historique)
--   3. Horaires individuels par praticien

-- 1. Gate publication
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;

-- Les établissements existants déjà actifs passent à true
-- (à ajuster manuellement selon ton contexte si certains ne sont pas prêts)
UPDATE businesses SET is_published = true WHERE frozen = false;

-- 2. Staff : soft-deactivation
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- 3. Horaires individuels par praticien
CREATE TABLE IF NOT EXISTS staff_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  biz_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Dim, 6=Sam
  open_time      TIME NOT NULL,
  close_time     TIME NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day_of_week)
);

-- Index pour les lookups par praticien
CREATE INDEX IF NOT EXISTS idx_staff_schedules_staff_id ON staff_schedules(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_biz_id  ON staff_schedules(biz_id);

-- RLS staff_schedules : lecture publique, écriture réservée au pro propriétaire via service role
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'staff_schedules' AND policyname = 'staff_schedules_select_all'
  ) THEN
    CREATE POLICY staff_schedules_select_all ON staff_schedules FOR SELECT USING (true);
  END IF;
END $$;
