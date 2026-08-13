-- 0047_close_business_review_items_rls.sql
-- Remplace une première version de cette migration qui proposait un DROP
-- TABLE — refusé par Pierre (13/08) : un DROP est irréversible, la table ne
-- coûte rien à garder, et rien ne prouve qu'elle ne correspond pas à une
-- intention produit oubliée. Le vrai problème relevé par l'audit lecture
-- seule n'était pas l'existence de la table, mais sa policy SELECT ouverte
-- à `public` avec `USING (true)` (migration 0022) — n'importe qui pouvait
-- lire son contenu, alors qu'aucune route applicative n'y écrit ni n'y lit
-- aujourd'hui (grep exhaustif, seules références restantes : un commentaire
-- dans etablissement/[slug]/page.tsx et deux scripts d'audit lecture seule).
--
-- Cette migration ferme la lecture publique et aligne business_review_items
-- sur le même pattern que les autres tables scoping owner/admin du repo
-- (ex. bookings_select, booking_members_select — voir 0022_rls_snapshot.sql) :
-- lisible par le propriétaire du business concerné ou un admin, plus par
-- n'importe qui. La policy d'écriture existante (review_items_write, déjà
-- restreinte à owns_biz(biz_id)) n'est pas concernée par ce fichier.
--
-- booking_members.client_msg (colonne morte identifiée par le même audit)
-- N'EST PAS traitée ici — décision de Pierre : une colonne nullable jamais
-- lue/écrite ne présente aucun risque, à nettoyer un jour dans un lot de
-- ménage assumé, pas au milieu d'un chantier conformité.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor (pas de DATABASE_URL disponible dans cet environnement).
-- NE PAS exécuter avant relecture de Pierre.

DROP POLICY IF EXISTS review_items_select_public ON business_review_items;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_review_items' AND policyname = 'review_items_select_owner_admin') THEN
    CREATE POLICY review_items_select_owner_admin ON business_review_items FOR SELECT TO public
      USING (is_admin() OR owns_biz(biz_id));
  END IF;
END $$;
