-- supabase/migrations/0048_business_deletion_log.sql
-- Trace de suppression de compte pro en libre-service (RGPD art. 17,
-- api/pro/delete-account/route.ts). En cas de contestation, il faut pouvoir
-- montrer que la demande venait bien du pro authentifié, pas d'un tiers.
--
-- requested_by est délibérément SANS contrainte de clé étrangère vers
-- app_users(id) : ce compte est justement supprimé par CASCADE
-- (app_users_id_fkey → auth.users, ON DELETE CASCADE, confirmé par requête
-- pg_constraint le 13/08/2026) dans le même flux qui écrit cette ligne. Une
-- FK ON DELETE SET NULL ici effacerait la seule preuve qu'on cherche à
-- garder — c'est un instantané délibérément découplé du graphe FK vivant,
-- pas un oubli.
--
-- biz_id référence businesses(id) sans ON DELETE : la ligne businesses
-- n'est jamais supprimée (anonymisée en place, cf. route), donc pas de
-- risque de cascade à gérer ici.
CREATE TABLE IF NOT EXISTS business_deletion_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id           UUID        NOT NULL REFERENCES businesses(id),
  biz_name         TEXT        NOT NULL,
  requested_by     UUID        NOT NULL,
  deleted_summary  JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS : même pattern que pro_charges/overage_charges — écriture réservée au
-- service role (route dédiée), lecture réservée à l'admin (audit/litige).
ALTER TABLE business_deletion_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_deletion_log' AND policyname = 'business_deletion_log_select_admin') THEN
    CREATE POLICY business_deletion_log_select_admin ON business_deletion_log FOR SELECT TO public USING (is_admin());
  END IF;
END $$;
