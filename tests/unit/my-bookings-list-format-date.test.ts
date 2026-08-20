// formatBookingDate (src/components/booking/MyBookingsList.tsx) — bug réel
// trouvé le 20/08/2026 par parcours navigateur réel : réservé le 20/08 pour
// le 21/08 à 14:00, consulté le 20/08 à 12:09 (Paris) → affichait
// "Aujourd'hui" au lieu de "Demain". Cause : l'ancien calcul comparait des
// horodatages (date du RDV ancrée à midi moins l'instant courant, divisé
// par 24h) au lieu de dates calendaires — l'écart tombe sous 24h dès qu'on
// consulte après midi la veille, Math.floor arrondit alors à 0 jour.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatBookingDate } from '@/components/booking/MyBookingsList';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatBookingDate — comparaison calendaire, pas un écart d\'horodatages', () => {
  it('RDV demain, consulté l\'après-midi (scénario réel du bug) → "Demain", pas "Aujourd\'hui"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T10:09:00.000Z')); // 12:09 Paris (CEST)
    expect(formatBookingDate('2026-08-21')).toBe('Demain');
  });

  it('RDV aujourd\'hui, consulté le soir → toujours "Aujourd\'hui"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T20:00:00.000Z')); // 22:00 Paris (CEST)
    expect(formatBookingDate('2026-08-20')).toBe("Aujourd'hui");
  });

  it('RDV hier, consulté tôt le matin → "Hier"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T05:00:00.000Z')); // 07:00 Paris (CEST)
    expect(formatBookingDate('2026-08-19')).toBe('Hier');
  });

  it('RDV dans plusieurs jours → format jour/mois, pas un des trois libellés relatifs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T10:09:00.000Z'));
    const label = formatBookingDate('2026-08-25');
    expect(label).not.toBe("Aujourd'hui");
    expect(label).not.toBe('Demain');
    expect(label).not.toBe('Hier');
  });
});
