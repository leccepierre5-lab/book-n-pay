// src/lib/booking-utils.ts::phonesMatch — faille d'autorisation trouvée en
// audit le 15/08 (utilisée pour la vérification d'identité dans
// bookings/cancel et post-visit-status/ack, pas juste pour l'affichage).
// normalizePhone() sur une saisie sans aucun chiffre renvoie '', donc
// l'ancien garde-fou (!a || !b, testé AVANT normalisation) laissait deux
// téléphones invalides DIFFÉRENTS matcher entre eux via '' === ''.
import { describe, it, expect } from 'vitest';
import { phonesMatch } from '@/lib/booking-utils';

describe('phonesMatch', () => {
  it('deux téléphones invalides différents (aucun chiffre) → false, pas un faux match', () => {
    expect(phonesMatch('okokokok', 'xyzxyz')).toBe(false);
  });

  it('même texte invalide des deux côtés → false également (toujours aucun chiffre)', () => {
    expect(phonesMatch('okokokok', 'okokokok')).toBe(false);
  });

  it('un téléphone valide vs un invalide sans chiffre → false', () => {
    expect(phonesMatch('0612345678', 'okokokok')).toBe(false);
  });

  it('null/undefined/chaîne vide des deux côtés → false (comportement préexistant)', () => {
    expect(phonesMatch(null, '0612345678')).toBe(false);
    expect(phonesMatch('0612345678', undefined)).toBe(false);
    expect(phonesMatch('', '')).toBe(false);
  });

  it('même numéro réel, formats différents → true (comportement préexistant préservé)', () => {
    expect(phonesMatch('0612345678', '+33 6 12 34 56 78')).toBe(true);
    expect(phonesMatch('06.12.34.56.78', '+33612345678')).toBe(true);
  });

  it('deux numéros valides mais différents → false', () => {
    expect(phonesMatch('0612345678', '0698765432')).toBe(false);
  });
});
