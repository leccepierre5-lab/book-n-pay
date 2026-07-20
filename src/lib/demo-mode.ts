// src/lib/demo-mode.ts
// Whitelist des testeurs autorisés à réserver+payer (carte Stripe test) sur
// les fiches non réelles (isNonRealBusiness) — CCI Bayonne bloque encore le
// lancement réel, ce mécanisme sert uniquement à faire vivre le parcours
// complet à des testeurs identifiés, sans rouvrir la faille fermée par
// d39f340 (paiement sur une fiche sans compte Connect à un vrai client).
// Server-only : ne jamais importer ce fichier depuis un composant client,
// la liste ne doit jamais être visible côté navigateur.
function getTesterEmails(): Set<string> {
  return new Set(
    (process.env.DEMO_TESTER_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// L'email vient toujours de la session Supabase serveur (authData.user.email),
// jamais d'un champ envoyé par le client — sinon n'importe qui contournerait
// le gate en se déclarant testeur dans le corps de la requête.
export function isDemoTesterEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getTesterEmails().has(email.trim().toLowerCase());
}

// Séparation stricte rôles pro/client (décidée par Pierre, 20/07) : un
// compte pro gère uniquement son établissement, il ne réserve jamais de
// prestation avec ce compte — ni chez lui, ni chez un confrère. "S'il veut
// réserver quelque part, c'est avec son compte particulier."
//
// Portée volontairement limitée aux réservations RÉELLES : dans
// bookings/create et bookings/create-group, le chemin démo
// (isNonRealBusiness + isDemoTesterEmail) retourne toujours AVANT
// d'atteindre cette vérification et n'écrit jamais rien en base — cette
// règle ne peut donc jamais bloquer la démonstration du produit (vitrine
// demo-book-n-pay), seulement une vraie réservation chez un vrai
// confrère avec un compte pro. Élargir ce check au chemin démo casserait
// la capacité de Pierre à démontrer le parcours client en direct : son
// compte de test (lecce.pierre5@gmail.com) est à la fois propriétaire de
// la vitrine démo ET whitelisté DEMO_TESTER_EMAILS.
// Message partagé front (masquage bouton) + back (rejet API) — un seul
// endroit à mettre à jour si le wording ou le lien changent.
export const PRO_CANNOT_BOOK_MESSAGE =
  "Ton compte professionnel gère uniquement ton établissement sur Book'nPay. Pour réserver une prestation, crée un compte client avec une autre adresse email.";

export async function isProAccount(
  supabase: { from: (table: string) => any },
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return data?.role === 'pro';
}
