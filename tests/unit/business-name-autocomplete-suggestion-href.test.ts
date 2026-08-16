// Régression : selectSuggestion (BusinessNameAutocomplete.tsx) poussait vers
// /business/${slug}, une route qui n'a jamais existé dans ce repo (la vraie
// fiche établissement est /etablissement/[slug]) — faute de frappe présente
// dès la création du composant le 08/07/2026, jamais détectée avant le
// 16/08/2026 (39 jours), sur le chemin principal des visiteurs (suggestion
// cliquée dans la recherche). Ce test vérifie la route réelle produite, pas
// seulement que la fonction retourne "quelque chose".
import { describe, it, expect } from 'vitest';
import { suggestionHref, type Suggestion } from '@/app/(public)/recherche/_components/BusinessNameAutocomplete';

describe('suggestionHref', () => {
  it('suggestion établissement → /etablissement/[slug], jamais /business/', () => {
    const s: Suggestion = { kind: 'business', name: 'Salon Test', slug: 'salon-test' };
    expect(suggestionHref(s)).toBe('/etablissement/salon-test');
  });

  it('suggestion prestation → recherche filtrée par nom', () => {
    const s: Suggestion = { kind: 'prestation', name: 'Massage suédois' };
    expect(suggestionHref(s)).toBe('/recherche?q=Massage%20su%C3%A9dois');
  });
});
