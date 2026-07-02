-- 0022_rls_snapshot.sql
-- SECURITY_TODO.md #1 — snapshot des policies RLS existantes (créées
-- manuellement via le Dashboard Supabase avant ce commit, jamais versionnées).
-- Permet de reproduire l'état actuel du schéma de sécurité depuis git.
-- Généré le 02/07/2026 depuis un dump complet de pg_policies (SQL Editor).
--
-- ⚠️ CREATE POLICY IF NOT EXISTS n'existe pas en PostgreSQL (contrairement à
-- CREATE TABLE/INDEX) — chaque policy est donc créée via un bloc DO/IF qui
-- vérifie pg_policies avant de la créer, pour rester idempotent si cette
-- migration est rejouée sur un environnement déjà configuré (piège déjà
-- documenté dans ce projet, voir migration 0014 pour le même pattern).
--
-- ⚠️ Cette migration référence des fonctions (is_admin(), owns_biz(),
-- check_booking_access()) créées manuellement elles aussi et non versionnées
-- à ce jour — sur un environnement réellement vierge, il faudra d'abord les
-- recréer avant de rejouer ce fichier. Hors périmètre de ce snapshot
-- (documente les policies telles quelles, pas les fonctions qu'elles appellent).
--
-- Tables avec RLS activée sans policy (accès service role uniquement) :
--   overage_charges : intentionnel (appelée uniquement depuis webhook/cron via service role)
--   rate_limits     : intentionnel (appelée uniquement depuis les routes API via service role)
-- Ces deux tables n'ont pas besoin de policy supplémentaire.

-- ── app_config ────────────────────────────────────────────────────────────────
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'app_config_select_public') THEN
    CREATE POLICY app_config_select_public ON app_config FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'app_config_write_admin') THEN
    CREATE POLICY app_config_write_admin ON app_config FOR ALL TO public USING (is_admin());
  END IF;
END $$;

-- ── app_users ─────────────────────────────────────────────────────────────────
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'app_users_delete') THEN
    CREATE POLICY app_users_delete ON app_users FOR DELETE TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'app_users_insert') THEN
    CREATE POLICY app_users_insert ON app_users FOR INSERT TO public WITH CHECK ((id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'app_users_select') THEN
    CREATE POLICY app_users_select ON app_users FOR SELECT TO public USING (((id = auth.uid()) OR is_admin()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'app_users_update') THEN
    CREATE POLICY app_users_update ON app_users FOR UPDATE TO public USING (((id = auth.uid()) OR is_admin()));
  END IF;
END $$;

-- ── booking_logs ──────────────────────────────────────────────────────────────
ALTER TABLE booking_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_logs' AND policyname = 'booking_logs_insert') THEN
    CREATE POLICY booking_logs_insert ON booking_logs FOR INSERT TO public WITH CHECK (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = booking_logs.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id)))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_logs' AND policyname = 'booking_logs_select') THEN
    CREATE POLICY booking_logs_select ON booking_logs FOR SELECT TO public USING (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = booking_logs.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id)))))
    );
  END IF;
END $$;

-- ── booking_members ───────────────────────────────────────────────────────────
ALTER TABLE booking_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_members' AND policyname = 'booking_members_delete') THEN
    CREATE POLICY booking_members_delete ON booking_members FOR DELETE TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_members' AND policyname = 'booking_members_insert') THEN
    CREATE POLICY booking_members_insert ON booking_members FOR INSERT TO public WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_members' AND policyname = 'booking_members_select') THEN
    CREATE POLICY booking_members_select ON booking_members FOR SELECT TO public USING (check_booking_access(booking_id, phone));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'booking_members' AND policyname = 'booking_members_update') THEN
    CREATE POLICY booking_members_update ON booking_members FOR UPDATE TO public USING (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = booking_members.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id)))))
    );
  END IF;
END $$;

