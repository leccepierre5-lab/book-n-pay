// src/lib/partner-plan-suggestion.ts — suggestion de plan à l'admin
// (AdminDashboard.tsx) portée par practitioners_count, dérivée de
// BNP_PLANS.maxStaff (même source que la limite serveur de 6be5bc8,
// [[project_bnp_staff_limit_by_plan]]). monthly_bookings_estimate ne
// suggère plus jamais de plan (décision 12/08 : réservations illimitées
// sur tous les plans, le volume n'a plus de rapport avec le plan).
import { describe, it, expect } from 'vitest';
import { BNP_PLANS } from '@/lib/plans-config';
import {
  PRACTITIONERS_COUNT_OPTIONS,
  getSuggestedPlanFromPractitionersCount,
  getPractitionersCountLabel,
  BOOKINGS_ESTIMATE_OPTIONS,
  getBookingsEstimateLabel,
} from '@/lib/partner-plan-suggestion';

describe('PRACTITIONERS_COUNT_OPTIONS — dérivé de BNP_PLANS', () => {
  it('un bucket par plan réel, dans le même ordre', () => {
    expect(PRACTITIONERS_COUNT_OPTIONS).toHaveLength(BNP_PLANS.length);
    expect(PRACTITIONERS_COUNT_OPTIONS.map((o) => o.plan)).toEqual(BNP_PLANS.map((p) => p.key));
  });

  // Bug trouvé le 16/08/2026 : le libellé était dérivé de l'effectif total
  // (pro inclus), pas de maxStaff seul — "2 à 3 collaborateurs" pour
  // Business (maxStaff=2) contredisait /tarifs ("Vous + 2 collaborateurs").
  // Ce test dérive l'attendu de BNP_PLANS.maxStaff, pas de chiffres en dur,
  // pour ne pas re-figer une régression future de la même forme.
  it('le libellé reflète maxStaff seul (collaborateurs hors pro), jamais l\'effectif total', () => {
    BNP_PLANS.forEach((plan, i) => {
      const option = PRACTITIONERS_COUNT_OPTIONS[i];
      const prevMaxStaff = i === 0 ? -1 : (BNP_PLANS[i - 1].maxStaff ?? -1);
      const staffMin = prevMaxStaff + 1;
      const staffMax = plan.maxStaff;
      if (staffMax === 0) {
        expect(option.label).toBe('Solo (aucun collaborateur)');
      } else if (staffMax === null) {
        expect(option.label).toBe(`${staffMin} collaborateurs ou plus`);
      } else if (staffMin === staffMax) {
        expect(option.label).toBe(`${staffMin} collaborateur`);
      } else {
        expect(option.label).toBe(`${staffMin} à ${staffMax} collaborateurs`);
      }
    });
  });

  it('valeurs actuelles (ancrage lisible) — Business affiche bien "1 à 2", jamais "2 à 3"', () => {
    expect(PRACTITIONERS_COUNT_OPTIONS).toEqual([
      { value: '1', label: 'Solo (aucun collaborateur)', plan: 'starter' },
      { value: '2-3', label: '1 à 2 collaborateurs', plan: 'business' },
      { value: '4+', label: '3 collaborateurs ou plus', plan: 'scale' },
    ]);
  });
});

describe('getSuggestedPlanFromPractitionersCount', () => {
  it.each([
    ['1', 'starter'],
    ['2-3', 'business'],
    ['4+', 'scale'],
  ])('%s → %s', (value, expected) => {
    expect(getSuggestedPlanFromPractitionersCount(value)).toBe(expected);
  });

  it('null (ancienne candidature) → undefined, pas de suggestion', () => {
    expect(getSuggestedPlanFromPractitionersCount(null)).toBeUndefined();
  });

  it('undefined → undefined', () => {
    expect(getSuggestedPlanFromPractitionersCount(undefined)).toBeUndefined();
  });

  it('valeur invalide/inconnue → undefined (jamais de fallback silencieux vers un plan)', () => {
    expect(getSuggestedPlanFromPractitionersCount('n-importe-quoi')).toBeUndefined();
  });
});

describe('getPractitionersCountLabel', () => {
  it('valeur connue → libellé humain', () => {
    expect(getPractitionersCountLabel('2-3')).toBe('1 à 2 collaborateurs');
  });

  it('null/absent → libellé de repli explicite, jamais un crash ni une valeur vide', () => {
    expect(getPractitionersCountLabel(null)).toBe('effectif non renseigné');
    expect(getPractitionersCountLabel(undefined)).toBe('effectif non renseigné');
  });
});

describe('BOOKINGS_ESTIMATE_OPTIONS — factorisé, sans référence à un plan', () => {
  it('3 options, libellés alignés sur les valeurs stockées (chk_pa_bookings_estimate, migration 0016)', () => {
    expect(BOOKINGS_ESTIMATE_OPTIONS).toEqual([
      { value: '0-80', label: "Jusqu'à 80 / mois" },
      { value: '81-300', label: '81 à 300 / mois' },
      { value: '300+', label: 'Plus de 300 / mois' },
    ]);
  });
});

describe('getBookingsEstimateLabel — facultatif depuis la migration 0044', () => {
  it('valeur connue → libellé humain', () => {
    expect(getBookingsEstimateLabel('81-300')).toBe('81 à 300 / mois');
  });

  it('null/undefined → libellé de repli explicite, jamais une valeur par défaut silencieuse', () => {
    expect(getBookingsEstimateLabel(null)).toBe('non renseigné');
    expect(getBookingsEstimateLabel(undefined)).toBe('non renseigné');
  });
});
