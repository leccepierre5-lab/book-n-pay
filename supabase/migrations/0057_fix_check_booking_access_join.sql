-- supabase/migrations/0057_fix_check_booking_access_join.sql
-- Faille d'autorisation trouvée le 18/08/2026 en creusant le chantier de
-- normalisation téléphone (voir docs/plan-normalisation-telephone.md).
-- check_booking_access(p_booking_id, p_phone) est la fonction utilisée par
-- la policy RLS booking_members_select (migration 0022) : USING
-- (check_booking_access(booking_id, phone)).
--
-- Sa 4e branche (dernière ligne du OR) ne vérifiait que "l'appelant connecté
-- possède ce numéro" — sans jamais vérifier que ce numéro appartient
-- réellement à un booking_member DU booking ciblé (p_booking_id). Prouvé
-- par appel réel (pas juste lu dans le code) : un utilisateur authentifié
-- appelant check_booking_access(<booking d'un autre client>, <son propre
-- téléphone>) obtenait `true`.
--
-- Inerte en prod aujourd'hui : le seul appelant existant (la policy RLS
-- ci-dessus) passe toujours le téléphone DE LA LIGNE évaluée, jamais un
-- téléphone choisi par le client — donc le trou n'était pas atteignable
-- par ce chemin. Mais la fonction est aussi exposée en RPC publique
-- (`/rest/v1/rpc/check_booking_access`, testé : répond même en anonyme) et
-- rien dans la fonction elle-même n'empêchait un futur appelant (nouvelle
-- policy, nouvelle route, modification RLS faite depuis le Dashboard sans
-- passer par une migration versionnée) de l'exploiter. Le garde-fou tenait
-- par accident (comment Postgres invoque la fonction depuis CETTE policy
-- précise), pas par construction de la fonction — corrigé pour que ce soit
-- structurel.
--
-- ⚠️ Angle mort VOLONTAIREMENT laissé pour un autre chantier : la nouvelle
-- jointure ci-dessous (bm.phone = p_phone) souffre du même problème de
-- normalisation que tout le reste (numéros stockés tantôt "0X" tantôt
-- "+33X", voir docs/plan-normalisation-telephone.md) — un membre légitime
-- dont le format ne matche pas pourrait se voir refuser l'accès. C'est un
-- problème de DONNÉES, pas de cette fonction, et la migration de
-- normalisation (à venir, décision Pierre en attente) devra repasser sur
-- cette fonction pour le vérifier une fois les données alignées. Ne pas
-- mélanger les deux chantiers dans le même correctif.
CREATE OR REPLACE FUNCTION public.check_booking_access(p_booking_id uuid, p_phone text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = p_booking_id
    AND (
      is_admin()
      OR b.client_id = auth.uid()
      OR owns_biz(b.biz_id)
      OR (
        -- Les deux conditions, pas l'une ou l'autre : p_phone doit être à
        -- la fois celui de l'appelant connecté ET celui d'un booking_member
        -- réel DE CE booking (b.id = p_booking_id, déjà filtré ci-dessus).
        EXISTS (
          SELECT 1 FROM app_users u
          WHERE u.id = auth.uid() AND u.phone = p_phone
        )
        AND EXISTS (
          SELECT 1 FROM booking_members bm
          WHERE bm.booking_id = b.id AND bm.phone = p_phone
        )
      )
    )
  );
$function$;

-- Vérification post-migration (lecture seule) : la définition doit
-- maintenant contenir la jointure booking_members ci-dessus.
select pg_get_functiondef('public.check_booking_access(uuid, text)'::regprocedure);
