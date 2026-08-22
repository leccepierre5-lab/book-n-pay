// Régression réelle du 21/08/2026 : catalog.ts (commit e023844, 16/08) a
// trimmé le select de searchBusinesses à `services(price)`, sans `name` —
// le commentaire du commit prétendait avoir audité TOUS les consommateurs
// réels, mais avait oublié BusinessNameAutocomplete.tsx (composant client,
// absent du grep évident sur catalog.ts). `s.name.toLowerCase()` plantait
// alors sur `undefined` dès 2 caractères tapés dans /recherche — écran noir
// "This page couldn't load" en production, 5 jours durant (aucun test ni le
// typecheck ne l'a vu : catalog.ts fait `as unknown as BusinessWithDetails[]`,
// qui désactive toute vérification structurelle — voir la note de dette dans
// catalog.ts). Ce test verrouille le contrat réel : une prestation SANS nom
// utilisable doit être un signal d'échec de test, pas un crash utilisateur.
import { describe, it, expect } from 'vitest';
import { computeSuggestions, type SuggestibleBusiness } from '@/app/(public)/recherche/_components/BusinessNameAutocomplete';

const businesses: SuggestibleBusiness[] = [
  {
    name: 'Salon Bellevue',
    slug: 'salon-bellevue',
    services: [
      { name: 'Massage suédois' },
      { name: 'Massage californien' },
      { name: 'Épilation jambes' },
    ],
  },
  {
    name: 'Barbier du Port',
    slug: 'barbier-du-port',
    services: [{ name: 'Taille de barbe' }],
  },
];

describe('computeSuggestions', () => {
  it('filtre les prestations par préfixe de nom (insensible à la casse)', () => {
    const result = computeSuggestions(businesses, 'massage');
    expect(result).toEqual(
      expect.arrayContaining([
        { kind: 'prestation', name: 'Massage suédois' },
        { kind: 'prestation', name: 'Massage californien' },
      ])
    );
    expect(result.find((s) => s.name === 'Épilation jambes')).toBeUndefined();
  });

  it('filtre aussi les établissements par préfixe de nom, business avant prestation', () => {
    const result = computeSuggestions(businesses, 'sa');
    expect(result[0]).toEqual({ kind: 'business', name: 'Salon Bellevue', slug: 'salon-bellevue' });
  });

  it("ne plante pas et retourne [] sous MIN_CHARS (2), avant même de lire les services", () => {
    expect(computeSuggestions(businesses, 'm')).toEqual([]);
    expect(computeSuggestions(businesses, '')).toEqual([]);
  });

  it('un business sans service (services undefined ou null) ne plante pas', () => {
    const withoutServices: SuggestibleBusiness[] = [{ name: 'Sans Services', slug: 'sans-services' }];
    expect(computeSuggestions(withoutServices, 'sa')).toEqual([
      { kind: 'business', name: 'Sans Services', slug: 'sans-services' },
    ]);
    const withNullServices: SuggestibleBusiness[] = [
      { name: 'Null Services', slug: 'null-services', services: null },
    ];
    expect(computeSuggestions(withNullServices, 'nu')).toEqual([
      { kind: 'business', name: 'Null Services', slug: 'null-services' },
    ]);
  });

  it('dédoublonne les prestations de même nom entre plusieurs établissements', () => {
    const dup: SuggestibleBusiness[] = [
      { name: 'A', slug: 'a', services: [{ name: 'Manucure' }] },
      { name: 'B', slug: 'b', services: [{ name: 'Manucure' }] },
    ];
    const result = computeSuggestions(dup, 'manu').filter((s) => s.kind === 'prestation');
    expect(result).toHaveLength(1);
  });
});
