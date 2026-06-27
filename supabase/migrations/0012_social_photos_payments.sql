-- Migration 0012 : liens sociaux, photos, paiement croisé entre membres de groupe

-- 1. Facebook sur businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS facebook_url TEXT;

-- 2. Table photos établissement
CREATE TABLE IF NOT EXISTS business_photos (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id     UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url        TEXT        NOT NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_photos_biz_sort ON business_photos (biz_id, sort_order);

ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_photos_public_read"  ON business_photos FOR SELECT USING (true);
CREATE POLICY "business_photos_pro_insert"   ON business_photos FOR INSERT
  WITH CHECK (biz_id IN (
    SELECT biz_id FROM app_users WHERE id = auth.uid() AND role IN ('pro','admin')
  ));
CREATE POLICY "business_photos_pro_delete"   ON business_photos FOR DELETE
  USING (biz_id IN (
    SELECT biz_id FROM app_users WHERE id = auth.uid() AND role IN ('pro','admin')
  ));

-- 3. Traçabilité paiement croisé sur booking_members
ALTER TABLE booking_members
  ADD COLUMN IF NOT EXISTS paid_by_member_id UUID REFERENCES booking_members(id),
  ADD COLUMN IF NOT EXISTS paid_for_at       TIMESTAMPTZ;
