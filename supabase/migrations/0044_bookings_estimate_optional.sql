-- 0044_bookings_estimate_optional.sql
--
-- monthly_bookings_estimate devient facultatif à la candidature
-- (/devenir-partenaire) — le volume ne détermine plus rien pour le pro
-- depuis la refonte tarifaire (réservations illimitées sur tous les plans)
-- et depuis la migration 0042, c'est practitioners_count qui suggère le
-- plan. Le garder obligatoire ajoutait une friction sans contrepartie.
--
-- Décision explicite (12/08/2026) : NE PAS laisser le DEFAULT '0-80'
-- s'appliquer silencieusement à une non-réponse — l'admin doit pouvoir
-- distinguer "le pro a répondu 0-80" de "le pro n'a pas répondu". D'où le
-- retrait du DEFAULT en même temps que le NOT NULL, pas seulement l'un des
-- deux.
--
-- Le CHECK existant (chk_pa_bookings_estimate) autorise déjà NULL sans
-- modification : une contrainte CHECK sur une colonne NULL est neutre en
-- Postgres, seul NOT NULL bloquait le NULL.
--
-- Les candidatures déjà en base avec '0-80' ne sont PAS retouchées : rien ne
-- permet de distinguer a posteriori une vraie réponse "0-80" du DEFAULT
-- silencieux qui s'appliquait jusqu'ici — probablement indistinguable,
-- signalé ici plutôt que deviné.

ALTER TABLE partner_applications
  ALTER COLUMN monthly_bookings_estimate DROP NOT NULL,
  ALTER COLUMN monthly_bookings_estimate DROP DEFAULT;
