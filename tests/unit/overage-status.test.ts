// getOverageStatus (src/lib/booking-utils.ts) est la fonction qui décide si
// un pro est en dépassement de quota et doit être facturé hors-forfait —
// c'est elle qui pilote toute la chaîne de facturation blindée cette semaine
// (maybeCreateOverageCharge, invoiceUnpaidOverageCharges). Une régression
// silencieuse ici, ce sont des pros facturés à tort ou jamais facturés :
// à traiter comme critique, chaque boundary doit être verrouillée.
import { describe, it, expect } from 'vitest';
import { getOverageStatus } from '@/lib/booking-utils';

describe('getOverageStatus', () => {
  describe('plan starter (quota 120)', () => {
    it('count=0 → included, aucun dépassement', () => {
      const r = getOverageStatus(0, 'starter');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
      expect(r.nextPlanLabel).toBe('Business');
    });

    it('count=119 → included, juste sous le quota', () => {
      const r = getOverageStatus(119, 'starter');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
    });

    it('count=120 → included, pile au quota (boundary overage=0)', () => {
      const r = getOverageStatus(120, 'starter');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
    });

    it('count=121 → overage, premier dépassement facturé dès la 1ère résa hors quota (OVERAGE_GRACE=0)', () => {
      const r = getOverageStatus(121, 'starter');
      expect(r.status).toBe('overage');
      expect(r.overageCount).toBe(1);
    });

    it('count=130 → overage, overageCount égale exactement le nombre de résa hors quota (plus de décalage grâce)', () => {
      const r = getOverageStatus(130, 'starter');
      expect(r.status).toBe('overage');
      expect(r.overageCount).toBe(10);
    });

    it('count=140 → overage, progression linéaire sans palier de grâce', () => {
      const r = getOverageStatus(140, 'starter');
      expect(r.status).toBe('overage');
      expect(r.overageCount).toBe(20);
    });
  });

  describe('plan business (quota 300)', () => {
    it('count=300 → included, pile au quota (revalide le boundary sur un autre quota)', () => {
      const r = getOverageStatus(300, 'business');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
    });

    it('count=301 → overage, bascule facturable dès la 1ère résa hors quota (OVERAGE_GRACE=0)', () => {
      const r = getOverageStatus(301, 'business');
      expect(r.status).toBe('overage');
      expect(r.overageCount).toBe(1);
      expect(r.nextPlanLabel).toBe('Scale');
    });
  });

  describe('plan scale (quota illimité)', () => {
    it('count=0 → included, aucun plan supérieur', () => {
      const r = getOverageStatus(0, 'scale');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
      expect(r.nextPlanLabel).toBeNull();
    });

    it('count=10000 → included quel que soit le volume (garantit l\'illimité)', () => {
      const r = getOverageStatus(10000, 'scale');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
    });
  });

  describe('robustesse', () => {
    it('planKey inconnu → included par défaut, label = clé brute (fallback figé)', () => {
      const r = getOverageStatus(500, 'nonexistent');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
      expect(r.currentPlanLabel).toBe('nonexistent');
      expect(r.nextPlanLabel).toBeNull();
    });

    it('count négatif → included, jamais de facturation par erreur sur une entrée invalide', () => {
      const r = getOverageStatus(-1, 'starter');
      expect(r.status).toBe('included');
      expect(r.overageCount).toBe(0);
    });

    it('nextPlanLabel correct pour starter→Business et business→Scale', () => {
      expect(getOverageStatus(0, 'starter').nextPlanLabel).toBe('Business');
      expect(getOverageStatus(0, 'business').nextPlanLabel).toBe('Scale');
    });
  });
});
