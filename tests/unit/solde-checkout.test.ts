// src/lib/solde-checkout.ts pilote le montant du solde encaissé en ligne à la
// clôture d'une prestation (Stripe Connect, mode "App") — une régression ici
// se traduit directement par un montant facturé faux ou par une session
// Stripe dupliquée/perdue, sans qu'aucun test d'intégration Stripe ne
// l'attrape (ce sont des décisions pures, prises avant tout appel réseau).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  computeSolde,
  isProAuthorizedForBiz,
  checkMemberEligibleForSoldeCheckout,
  checkSoldeIsPositive,
  isStripeAccountConfigured,
  decideSoldeIdempotency,
} from '@/lib/solde-checkout';

describe('computeSolde', () => {
  it('prestation 60€, deposit 20€ → solde 40€', () => {
    expect(computeSolde(60, 20, 0)).toBe(40);
  });

  it('prestation 60€, deposit 20€, remise parrainage 10% → prixTotal 54€, solde 34€', () => {
    expect(computeSolde(60, 20, 10)).toBe(34);
  });

  it('prestation 60€, deposit 60€ (déjà tout payé) → solde 0', () => {
    expect(computeSolde(60, 60, 0)).toBe(0);
  });

  it('deposit > prix (cas limite absurde) → solde clampé à 0, jamais négatif', () => {
    expect(computeSolde(60, 90, 0)).toBe(0);
  });

  it('arrondit au centime (évite les artefacts de flottants)', () => {
    expect(computeSolde(33.33, 11.11, 0)).toBe(22.22);
  });
});

describe('isProAuthorizedForBiz', () => {
  it('pro du bon biz_id → autorisé', () => {
    expect(isProAuthorizedForBiz({ role: 'pro', biz_id: 'biz-1' }, 'biz-1')).toBe(true);
  });

  it('pro d\'un autre biz_id → refusé', () => {
    expect(isProAuthorizedForBiz({ role: 'pro', biz_id: 'biz-2' }, 'biz-1')).toBe(false);
  });

  it('admin sur n\'importe quel biz_id → autorisé', () => {
    expect(isProAuthorizedForBiz({ role: 'admin', biz_id: 'biz-2' }, 'biz-1')).toBe(true);
  });

  it('profil absent (auth échouée en amont) → refusé', () => {
    expect(isProAuthorizedForBiz(null, 'biz-1')).toBe(false);
  });
});

describe('checkMemberEligibleForSoldeCheckout', () => {
  it('membre au statut paid, jamais tenté → éligible', () => {
    const r = checkMemberEligibleForSoldeCheckout({ status: 'paid', balance_payment_status: 'none' });
    expect(r.ok).toBe(true);
  });

  it('membre pas encore payé (invite) → 400', () => {
    const r = checkMemberEligibleForSoldeCheckout({ status: 'invite', balance_payment_status: 'none' });
    expect(r).toEqual({ ok: false, error: "Cette prestation n'est pas en attente de clôture", status: 400 });
  });

  it('membre déjà arrivé → 400 (pas au statut paid)', () => {
    const r = checkMemberEligibleForSoldeCheckout({ status: 'arrived', balance_payment_status: 'paid' });
    expect(r.ok).toBe(false);
  });

  it('solde déjà réglé en ligne (balance_payment_status=paid) → 409', () => {
    const r = checkMemberEligibleForSoldeCheckout({ status: 'paid', balance_payment_status: 'paid' });
    expect(r).toEqual({ ok: false, error: 'Le solde a déjà été réglé', status: 409 });
  });
});

describe('checkSoldeIsPositive', () => {
  it('solde > 0 → ok', () => {
    expect(checkSoldeIsPositive(40).ok).toBe(true);
  });

  it('solde = 0 (prestation déjà couverte) → rejet propre 400', () => {
    const r = checkSoldeIsPositive(0);
    expect(r).toEqual({
      ok: false,
      error: 'Aucun solde à régler — clôture directement en espèces/TPE',
      status: 400,
    });
  });
});

