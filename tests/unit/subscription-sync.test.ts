// src/lib/subscription-sync.ts — Bloc D (14/08), logique pure derrière le
// handler webhook customer.subscription.updated. Avant ce chantier, aucun
// event ne synchronisait plan_key/subscription_status depuis l'état réel
// de l'abonnement Stripe (seuls invoice.payment_succeeded/failed et
// customer.subscription.deleted existaient — un changement de formule ou
// un passage en impayé fait depuis le Dashboard Stripe n'était jamais
// répercuté).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePlanKeyFromPriceId,
  mapStripeSubscriptionStatus,
  computeSubscriptionSyncUpdate,
} from '@/lib/subscription-sync';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.STRIPE_PRICE_STARTER = 'price_starter_test';
  process.env.STRIPE_PRICE_BUSINESS = 'price_business_test';
  process.env.STRIPE_PRICE_SCALE = 'price_scale_test';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolvePlanKeyFromPriceId', () => {
  it('résout chaque plan depuis son Price ID configuré', () => {
    expect(resolvePlanKeyFromPriceId('price_starter_test')).toBe('starter');
    expect(resolvePlanKeyFromPriceId('price_business_test')).toBe('business');
    expect(resolvePlanKeyFromPriceId('price_scale_test')).toBe('scale');
  });

  it('Price ID inconnu (ne correspond à aucune variable env) → null, jamais deviné', () => {
    expect(resolvePlanKeyFromPriceId('price_totally_unrelated')).toBeNull();
  });

  it('priceId absent → null', () => {
    expect(resolvePlanKeyFromPriceId(undefined)).toBeNull();
    expect(resolvePlanKeyFromPriceId(null)).toBeNull();
  });
});

describe('mapStripeSubscriptionStatus', () => {
  it('active → active', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('active');
  });

  it('past_due → past_due', () => {
    expect(mapStripeSubscriptionStatus('past_due')).toBe('past_due');
  });

  it('unpaid → past_due (pas de statut "unpaid" distinct côté app)', () => {
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('past_due');
  });

  it('canceled → cancelled', () => {
    expect(mapStripeSubscriptionStatus('canceled')).toBe('cancelled');
  });

  it("statuts sans équivalent clair (trialing, paused, incomplete...) → null, jamais un état inventé", () => {
    expect(mapStripeSubscriptionStatus('trialing')).toBeNull();
    expect(mapStripeSubscriptionStatus('paused')).toBeNull();
    expect(mapStripeSubscriptionStatus('incomplete')).toBeNull();
    expect(mapStripeSubscriptionStatus('incomplete_expired')).toBeNull();
  });
});

function makeSubscription(overrides: { priceId?: string; status?: string }): any {
  return {
    status: overrides.status ?? 'active',
    items: { data: [{ price: { id: overrides.priceId ?? 'price_business_test' } }] },
  };
}

describe('computeSubscriptionSyncUpdate', () => {
  it('changement de plan détecté (upgrade business → scale) : plan_key seul dans le résultat', () => {
    const sub = makeSubscription({ priceId: 'price_scale_test', status: 'active' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'business', subscription_status: 'active' });
    expect(update).toEqual({ plan_key: 'scale' });
  });

  it('passage en impayé détecté : subscription_status seul dans le résultat', () => {
    const sub = makeSubscription({ priceId: 'price_business_test', status: 'past_due' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'business', subscription_status: 'active' });
    expect(update).toEqual({ subscription_status: 'past_due' });
  });

  it('rien de changé (même plan, même statut) : résultat vide, aucun update à faire', () => {
    const sub = makeSubscription({ priceId: 'price_business_test', status: 'active' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'business', subscription_status: 'active' });
    expect(update).toEqual({});
  });

  it('les deux changent en même temps (upgrade + retour à active après impayé)', () => {
    const sub = makeSubscription({ priceId: 'price_scale_test', status: 'active' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'starter', subscription_status: 'past_due' });
    expect(update).toEqual({ plan_key: 'scale', subscription_status: 'active' });
  });

  it('Price ID inconnu : plan_key absent du résultat, jamais écrasé par une valeur devinée', () => {
    const sub = makeSubscription({ priceId: 'price_totally_unrelated', status: 'active' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'business', subscription_status: 'active' });
    expect(update).toEqual({});
  });

  it('statut Stripe sans équivalent (trialing) : subscription_status absent du résultat', () => {
    const sub = makeSubscription({ priceId: 'price_business_test', status: 'trialing' });
    const update = computeSubscriptionSyncUpdate(sub, { plan_key: 'business', subscription_status: 'active' });
    expect(update).toEqual({});
  });
});
