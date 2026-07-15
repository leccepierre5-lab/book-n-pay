-- Suppression de la table profiles : reliquat legacy remplacé par app_users.
-- Audit d'usage (2026-07-15) : 0 ligne, 0 référence code, 0 FK entrante,
-- 0 fonction dépendante. Une policy en récursion infinie
-- (profiles_select_own_or_admin) rendait la table inutilisable.
-- Detail : docs/memory/security-audit-2026-07.md

DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP TABLE IF EXISTS public.profiles;
