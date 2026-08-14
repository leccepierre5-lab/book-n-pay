// src/lib/subscription-sync.ts
// Bloc D (14/08) — logique pure pour synchroniser business_settings depuis
// l'état RÉEL d'un abonnement Stripe (event customer.subscription.updated),
// plutôt que de ne se fier qu'aux actions initiées par l'app (setup-billing).
// Stripe reste la source de vérité : un changement fait depuis le Dashboard
// (upgrade/downgrade, passage en impayé) doit se répercuter, pas seulement
// un changement déclenché par un flux applicatif qui n'existe pas encore.
import type Stripe from 'stripe';
import { BNP_PLANS, type PlanKey } from '@/lib/plans-config';

// Retrouve le plan à partir du Price actuellement sur l'abonnement, en
// comparant aux variables d'env STRIPE_PRICE_STARTER/BUSINESS/SCALE (même
// source que setup-billing/route.ts, qui fait le mapping dans l'autre sens).
// `null` si le Price ne correspond à aucun plan connu — ne jamais écraser
// plan_key avec une valeur devinée.
export function resolvePlanKeyFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  const plan = BNP_PLANS.find((p) => process.env[p.stripePriceEnvKey] === priceId);
  return plan?.key ?? null;
}

export type AppSubscriptionStatus = 'pending' | 'active' | 'past_due' | 'cancelled';

// Stripe a plus d'états que l'app n'en modélise (pas d'essai dans ce
// produit, jamais de `paused`/`incomplete*` vus en pratique) — seuls les
// statuts avec un équivalent clair sont mappés ; les autres renvoient
// `null` et ne doivent JAMAIS toucher business_settings.subscription_status
// (mieux vaut un statut pas à jour qu'un statut faux).
export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): AppSubscriptionStatus | null {
  switch (status) {
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'cancelled';
    default:
      return null;
  }
}

export interface SubscriptionSyncUpdate {
  plan_key?: PlanKey;
  subscription_status?: AppSubscriptionStatus;
}

// N'inclut une clé dans le résultat que si une valeur nouvelle ET différente
// de l'existant a été résolue — un `update({})` vide en base est inoffensif
// mais autant ne jamais l'émettre (le webhook route peut sauter l'appel).
export function computeSubscriptionSyncUpdate(
  subscription: Stripe.Subscription,
  current: { plan_key: string | null; subscription_status: string | null }
): SubscriptionSyncUpdate {
  const update: SubscriptionSyncUpdate = {};

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const resolvedPlanKey = resolvePlanKeyFromPriceId(priceId);
  if (resolvedPlanKey && resolvedPlanKey !== current.plan_key) {
    update.plan_key = resolvedPlanKey;
  }

  const resolvedStatus = mapStripeSubscriptionStatus(subscription.status);
  if (resolvedStatus && resolvedStatus !== current.subscription_status) {
    update.subscription_status = resolvedStatus;
  }

  return update;
}