-- ── bookings ──────────────────────────────────────────────────────────────────
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_delete') THEN
    CREATE POLICY bookings_delete ON bookings FOR DELETE TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_insert') THEN
    CREATE POLICY bookings_insert ON bookings FOR INSERT TO public WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_select') THEN
    CREATE POLICY bookings_select ON bookings FOR SELECT TO public USING (
      (is_admin() OR (client_id = auth.uid()) OR owns_biz(biz_id) OR (EXISTS ( SELECT 1
         FROM (booking_members bm
           JOIN app_users u ON ((u.id = auth.uid())))
        WHERE ((bm.booking_id = bookings.id) AND (bm.phone = u.phone)))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_update') THEN
    CREATE POLICY bookings_update ON bookings FOR UPDATE TO public USING ((is_admin() OR (client_id = auth.uid()) OR owns_biz(biz_id)));
  END IF;
END $$;

-- ── business_photos ───────────────────────────────────────────────────────────
ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_photos' AND policyname = 'business_photos_pro_delete') THEN
    CREATE POLICY business_photos_pro_delete ON business_photos FOR DELETE TO public USING (
      (biz_id IN ( SELECT app_users.biz_id
         FROM app_users
        WHERE ((app_users.id = auth.uid()) AND (app_users.role = ANY (ARRAY['pro'::user_role, 'admin'::user_role])))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_photos' AND policyname = 'business_photos_pro_insert') THEN
    CREATE POLICY business_photos_pro_insert ON business_photos FOR INSERT TO public WITH CHECK (
      (biz_id IN ( SELECT app_users.biz_id
         FROM app_users
        WHERE ((app_users.id = auth.uid()) AND (app_users.role = ANY (ARRAY['pro'::user_role, 'admin'::user_role])))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_photos' AND policyname = 'business_photos_public_read') THEN
    CREATE POLICY business_photos_public_read ON business_photos FOR SELECT TO public USING (true);
  END IF;
END $$;

-- ── business_review_items ─────────────────────────────────────────────────────
ALTER TABLE business_review_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_review_items' AND policyname = 'review_items_select_public') THEN
    CREATE POLICY review_items_select_public ON business_review_items FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_review_items' AND policyname = 'review_items_write') THEN
    CREATE POLICY review_items_write ON business_review_items FOR ALL TO public USING (owns_biz(biz_id));
  END IF;
END $$;

-- ── business_reviews ──────────────────────────────────────────────────────────
ALTER TABLE business_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_reviews' AND policyname = 'business_reviews_select_public') THEN
    CREATE POLICY business_reviews_select_public ON business_reviews FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_reviews' AND policyname = 'business_reviews_write') THEN
    CREATE POLICY business_reviews_write ON business_reviews FOR ALL TO public USING (owns_biz(biz_id));
  END IF;
END $$;

-- ── business_settings ─────────────────────────────────────────────────────────
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_settings' AND policyname = 'business_settings_delete') THEN
    CREATE POLICY business_settings_delete ON business_settings FOR DELETE TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_settings' AND policyname = 'business_settings_insert') THEN
    CREATE POLICY business_settings_insert ON business_settings FOR INSERT TO public WITH CHECK (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_settings' AND policyname = 'business_settings_select') THEN
    CREATE POLICY business_settings_select ON business_settings FOR SELECT TO public USING (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_settings' AND policyname = 'business_settings_update') THEN
    CREATE POLICY business_settings_update ON business_settings FOR UPDATE TO public USING (owns_biz(biz_id));
  END IF;
END $$;

-- ── businesses ────────────────────────────────────────────────────────────────
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'businesses' AND policyname = 'businesses_delete') THEN
    CREATE POLICY businesses_delete ON businesses FOR DELETE TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'businesses' AND policyname = 'businesses_insert') THEN
    CREATE POLICY businesses_insert ON businesses FOR INSERT TO public WITH CHECK (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'businesses' AND policyname = 'businesses_select_public') THEN
    CREATE POLICY businesses_select_public ON businesses FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'businesses' AND policyname = 'businesses_update') THEN
    CREATE POLICY businesses_update ON businesses FOR UPDATE TO public USING (owns_biz(id));
  END IF;
END $$;

-- ── chat_messages ─────────────────────────────────────────────────────────────
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_insert') THEN
    CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT TO public WITH CHECK (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = chat_messages.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id) OR (EXISTS ( SELECT 1
                 FROM (booking_members bm
                   JOIN app_users u ON ((u.id = auth.uid())))
                WHERE ((bm.booking_id = b.id) AND (bm.phone = u.phone))))))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_select') THEN
    CREATE POLICY chat_messages_select ON chat_messages FOR SELECT TO public USING (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = chat_messages.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id) OR (EXISTS ( SELECT 1
                 FROM (booking_members bm
                   JOIN app_users u ON ((u.id = auth.uid())))
                WHERE ((bm.booking_id = b.id) AND (bm.phone = u.phone))))))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_update') THEN
    CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE TO public USING (
      (EXISTS ( SELECT 1
         FROM bookings b
        WHERE ((b.id = chat_messages.booking_id) AND (is_admin() OR (b.client_id = auth.uid()) OR owns_biz(b.biz_id)))))
    );
  END IF;
END $$;

-- ── favorites ─────────────────────────────────────────────────────────────────
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'favorites' AND policyname = 'favorites_all') THEN
    CREATE POLICY favorites_all ON favorites FOR ALL TO public
      USING (((user_id = auth.uid()) OR is_admin()))
      WITH CHECK ((user_id = auth.uid()));
  END IF;
END $$;

-- ── flash_slots ───────────────────────────────────────────────────────────────
ALTER TABLE flash_slots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flash_slots' AND policyname = 'flash_slots_delete') THEN
    CREATE POLICY flash_slots_delete ON flash_slots FOR DELETE TO public USING (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flash_slots' AND policyname = 'flash_slots_insert') THEN
    CREATE POLICY flash_slots_insert ON flash_slots FOR INSERT TO public WITH CHECK (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flash_slots' AND policyname = 'flash_slots_select_public') THEN
    CREATE POLICY flash_slots_select_public ON flash_slots FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flash_slots' AND policyname = 'flash_slots_update') THEN
    CREATE POLICY flash_slots_update ON flash_slots FOR UPDATE TO public USING (owns_biz(biz_id));
  END IF;
END $$;

-- ── overage_charges ───────────────────────────────────────────────────────────
-- RLS activée, pas de policy : accès service role uniquement (webhook + cron).
-- Le pro consulte son statut via /api/pro/overage-status (service role) —
-- vérifié dans le code, aucune policy SELECT manquante pour lui.
ALTER TABLE overage_charges ENABLE ROW LEVEL SECURITY;

-- ── partner_applications ──────────────────────────────────────────────────────
ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_applications' AND policyname = 'partner_applications_insert_public') THEN
    CREATE POLICY partner_applications_insert_public ON partner_applications FOR INSERT TO public WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_applications' AND policyname = 'partner_applications_select_admin') THEN
    CREATE POLICY partner_applications_select_admin ON partner_applications FOR SELECT TO public USING (is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_applications' AND policyname = 'partner_applications_update_admin') THEN
    CREATE POLICY partner_applications_update_admin ON partner_applications FOR UPDATE TO public USING (is_admin());
  END IF;
END $$;

-- ── profiles ──────────────────────────────────────────────────────────────────
-- Table absente de src/lib/database.types.ts — probable reliquat d'une
-- itération antérieure à app_users. Documentée telle quelle (snapshot, pas
-- un nettoyage) ; à vérifier si encore utilisée avant suppression éventuelle.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_select_own_or_admin') THEN
    CREATE POLICY profiles_select_own_or_admin ON profiles FOR SELECT TO public USING (
      ((auth.uid() = id) OR (EXISTS ( SELECT 1
         FROM profiles p
        WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO public USING ((auth.uid() = id));
  END IF;
END $$;

-- ── rate_limits ───────────────────────────────────────────────────────────────
-- RLS activée, pas de policy : accès service role uniquement (routes API).
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- ── referral_events ───────────────────────────────────────────────────────────
ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_events' AND policyname = 'referral_events_own_read') THEN
    CREATE POLICY referral_events_own_read ON referral_events FOR SELECT TO public
      USING (((referrer_id = auth.uid()) OR (referred_id = auth.uid())));
  END IF;
END $$;

-- ── services ──────────────────────────────────────────────────────────────────
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'services_delete') THEN
    CREATE POLICY services_delete ON services FOR DELETE TO public USING (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'services_insert') THEN
    CREATE POLICY services_insert ON services FOR INSERT TO public WITH CHECK (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'services_select_public') THEN
    CREATE POLICY services_select_public ON services FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'services' AND policyname = 'services_update') THEN
    CREATE POLICY services_update ON services FOR UPDATE TO public USING (owns_biz(biz_id));
  END IF;
END $$;

-- ── staff ─────────────────────────────────────────────────────────────────────
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'staff_delete') THEN
    CREATE POLICY staff_delete ON staff FOR DELETE TO public USING (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'staff_insert') THEN
    CREATE POLICY staff_insert ON staff FOR INSERT TO public WITH CHECK (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'staff_select_public') THEN
    CREATE POLICY staff_select_public ON staff FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'staff_update') THEN
    CREATE POLICY staff_update ON staff FOR UPDATE TO public USING (owns_biz(biz_id));
  END IF;
END $$;
