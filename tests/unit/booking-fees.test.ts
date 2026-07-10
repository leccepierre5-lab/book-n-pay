// calcFraisGestion / calcDeposit (src/lib/booking-utils.ts) pilotent le montant
// prélevé au client à chaque réservation — une régression silencieuse sur un
// boundary de palier ou sur la majoration "historique d'absences" se traduit
// directement par un montant facturé faux, sans passer par Stripe pour l'attraper
// (ce sont de simples calculs, pas des montants relus depuis une source externe).
import { describe, it, expect } from 'vitest';
import { calcFraisGestion, calcDeposit, type TrustScore } from '@/lib/booking-utils';

function trustScore(overrides: Partial<TrustScore>): TrustScore {
  return {
    score: 100,
    total: 0,
    honored: 0,
    noShows: 0,
    level: 'Nouveau',
    levelColor: '#3B82F6',
    levelIcon: '🆕',
    ...overrides,
  };
}

describe('calcFraisGestion', () => {
  it('0€ → 1,99€ (palier le plus bas)', () => {
    expect(calcFraisGestion(0)).toBe(1.99);
  });

  it('50€ → 1,99€ (pile au boundary bas, pas encore au palier supérieur)', () => {
    expect(calcFraisGestion(50)).toBe(1.99);
  });

  it('50,01€ → 2,10€ (premier prix qui bascule au palier suivant)', () => {
    expect(calcFraisGestion(50.01)).toBe(2.1);
  });

  it('80€ → 2,10€ (pile au boundary, encore dans le palier 2,10€)', () => {
    expect(calcFraisGestion(80)).toBe(2.1);
  });

  it('80,01€ → 2,30€', () => {
    expect(calcFraisGestion(80.01)).toBe(2.3);
  });

  it('100€ → 2,30€ (pile au boundary, encore dans le palier 2,30€)', () => {
    expect(calcFraisGestion(100)).toBe(2.3);
  });

  it('100,01€ → 2,50€ (palier le plus haut)', () => {
    expect(calcFraisGestion(100.01)).toBe(2.5);
  });

  it('500€ → 2,50€ (aucun palier au-delà, plafonné)', () => {
    expect(calcFraisGestion(500)).toBe(2.5);
  });
});

describe('calcDeposit', () => {
  it('client sans historique (total=0) → dépôt de base, même avec un score bas', () => {
    const r = calcDeposit(10, 100, trustScore({ score: 0, total: 0 }));
    expect(r.amount).toBe(10);
    expect(r.reason).toBeNull();
  });

  it('score=60 (pile au boundary) → pas de majoration, dépôt de base', () => {
    const r = calcDeposit(10, 100, trustScore({ score: 60, total: 5 }));
    expect(r.amount).toBe(10);
    expect(r.reason).toBeNull();
  });

  it('score=59 (juste sous le boundary), total>0 → majoration déclenchée', () => {
    const r = calcDeposit(10, 100, trustScore({ score: 59, total: 5 }));
    expect(r.reason).toBe("Frais majorés (historique d'absences)");
  });

  it('majoration : baseDeposit*2 gagne quand il dépasse price*0.5', () => {
    // baseDeposit*2 = 40, price*0.5 = 25 → max = 40
    const r = calcDeposit(20, 50, trustScore({ score: 30, total: 3 }));
    expect(r.amount).toBe(40);
    expect(r.reason).not.toBeNull();
  });

  it('majoration : price*0.5 gagne quand il dépasse baseDeposit*2', () => {
    // baseDeposit*2 = 10, price*0.5 = 75 → max = 75
    const r = calcDeposit(5, 150, trustScore({ score: 30, total: 3 }));
    expect(r.amount).toBe(75);
    expect(r.reason).not.toBeNull();
  });

  it('majoration : le résultat est arrondi (Math.round)', () => {
    // baseDeposit*2 = 15, price*0.5 = 15.4 → max = 15.4 → arrondi 15
    const r = calcDeposit(7.5, 30.8, trustScore({ score: 10, total: 1 }));
    expect(r.amount).toBe(15);
  });

  it('score=0, total=1 → cas le plus dégradé, toujours majoré', () => {
    const r = calcDeposit(10, 200, trustScore({ score: 0, total: 1 }));
    expect(r.amount).toBe(100);
    expect(r.reason).not.toBeNull();
  });
});
