-- 0017_post_visit_popup.sql
-- Flag pour n'afficher le popup post-RDV (parrainage + avis Google) qu'une
-- seule fois par membre, une fois sa prestation clôturée par le pro.
ALTER TABLE booking_members
  ADD COLUMN IF NOT EXISTS post_visit_popup_shown BOOLEAN NOT NULL DEFAULT FALSE;
