// src/lib/stripe-requirements.ts
// Bloc C — Stripe met à jour ses exigences KYC 2026 pour les comptes
// européens ayant card_payments. Chaque compte Express est contacté
// directement par Stripe (rien à collecter côté plateforme), mais chaque
// pro a une échéance individuelle avant le 31/10/2026, au-delà de laquelle
// ses payouts sont suspendus. Logique pure ici (mapping webhook + niveau du
// bandeau dashboard), testable sans mocker Stripe ni Supabase — le webhook
// (stripe/webhook/route.ts) et le composant ProDashboard ne font
// qu'appeler ces fonctions.
import type Stripe from 'stripe';

export interface StripeRequirementsUpdate {
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_disabled_reason: string | null;
  stripe_currently_due: string[];
  stripe_past_due: string[];
  stripe_current_deadline: string | null;
  stripe_future_due: string[];
  stripe_future_deadline: string | null;
  stripe_requirements_synced_at: string;
}

function unixToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

// `future_requirements` est absent du payload tant que Stripe n'a pas
// encore d'exigence à venir pour ce compte — traité comme "rien à venir"
// (tableaux vides, deadline null), jamais une erreur.
export function mapAccountRequirements(account: Stripe.Account, now: Date = new Date()): StripeRequirementsUpdate {
  const req = account.requirements;
  const future = account.future_requirements;
  return {
    stripe_charges_enabled: !!account.charges_enabled,
    stripe_payouts_enabled: !!account.payouts_enabled,
    stripe_disabled_reason: req?.disabled_reason ?? null,
    stripe_currently_due: req?.currently_due ?? [],
    stripe_past_due: req?.past_due ?? [],
    stripe_current_deadline: unixToIso(req?.current_deadline),
    stripe_future_due: future?.currently_due ?? [],
    stripe_future_deadline: unixToIso(future?.current_deadline),
    stripe_requirements_synced_at: now.toISOString(),
  };
}

export type StripeRequirementsBannerLevel = 'red' | 'orange' | 'blue' | null;

const DEADLINE_SOON_MS = 14 * 24 * 3600 * 1000;

export interface StripeRequirementsBannerInput {
  payoutsEnabled: boolean | null;
  pastDue: string[] | null;
  currentDeadline: string | null;
  futureDeadline: string | null;
}

// Rouge > orange > bleu, dans cet ordre — un compte avec payouts déjà
// suspendus reste rouge même si son échéance actuelle a aussi une deadline
// proche (le pire état prime, jamais un mélange).
export function getStripeRequirementsBannerLevel(
  input: StripeRequirementsBannerInput,
  now: Date = new Date()
): StripeRequirementsBannerLevel {
  if (input.payoutsEnabled === false) return 'red';

  const pastDue = input.pastDue ?? [];
  const deadlineSoon = !!input.currentDeadline
    && new Date(input.currentDeadline).getTime() - now.getTime() <= DEADLINE_SOON_MS;
  if (pastDue.length > 0 || deadlineSoon) return 'orange';

  if (input.futureDeadline) return 'blue';

  return null;
}
