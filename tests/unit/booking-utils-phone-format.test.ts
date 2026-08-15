// src/lib/booking-utils.ts::isValidPhoneFormat — audit du 15/08, le champ
// téléphone à l'inscription acceptait "okokokok" sans aucun contrôle.
import { describe, it, expect } from 'vitest';
import { isValidPhoneFormat } from '@/lib/booking-utils';

describe('isValidPhoneFormat', () => {
  it('rejette une saisie sans aucun chiffre', () => {
    expect(isValidPhoneFormat('okokokok')).toBe(false);
    expect(isValidPhoneFormat('okokokokok')).toBe(false); // ≥10 caractères, aurait passé l'ancien contrôle de longueur
  });

  it('accepte un mobile/fixe métropolitain, avec ou sans séparateurs', () => {
    expect(isValidPhoneFormat('0612345678')).toBe(true);
    expect(isValidPhoneFormat('06 12 34 56 78')).toBe(true);
    expect(isValidPhoneFormat('06.12.34.56.78')).toBe(true);
    expect(isValidPhoneFormat('+33612345678')).toBe(true);
    expect(isValidPhoneFormat('+33 6 12 34 56 78')).toBe(true);
  });

  it('accepte les DOM-TOM (Guadeloupe, Guyane, Martinique, Réunion, Mayotte)', () => {
    expect(isValidPhoneFormat('+590690123456')).toBe(true);
    expect(isValidPhoneFormat('+594694123456')).toBe(true);
    expect(isValidPhoneFormat('+596696123456')).toBe(true);
    expect(isValidPhoneFormat('+262692123456')).toBe(true);
    expect(isValidPhoneFormat('+269639123456')).toBe(true);
    expect(isValidPhoneFormat('0590123456')).toBe(true); // forme domestique, même gabarit que la métropole
  });

  it('rejette un numéro étranger (indicatif non couvert)', () => {
    expect(isValidPhoneFormat('+14155552671')).toBe(false);
    expect(isValidPhoneFormat('+442071234567')).toBe(false);
  });

  it('rejette une longueur incorrecte', () => {
    expect(isValidPhoneFormat('061234567')).toBe(false); // 1 chiffre manquant
    expect(isValidPhoneFormat('06123456789')).toBe(false); // 1 chiffre en trop
    expect(isValidPhoneFormat('')).toBe(false);
  });

  it('rejette un numéro commençant par 0 après l\'indicatif (jamais un vrai numéro FR)', () => {
    expect(isValidPhoneFormat('0012345678')).toBe(false);
  });
});
