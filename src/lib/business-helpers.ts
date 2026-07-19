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
