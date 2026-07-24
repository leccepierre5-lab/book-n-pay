// getParisDateOffsetStr / getParisTomorrowStr (src/lib/booking-utils.ts) —
// bug réel trouvé le 24/07/2026 (audit TZ) : plusieurs call sites calculaient
// "aujourd'hui" via `new Date().toISOString().split('T')[0]`, qui renvoie
// TOUJOURS la date UTC, quel que soit process.env.TZ (spec JS, pas une
// question de configuration runtime). Entre 00h et 02h heure de Paris en été
// (CEST, UTC+2), l'UTC est encore sur la veille : "aujourd'hui" calculé ainsi
// était décalé d'un jour derrière le vrai calendrier Paris utilisé partout
// ailleurs (bookings.date, flash_slots.date). Remplacé par ce helper, qui
// passe par Intl.DateTimeFormat({timeZone:'Europe/Paris'}) et est donc
// indépendant du fuseau du runtime qui l'exécute.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getParisDateOffsetStr, getParisTomorrowStr, toParisDateStr } from '@/lib/booking-utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('getParisDateOffsetStr — fenêtre de décalage nocturne Paris/UTC', () => {
  it('00h30 Paris (été, CEST = 22h30 UTC la veille) → renvoie la date Paris, pas la date UTC', () => {
    // 2026-08-15 00:30 Paris (CEST, UTC+2) = 2026-08-14 22:30 UTC.
    // `new Date().toISOString().split('T')[0]` renverrait '2026-08-14' (faux) ;
    // le vrai calendrier Paris est déjà le '2026-08-15'.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T22:30:00.000Z'));
    expect(getParisDateOffsetStr(0)).toBe('2026-08-15');
  });

  it('01h59 Paris (été, juste avant le rattrapage UTC) → toujours la date Paris', () => {
    // 2026-08-15 01:59 Paris = 2026-08-14 23:59 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T23:59:00.000Z'));
    expect(getParisDateOffsetStr(0)).toBe('2026-08-15');
  });

  it('02h00 Paris (été, l\'UTC vient de rattraper) → les deux calendriers concordent', () => {
    // 2026-08-15 02:00 Paris = 2026-08-15 00:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
    expect(getParisDateOffsetStr(0)).toBe('2026-08-15');
  });

  it('00h30 Paris, hiver (CET = 23h30 UTC la veille) → même décalage, fenêtre plus courte', () => {
    // 2026-01-15 00:30 Paris (CET, UTC+1) = 2026-01-14 23:30 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T23:30:00.000Z'));
    expect(getParisDateOffsetStr(0)).toBe('2026-01-15');
  });

  it('offset non nul reste correct pendant la fenêtre de décalage (J+1 depuis un "aujourd\'hui" Paris déjà avancé)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T22:30:00.000Z')); // 2026-08-15 00:30 Paris
    expect(getParisDateOffsetStr(1)).toBe('2026-08-16');
    expect(getParisTomorrowStr()).toBe('2026-08-16');
  });

  it('hors fenêtre (milieu de journée) : Paris et UTC concordent, comportement inchangé', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z')); // 14h Paris
    expect(getParisDateOffsetStr(0)).toBe('2026-08-15');
  });
});

// toParisDateStr — même bug, forme différente : convertit un instant DÉJÀ
// CONNU (pas "maintenant") en date Paris — cas de setup-billing/route.ts
// (engagement_end_date = startDate + N mois, next_billing_date = timestamp
// Stripe) et admin/applications/route.ts, qui stockaient auparavant l'ISO
// UTC complet (`.toISOString()`) au lieu d'une date Paris. Pas besoin
// d'horloge simulée ici : l'instant est un paramètre explicite, comparé à un
// littéral ISO connu (même méthodologie que parse-paris-datetime.test.ts).
describe('toParisDateStr — instant arbitraire (pas "maintenant")', () => {
  it('été : 22h30 UTC = 00h30 Paris le lendemain → date Paris, pas date UTC', () => {
    expect(toParisDateStr(new Date('2026-08-14T22:30:00.000Z'))).toBe('2026-08-15');
  });

  it('hiver : 23h30 UTC = 00h30 Paris le lendemain → date Paris, pas date UTC', () => {
    expect(toParisDateStr(new Date('2026-11-14T23:30:00.000Z'))).toBe('2026-11-15');
  });

  it('milieu de journée : Paris et UTC concordent', () => {
    expect(toParisDateStr(new Date('2026-08-15T12:00:00.000Z'))).toBe('2026-08-15');
  });

  it('reproduit le scénario setup-billing : un timestamp Stripe (next_billing_date) proche de minuit Paris', () => {
    // Stripe current_period_end à 22:15 UTC (= 00:15 Paris CEST le lendemain).
    // toISOString().split('T')[0] aurait renvoyé '2026-09-30' (faux) au lieu
    // du vrai jour de prélèvement Paris, '2026-10-01'.
    const stripeTs = Math.floor(new Date('2026-09-30T22:15:00.000Z').getTime() / 1000);
    expect(toParisDateStr(new Date(stripeTs * 1000))).toBe('2026-10-01');
  });
});
