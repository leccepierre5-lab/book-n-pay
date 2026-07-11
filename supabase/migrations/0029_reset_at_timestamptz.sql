-- 0029_reset_at_timestamptz.sql
-- Prerequis du plafond de depassement (voir OVERAGE_GRACE=0, plans-config.ts) :
-- le calcul du cumul mensuel doit filtrer overage_charges.created_at (TIMESTAMPTZ)
-- par rapport au debut du cycle courant. business_settings.bookings_count_reset_at
-- etait en DATE (precision jour), insuffisant pour bornancer un cycle avec la
-- meme precision que created_at. Passe en TIMESTAMPTZ.
--
-- Conversion explicite en UTC (independante du timezone de session au moment
-- du run de la migration) : bookings_count_reset_at::timestamp interprete la
-- date comme un timestamp naif a minuit, puis AT TIME ZONE 'UTC' l'ancre en
-- UTC plutot que de laisser Postgres utiliser le timezone de session courant
-- (comportement implicite d'un cast direct date->timestamptz, non deterministe
-- d'un environnement a l'autre). Aucune perte de donnees : chaque DATE existante
-- devient minuit UTC ce jour-la, une valeur strictement equivalente en information
-- (le jour est preserve), juste representee avec precision horaire desormais.
ALTER TABLE business_settings
  ALTER COLUMN bookings_count_reset_at TYPE TIMESTAMPTZ
  USING bookings_count_reset_at::timestamp AT TIME ZONE 'UTC';

-- NOT NULL est preserve automatiquement par ALTER COLUMN TYPE (contrainte
-- independante du type), pas besoin de la reposer. Le DEFAULT CURRENT_DATE
-- (typé DATE) ne s'applique plus au nouveau type — remplace par NOW() pour
-- les rares chemins d'ecriture qui ne renseignent pas ce champ explicitement
-- (ex. upserts partiels sur business_settings hors du flux d'inscription).
ALTER TABLE business_settings
  ALTER COLUMN bookings_count_reset_at SET DEFAULT NOW();
