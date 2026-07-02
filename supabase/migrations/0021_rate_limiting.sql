-- 0021_rate_limiting.sql
-- SECURITY_TODO.md #3 : aucun rate limiting dans l'app (checkin-by-qr
-- brute-forçable — qr_code = 6 chiffres, register/forgot-password sujets à
-- abus/spam, checkout et bookings/group sensibles aux abus de création).
--
-- Table + fonction génériques, réutilisables par n'importe quel endpoint via
-- src/lib/rate-limit.ts. Accès service role uniquement (RLS activée, aucune
-- policy pour anon/authenticated) — jamais interrogée depuis le client.

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- Aucune policy : anon/authenticated n'ont jamais accès, seul service role
-- (qui bypass RLS) peut lire/écrire cette table.

-- Incrémente et vérifie le compteur en une seule transaction (verrou de ligne
-- via SELECT ... FOR UPDATE) pour éviter la race condition d'un
-- read-then-write classique sous requêtes concurrentes.
CREATE OR REPLACE FUNCTION check_rate_limit(p_key TEXT, p_limit INT, p_window_seconds INT)
RETURNS TABLE(allowed BOOLEAN, current_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
BEGIN
  SELECT count, window_start INTO v_count, v_window_start
  FROM rate_limits WHERE key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO rate_limits (key, count, window_start) VALUES (p_key, 1, now());
    RETURN QUERY SELECT true, 1;
    RETURN;
  END IF;

  IF now() - v_window_start > (p_window_seconds || ' seconds')::interval THEN
    UPDATE rate_limits SET count = 1, window_start = now() WHERE key = p_key;
    RETURN QUERY SELECT true, 1;
    RETURN;
  END IF;

  IF v_count >= p_limit THEN
    RETURN QUERY SELECT false, v_count;
    RETURN;
  END IF;

  UPDATE rate_limits SET count = count + 1 WHERE key = p_key;
  RETURN QUERY SELECT true, v_count + 1;
END;
$$;

-- Ménage : évite l'accumulation infinie de clés expirées (appelable par un
-- cron existant ou manuellement — pas de dépendance ajoutée ici).
CREATE OR REPLACE FUNCTION cleanup_rate_limits(p_older_than_seconds INT DEFAULT 86400)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limits WHERE window_start < now() - (p_older_than_seconds || ' seconds')::interval;
$$;
