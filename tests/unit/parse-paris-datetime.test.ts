// parseParisDatetime (src/lib/booking-utils.ts) — helper central de tout le
// module planning (staff-availability.ts, staff-assignment.ts, agenda.ts,
// EquipeManager.tsx, AgendaView.tsx). Bug réel trouvé le 12/07/2026 lors du
// test visuel de /pro/planning : l'ancienne implémentation (toLocaleString
// + re-parsing de chaîne) supposait implicitement que le fuseau système du
// runtime était UTC — correcte sur Vercel par coïncidence, silencieusement
// FAUSSE (aucun décalage appliqué) sur une machine/un navigateur réglé sur
// Europe/Paris, exactement le cas d'un pro français dans son propre
// navigateur (EquipeManager.tsx, AgendaView.tsx appellent maintenant cette
// fonction côté client).
//
// Ce fichier vérifie le résultat en valeur ABSOLUE (comparaison à un ISO UTC
// littéral connu), jamais en comparant deux appels de la fonction entre eux
// — c'est précisément ce type de comparaison relative qui a laissé passer le
// bug initial dans les tests de staff-availability.test.ts (les deux côtés
// de chaque comparaison utilisaient la même fonction, donc restaient
// mutuellement cohérents même quand elle était fausse dans l'absolu). Un
// test qui compare à un ISO littéral est indépendant du fuseau système de la
// machine qui exécute la suite.
import { describe, it, expect } from 'vitest';
import { parseParisDatetime } from '@/lib/booking-utils';

describe('parseParisDatetime', () => {
  it('été (CEST, UTC+2) : 12/07/2026 14h00 Paris → 12h00 UTC', () => {
    expect(parseParisDatetime('2026-07-12', '14:00').toISOString()).toBe('2026-07-12T12:00:00.000Z');
  });

  it('hiver (CET, UTC+1) : 15/01/2026 14h00 Paris → 13h00 UTC', () => {
    expect(parseParisDatetime('2026-01-15', '14:00').toISOString()).toBe('2026-01-15T13:00:00.000Z');
  });

  it('journée entière été : 15/08/2026 00h00 Paris → 14/08 22h00 UTC (exemple de référence validé en session)', () => {
    expect(parseParisDatetime('2026-08-15', '00:00').toISOString()).toBe('2026-08-14T22:00:00.000Z');
  });

  it('journée entière été : 15/08/2026 23h59 Paris → 15/08 21h59 UTC', () => {
    expect(parseParisDatetime('2026-08-15', '23:59').toISOString()).toBe('2026-08-15T21:59:00.000Z');
  });

  it('minuit exact, hiver : 01/01/2026 00h00 Paris → 31/12/2025 23h00 UTC', () => {
    expect(parseParisDatetime('2026-01-01', '00:00').toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });
});
