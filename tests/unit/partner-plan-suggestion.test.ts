// src/lib/partner-plan-suggestion.ts — suggestion de plan à l'admin
// (AdminDashboard.tsx) portée par practitioners_count, dérivée de
// BNP_PLANS.maxStaff (même source que la limite serveur de 6be5bc8,
// [[project_bnp_staff_limit_by_plan]]). monthly_bookings_estimate ne
// suggère plus jamais de plan (décision 12/08 : réservations illimitées
// sur tous les plans, le volume n'a plus de rapport avec le plan).
import { describe, it, expect } from 'vitest';
import {
  PRACTITIONERS_COUNT_OPTIONS,
  getSuggestedPlanFromPractitionersCount,
  getPractitionersCountLabel,
  BOOKINGS_ESTIMATE_OPTIONS,
} from '@/lib/partner-plan-suggestion';

describe('PRACTITIONERS_COUNT_OPTIONS — dérivé de BNP_PLANS.maxStaff', () => {
  it('3 buckets, un par plan, valeurs alignées sur les seuils actuels (1 / 3 / illimité)', () => {
    expect(PRACTITIONERS_COUNT_OPTIONS).toEqual([
      { value: '1', label: '1 praticien (solo)', plan: 'starter' },
      { value: '2-3', label: '2 à 3 praticiens', plan: 'business' },
      { value: '4+', label: '4 praticiens ou plus', plan: 'scale' },
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
    expect(getPractitionersCountLabel('2-3')).toBe('2 à 3 praticiens');
  });

  it('null/absent → libellé de repli explicite, jamais un crash ni une valeur vide', () => {
    expect(getPractitionersCountLabel(null)).toBe('effectif non renseigné');
    expect(getPractitionersCountLabel(undefined)).toBe('effectif non renseigné');
  });
});

describe('BOOKINGS_ESTIMATE_OPTIONS — factorisé, sans référence à un plan', () => {
  it('3 options, aucune ne porte de champ plan/hint (volume sans rapport avec le plan)', () => {
    expect(BOOKINGS_ESTIMATE_OPTIONS).toEqual([
      { value: '0-80', label: 'Moins de 120 / mois' },
      { value: '81-300', label: '121 à 300 / mois' },
      { value: '300+', label: 'Plus de 300 / mois' },
    ]);
  });
});
