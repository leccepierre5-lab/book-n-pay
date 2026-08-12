-- 0043_fix_partner_applications_insert_policy_again.sql
--
-- ENQUÊTE CLOSE (12/08/2026) — CE N'ÉTAIT PROBABLEMENT PAS UNE RÉGRESSION.
-- L'alerte initiale ("2e occurrence du bug 0034") venait d'un BIAIS DE TEST :
-- le script de diagnostic chaînait .select().single() après .insert(), ce
-- que le vrai code (PartnerApplicationForm.tsx) ne fait JAMAIS. Or .select()
-- déclenche Prefer: return=representation côté PostgREST, donc un
-- INSERT ... RETURNING — qui exige une policy SELECT pour le rôle exécutant.
-- Seule policy SELECT existante : partner_applications_select_admin
-- (qual=is_admin()), qu'un visiteur anonyme ne satisfait jamais. Un insert
-- SANS .select() (le vrai chemin de code) a été testé séparément et a
-- RÉUSSI, avant même que cette migration ne soit rejouée. Rien ne prouve que
-- la policy WITH CHECK(true) ait jamais réellement divergé cette fois-ci
-- (contrairement à 0034, où la divergence avait été confirmée à l'époque).
-- Leçon retenue : tout test de reproduction d'un bug doit utiliser
-- EXACTEMENT le même appel que le code réel, jamais une variante "plus
-- pratique" pour l'inspection.
--
-- Cette migration RESTE appliquée : DROP+CREATE d'une policy identique à
-- l'existante est un no-op sans risque, garde une trace versionnée de
-- l'intention (WITH CHECK(true)), et sert d'assurance si une vraie
-- divergence survient un jour. Rien à rejouer, rien à annuler.
--
-- DROP + CREATE (pas ALTER POLICY) : idempotent, rejouable sans risque que
-- la policy existe déjà ou non, quel que soit son état actuel en prod —
-- même convention que 0034/0018/0027. Un rejeu de cette migration ne casse
-- rien : il republie exactement la même policy.

DROP POLICY IF EXISTS "partner_applications_insert_public" ON "public"."partner_applications";

CREATE POLICY "partner_applications_insert_public"
ON "public"."partner_applications"
FOR INSERT
TO public
WITH CHECK (true);
