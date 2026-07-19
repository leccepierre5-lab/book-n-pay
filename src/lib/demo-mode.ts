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
