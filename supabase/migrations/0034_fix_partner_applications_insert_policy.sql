-- 0034_fix_partner_applications_insert_policy.sql
-- Corrige une divergence Dashboard/code découverte le 16/07/2026 (audit
-- fonctionnel) : la policy INSERT de partner_applications avait un
-- WITH CHECK vide en prod (probablement modifiée manuellement au Dashboard
-- à un moment non tracé), alors que 0022_rls_snapshot.sql déclare
-- WITH CHECK (true). Résultat en prod : tout insert anon rejeté (42501),
-- donc le formulaire public /devenir-partenaire cassé pour de vrais
-- prospects tant que ce fix n'est pas appliqué.
--
-- DROP + CREATE plutôt que ALTER POLICY : idempotent, fonctionne que la
-- policy existe déjà ou non (cohérent avec le reste des migrations de ce
-- repo, ex. 0018/0027).

DROP POLICY IF EXISTS "partner_applications_insert_public" ON "public"."partner_applications";

CREATE POLICY "partner_applications_insert_public"
ON "public"."partner_applications"
FOR INSERT
TO public
WITH CHECK (true);