describe('isStripeAccountConfigured', () => {
  it('compte Connect présent et onboarding complet → ok', () => {
    expect(isStripeAccountConfigured({ stripe_account_id: 'acct_123', stripe_onboarding_complete: true })).toBe(true);
  });

  it('stripe_account_id absent → refusé', () => {
    expect(isStripeAccountConfigured({ stripe_account_id: null, stripe_onboarding_complete: true })).toBe(false);
  });

  it('onboarding pas terminé → refusé même avec un stripe_account_id', () => {
    expect(isStripeAccountConfigured({ stripe_account_id: 'acct_123', stripe_onboarding_complete: false })).toBe(false);
  });

  it('settings absents (business_settings jamais créé) → refusé', () => {
    expect(isStripeAccountConfigured(null)).toBe(false);
  });
});

describe('decideSoldeIdempotency', () => {
  it('aucune session existante → régénère', () => {
    expect(decideSoldeIdempotency(null)).toEqual({ action: 'regenerate' });
  });

  it('session encore open → réutilise la même URL, ne crée rien', () => {
    const r = decideSoldeIdempotency({ status: 'open', url: 'https://checkout.stripe.com/xyz', id: 'cs_123' });
    expect(r).toEqual({ action: 'reuse', url: 'https://checkout.stripe.com/xyz', sessionId: 'cs_123' });
  });

  it('session expirée → régénère', () => {
    const r = decideSoldeIdempotency({ status: 'expired', url: null, id: 'cs_123' });
    expect(r).toEqual({ action: 'regenerate' });
  });

  it('session déjà complete (paiement encaissé, webhook pas encore passé) → pendingConfirmation, aucune nouvelle session', () => {
    const r = decideSoldeIdempotency({ status: 'complete', url: null, id: 'cs_123' });
    expect(r).toEqual({ action: 'pendingConfirmation' });
  });

  it('session open mais sans url (cas Stripe dégradé) → traité comme à régénérer, pas de réutilisation d\'une URL absente', () => {
    const r = decideSoldeIdempotency({ status: 'open', url: null, id: 'cs_123' });
    expect(r).toEqual({ action: 'regenerate' });
  });
});

// ── Anti-triche : garde de non-régression sur la surface d'entrée de la route ──
// Les fonctions ci-dessus n'acceptent structurellement aucun montant en
// paramètre (voir les signatures) — impossible pour un `amount` client d'y
// entrer. Ce test fige en plus le contrat au niveau de la route elle-même :
// le body de la requête n'est jamais destructuré au-delà de bookingId/memberId,
// et le montant Stripe (`unit_amount`) est systématiquement dérivé de
// `computeSolde(...)`, jamais d'une valeur lue depuis `req.json()`. Un futur
// changement qui réintroduirait un `amount` client ferait échouer ce test.
describe('route solde-checkout — surface anti-triche (garde de non-régression)', () => {
  const routeSource = readFileSync(
    fileURLToPath(new URL('../../src/app/api/bookings/solde-checkout/route.ts', import.meta.url)),
    'utf-8'
  );
  // Code exécutable uniquement — les commentaires ont le droit de PARLER
  // d'amount (pour expliquer qu'il est ignoré) sans que ça compte comme une
  // utilisation réelle du paramètre.
  const codeOnly = routeSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('ne destructure du body que bookingId et memberId — jamais amount', () => {
    expect(routeSource).toMatch(/const\s*\{\s*bookingId,\s*memberId\s*\}\s*=\s*await req\.json\(\)/);
    expect(codeOnly).not.toMatch(/\bamount\b/);
  });

  it('le unit_amount Stripe est dérivé de computeSolde(...), pas d\'une variable issue du body', () => {
    expect(routeSource).toMatch(/unit_amount:\s*Math\.round\(solde \* 100\)/);
    expect(routeSource).toMatch(/const solde = computeSolde\(/);
  });
});
