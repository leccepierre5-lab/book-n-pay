// src/lib/plans-config.ts — LOT 2 (11/08, refonte tarifaire) : Starter passe
// à engagementMonths=0 (suppression de la période d'engagement). Ces tests
// prouvent, via la vraie fonction (pas une relecture de code), que
// setMonth(+0) ne produit aucun rollover de date sur des cas limites
// (fin de mois, année bissextile, veille de changement d'heure) et que
// isInEngagementPeriod renvoie bien false immédiatement après le départ.
import { describe, it, expect } from 'vitest';
import { getEngagementEndDate, isInEngagementPeriod, BNP_PLANS } from '@/lib/plans-config';

describe('getEngagementEndDate — Starter (engagementMonths=0)', () => {
  const cases: [string, Date][] = [
    ['cas courant', new Date('2026-08-11T10:00:00.000Z')],
    ['fin de mois (31)', new Date('2026-01-31T23:00:00.000Z')],
    ['année bissextile (29/02)', new Date('2028-02-29T12:00:00.000Z')],
    ['veille changement d\'heure FR (25/10)', new Date('2026-10-25T01:30:00.000Z')],
  ];

  it.each(cases)('%s → date de fin identique à la date de départ', (_label, start) => {
    const end = getEngagementEndDate(start, 'starter');
    expect(end.getTime()).toBe(start.getTime());
  });

  it('isInEngagementPeriod renvoie false immédiatement après le départ', () => {
    const start = new Date(Date.now() - 1000);
    expect(isInEngagementPeriod(start, 'starter')).toBe(false);
  });
});

describe('getEngagementEndDate — Business/Scale non régressés', () => {
  it('Business (6 mois) avance bien de 6 mois', () => {
    const start = new Date('2026-08-11T10:00:00.000Z');
    const end = getEngagementEndDate(start, 'business');
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 6) % 12);
  });

  it('Scale (12 mois) avance bien de 12 mois (même mois, année+1)', () => {
    const start = new Date('2026-08-11T10:00:00.000Z');
    const end = getEngagementEndDate(start, 'scale');
    expect(end.getUTCFullYear()).toBe(start.getUTCFullYear() + 1);
    expect(end.getUTCMonth()).toBe(start.getUTCMonth());
  });
});

describe('BNP_PLANS — plus de champ quota/nextPlan (LOT 2)', () => {
  it('aucun plan ne porte plus quota ni nextPlan', () => {
    for (const plan of BNP_PLANS) {
      expect(plan).not.toHaveProperty('quota');
      expect(plan).not.toHaveProperty('nextPlan');
    }
  });
});
