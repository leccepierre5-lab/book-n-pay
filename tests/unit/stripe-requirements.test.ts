// src/lib/stripe-requirements.ts — logique pure du Bloc C (surveillance des
// exigences KYC Stripe 2026 sur les comptes Express). Testée directement,
// sans mocker Stripe ni Supabase : le webhook et ProDashboard ne font
// qu'appeler ces deux fonctions.
import { describe, it, expect } from 'vitest';
import { mapAccountRequirements, getStripeRequirementsBannerLevel } from '@/lib/stripe-requirements';

describe('mapAccountRequirements', () => {
  it('compte complet (requirements + future_requirements) : tous les champs mappés, timestamps convertis en ISO', () => {
    const account: any = {
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        disabled_reason: null,
        currently_due: ['individual.verification.document'],
        past_due: [],
        current_deadline: 1780000000, // unix seconds
      },
      future_requirements: {
        currently_due: ['individual.id_number'],
        current_deadline: 1793000000,
      },
    };
    const now = new Date('2026-08-14T12:00:00Z');

    const result = mapAccountRequirements(account, now);

    expect(result).toEqual({
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_disabled_reason: null,
      stripe_currently_due: ['individual.verification.document'],
      stripe_past_due: [],
      stripe_current_deadline: new Date(1780000000 * 1000).toISOString(),
      stripe_future_due: ['individual.id_number'],
      stripe_future_deadline: new Date(1793000000 * 1000).toISOString(),
      stripe_requirements_synced_at: now.toISOString(),
    });
  });

  it("sans future_requirements (absent du payload) : future_due=[], future_deadline=null, pas de crash", () => {
    const account: any = {
      charges_enabled: true,
      payouts_enabled: false,
      requirements: {
        disabled_reason: 'requirements.past_due',
        currently_due: [],
        past_due: ['individual.verification.document'],
        current_deadline: 1780000000,
      },
      // future_requirements absent
    };

    const result = mapAccountRequirements(account, new Date('2026-08-14T12:00:00Z'));

    expect(result.stripe_future_due).toEqual([]);
    expect(result.stripe_future_deadline).toBeNull();
    expect(result.stripe_payouts_enabled).toBe(false);
    expect(result.stripe_disabled_reason).toBe('requirements.past_due');
  });

  it('sans requirements du tout (compte tout juste créé) : tableaux vides, deadlines null, pas de crash', () => {
    const account: any = { charges_enabled: false, payouts_enabled: false };

    const result = mapAccountRequirements(account, new Date('2026-08-14T12:00:00Z'));

    expect(result.stripe_currently_due).toEqual([]);
    expect(result.stripe_past_due).toEqual([]);
    expect(result.stripe_current_deadline).toBeNull();
    expect(result.stripe_future_due).toEqual([]);
    expect(result.stripe_future_deadline).toBeNull();
  });
});

describe('getStripeRequirementsBannerLevel', () => {
  const now = new Date('2026-08-14T12:00:00Z');

  it('rouge : payoutsEnabled=false, prioritaire même si une deadline lointaine existe aussi', () => {
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: false,
      pastDue: [],
      currentDeadline: null,
      futureDeadline: '2026-12-01T00:00:00Z',
    }, now);
    expect(level).toBe('red');
  });

  it('orange : pastDue non vide', () => {
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: true,
      pastDue: ['individual.verification.document'],
      currentDeadline: null,
      futureDeadline: null,
    }, now);
    expect(level).toBe('orange');
  });

  it('orange : currentDeadline sous 14 jours (pastDue vide)', () => {
    const soon = new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString();
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: true,
      pastDue: [],
      currentDeadline: soon,
      futureDeadline: null,
    }, now);
    expect(level).toBe('orange');
  });

  it('bleu : futureDeadline posé, rien d\'urgent par ailleurs', () => {
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: true,
      pastDue: [],
      currentDeadline: null,
      futureDeadline: '2026-12-01T00:00:00Z',
    }, now);
    expect(level).toBe('blue');
  });

  it('aucun bandeau : tout est vert (payouts actifs, rien de dû, pas de deadline)', () => {
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: true,
      pastDue: [],
      currentDeadline: null,
      futureDeadline: null,
    }, now);
    expect(level).toBeNull();
  });

  it('aucun bandeau : currentDeadline lointaine (> 14 jours), pas encore orange', () => {
    const far = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: true,
      pastDue: [],
      currentDeadline: far,
      futureDeadline: null,
    }, now);
    expect(level).toBeNull();
  });

  it('aucun bandeau : payoutsEnabled=null (jamais synchronisé) — jamais traité comme rouge', () => {
    const level = getStripeRequirementsBannerLevel({
      payoutsEnabled: null,
      pastDue: null,
      currentDeadline: null,
      futureDeadline: null,
    }, now);
    expect(level).toBeNull();
  });
});
