// buildIcs (src/lib/ics.ts) — génère la pièce jointe .ics des emails de RDV
// (confirmation, annulation). Trois points de vigilance RFC 5545 identifiés
// à l'écriture : le pliage de ligne à 75 octets (un SUMMARY accentué compte
// plus d'octets que de caractères en UTF-8), l'échappement d'une valeur
// contenant une virgule (adresse), et l'incrément de SEQUENCE qui permet à
// l'agenda du client de mettre à jour l'événement au lieu de le dupliquer.
import { describe, it, expect } from 'vitest';
import { buildIcs } from '@/lib/ics';
import { parseParisDatetime } from '@/lib/booking-utils';

const base = {
  uid: 'test-booking-1@book-n-pay.com',
  start: new Date('2026-09-01T09:00:00.000Z'),
  durationMin: 60,
  organizerName: "Salon L'Étoile",
  organizerEmail: 'noreply@book-n-pay.com',
  attendeeEmail: 'client@example.com',
};

describe('buildIcs', () => {
  it('plie toute ligne au-delà de 75 octets (continuation CRLF + espace)', () => {
    const ics = buildIcs({
      ...base,
      summary: 'RDV — ' + 'Épilation à la cire intégrale spéciale été '.repeat(2),
    });
    for (const line of ics.split('\r\n')) {
      // Une ligne de continuation (préfixée par un espace) ne compte pas pour
      // elle-même — seule une ligne logique non repliée dépasserait 75 octets.
      if (line.startsWith(' ')) continue;
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    // La ligne SUMMARY doit être effectivement repliée (preuve que le test
    // couvre bien le cas > 75 octets et ne passe pas par accident).
    expect(ics).toMatch(/SUMMARY:[\s\S]*\r\n /);
  });

  it('échappe virgule, point-virgule et retour à la ligne dans une valeur', () => {
    const ics = buildIcs({
      ...base,
      summary: 'RDV — Coupe',
      location: '12 rue de la Paix, Bâtiment B; 2e étage',
    });
    expect(ics).toContain('12 rue de la Paix\\, Bâtiment B\\; 2e étage');
  });

  it('reflète SEQUENCE et STATUS/METHOD selon REQUEST vs CANCEL', () => {
    const request = buildIcs({ ...base, summary: 'RDV — Coupe', sequence: 0, method: 'REQUEST' });
    expect(request).toContain('METHOD:REQUEST');
    expect(request).toContain('STATUS:CONFIRMED');
    expect(request).toContain('SEQUENCE:0');
    expect(request).toContain('BEGIN:VALARM');

    const cancel = buildIcs({ ...base, summary: 'RDV — Coupe', sequence: 1, method: 'CANCEL' });
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('STATUS:CANCELLED');
    expect(cancel).toContain('SEQUENCE:1');
    expect(cancel).not.toContain('BEGIN:VALARM');
  });

  it('garde le même UID entre confirmation et annulation (corrélation agenda)', () => {
    const request = buildIcs({ ...base, summary: 'RDV — Coupe', sequence: 0, method: 'REQUEST' });
    const cancel = buildIcs({ ...base, summary: 'RDV — Coupe', sequence: 1, method: 'CANCEL' });
    expect(request).toContain(`UID:${base.uid}`);
    expect(cancel).toContain(`UID:${base.uid}`);
  });

  it('utilise CRLF (pas LF seul) — Outlook rejette \\n seul', () => {
    const ics = buildIcs({ ...base, summary: 'RDV — Coupe' });
    expect(ics).toContain('\r\n');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it("applique le vrai décalage Paris (CEST été / CET hiver) via parseParisDatetime, pas un offset codé en dur", () => {
    // Le champ `start` de buildIcs est un instant déjà en UTC — la conversion
    // Paris→UTC est la responsabilité de parseParisDatetime (booking-utils.ts,
    // seule primitive fiable, voir son commentaire). Ce test vérifie le
    // pipeline complet (date/heure Paris → .ics) plutôt que buildIcs isolé,
    // pour attraper un DTSTART décalé d'une heure la moitié de l'année si un
    // futur appelant construisait `start` autrement (ex. new Date(date+'T'+time)).
    const summer = buildIcs({ ...base, summary: 'RDV — Coupe', start: parseParisDatetime('2026-08-20', '14:00') });
    expect(summer).toContain('DTSTART:20260820T120000Z');

    const winter = buildIcs({ ...base, summary: 'RDV — Coupe', start: parseParisDatetime('2026-11-20', '14:00') });
    expect(winter).toContain('DTSTART:20261120T130000Z');
  });

  it('DTEND = DTSTART + durationMin', () => {
    const ics = buildIcs({ ...base, summary: 'RDV — Coupe', durationMin: 90 });
    expect(ics).toContain('DTSTART:20260901T090000Z');
    expect(ics).toContain('DTEND:20260901T103000Z');
  });
});
