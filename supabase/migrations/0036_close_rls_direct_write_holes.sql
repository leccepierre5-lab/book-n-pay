-- 0036_close_rls_direct_write_holes.sql
-- Audit sécurité du 20/07/2026 : 3 findings 🔴 critiques sur
-- bookings_insert / bookings_update / booking_members_insert /
-- booking_members_update (policies héritées du snapshot 0022, jamais
-- corrigées depuis). Toutes acceptaient un appel REST direct (clé anon
-- publique ou session client) contournant intégralement les fonctions
-- SECURITY DEFINER anti-double-booking et les contrôles de rôle
-- applicatifs (pro vs client).
--
-- Recon lecture seule effectuée AVANT cette migration (grep exhaustif de
-- tous les .insert()/.update() sur ces 2 tables dans src/) :
--   - bookings   : AUCUNE route n'insère/ne met à jour cette table
--                  autrement que via service_role (RPC SECURITY DEFINER
--                  pour l'insert : assign_staff_and_create_booking,
--                  create_booking_with_capacity_check,
--                  create_solo_booking_with_overlap_check — écriture
--                  directe service_role pour l'update : webhook,
--                  admin/freeze-business, cron expire-groups/
--                  cleanup-expired-invites, auth/delete-account,
--                  lib/booking-lifecycle.ts, lib/group/expireGroup.ts).
--                  La branche `client_id = auth.uid()` des policies
--                  n'est utilisée par aucune route réelle.
--   - booking_members : insert idem, toujours service_role (create,
--                  create-group, group/route.ts). update très
--                  majoritairement service_role, SAUF 2 routes qui
--                  utilisent le client authentifié : checkin-by-qr et
--                  update-member — toutes deux gated côté applicatif sur
--                  le rôle pro/admin (owns_biz), et ne touchent jamais
--                  que la colonne `status`. La branche
--                  `client_id = auth.uid()` n'y est pas utilisée non
--                  plus (les annulations/remboursements client passent
--                  systématiquement par service_role, y compris
--                  bookings/cancel).
--
-- Conséquence : fermeture totale des 2 INSERT et de bookings_update
-- (aucune régression possible, zéro route ne les utilise) ; sur
-- booking_members_update, retrait de la seule branche non utilisée
-- (client_id) en gardant is_admin()/owns_biz() intacte pour ne pas
-- casser checkin-by-qr/update-member.

-- ── bookings ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bookings_insert ON bookings;
CREATE POLICY bookings_insert ON bookings FOR INSERT TO public WITH CHECK (false);

DROP POLICY IF EXISTS bookings_update ON bookings;
CREATE POLICY bookings_update ON bookings FOR UPDATE TO public
  USING (false)
  WITH CHECK (false);

-- ── booking_members ───────────────────────────────────────────────────
DROP POLICY IF EXISTS booking_members_insert ON booking_members;
CREATE POLICY booking_members_insert ON booking_members FOR INSERT TO public WITH CHECK (false);

DROP POLICY IF EXISTS booking_members_update ON booking_members;
CREATE POLICY booking_members_update ON booking_members FOR UPDATE TO public
  USING (
    EXISTS ( SELECT 1
       FROM bookings b
      WHERE ((b.id = booking_members.booking_id) AND (is_admin() OR owns_biz(b.biz_id))))
  )
  WITH CHECK (
    EXISTS ( SELECT 1
       FROM bookings b
      WHERE ((b.id = booking_members.booking_id) AND (is_admin() OR owns_biz(b.biz_id))))
  );
