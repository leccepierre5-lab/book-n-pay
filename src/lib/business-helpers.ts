// src/lib/business-helpers.ts
// Extrait de queries/catalog.ts — ce fichier n'importe rien de server-only
// (pas de @/lib/supabase/server), pour rester importable depuis un composant
// client ('use client'), contrairement à catalog.ts.

// NULL signifie que la fiche n'a jamais traversé le flux d'approbation
// partenaire réel : seed de démo (slug "demo-*") ou anciennes fiches vitrine
// générées en masse (owner_id NULL, même created_at à la milliseconde près
// pour toutes — vérifié, ce ne sont PAS de vrais pros malgré leur apparence).
// Les slugs "test-*" sont un résidu de QA distinct (owner_id non-null car
// créés via un vrai compte de test) — exclus à part.
export function isNonRealBusiness(business: { slug: string; owner_id: string | null }): boolean {
  return business.owner_id === null || business.slug.startsWith('test-');
}

// Vitrines commerciales : publiées et réellement réservables (voir
// demo-mode.ts), donc volontairement PAS dans isNonRealBusiness — qui bloque
// aussi la réservation ailleurs (bookings/create[-group], stripe/checkout).
// demo-book-n-pay DOIT rester réservable, seule sa découvrabilité organique
// doit être coupée (recherche, sitemap, indexation) — liste séparée exprès.
export const SHOWCASE_SLUGS = ['demo-book-n-pay'];

// Source de vérité unique pour "cette fiche ne doit jamais remonter dans le
// catalogue organique" (recherche, sitemap, robots meta) — à réutiliser
// partout où cette règle s'applique plutôt que de dupliquer la condition.
export function isExcludedFromPublicIndex(business: { slug: string; owner_id: string | null }): boolean {
  return isNonRealBusiness(business) || SHOWCASE_SLUGS.includes(business.slug);
}
