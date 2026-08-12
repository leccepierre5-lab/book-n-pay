// src/lib/refunds.ts fige la règle "les frais de gestion Book'nPay ne sont
// jamais remboursés" — un refund Stripe sans `amount` explicite rembourse par
// défaut la totalité du PaymentIntent (deposit + frais de gestion, un seul
// PaymentIntent par paiement). Ce helper est la seule source du montant
// passé à stripe.refunds.create dans les 4 flux de remboursement
// (annulation client, geste commercial pro, expiration de groupe, gel
// d'établissement) — une régression ici referait fuiter la rémunération
// Book'nPay sur chaque remboursement.
import { describe, it, expect, vi } from 'vitest';
import { depositRefundAmountCents, proCancellationRefundAmountCents, reverseConnectedAccountTransfer } from '@/lib/refunds';

describe('depositRefundAmountCents', () => {
  it('convertit le dépôt en centimes', () => {
    expect(depositRefundAmountCents(18)).toBe(1800);
  });

  it('arrondit au centime (évite les artefacts de flottants)', () => {
    expect(depositRefundAmountCents(9.999)).toBe(1000);
  });

  it('deposit null → 0 (jamais de remboursement par défaut à 100%)', () => {
    expect(depositRefundAmountCents(null)).toBe(0);
  });

  it('deposit undefined → 0', () => {
    expect(depositRefundAmountCents(undefined)).toBe(0);
  });

  it('deposit 0 → 0', () => {
    expect(depositRefundAmountCents(0)).toBe(0);
  });
});

// Annulation PRO (C15) : remboursement INTÉGRAL client (dépôt + frais de
// gestion), refacturés au pro en contrepartie (pro_charges) — seule cette
// fonction diffère de depositRefundAmountCents, ne pas les refusionner.
describe('proCancellationRefundAmountCents', () => {
  it('additionne dépôt et frais de gestion en centimes', () => {
    expect(proCancellationRefundAmountCents(15, 1.99)).toBe(1699);
  });

  it('frais de gestion null → dépôt seul (montant inconnu, jamais inventé)', () => {
    expect(proCancellationRefundAmountCents(15, null)).toBe(1500);
  });

  it('frais de gestion undefined → dépôt seul', () => {
    expect(proCancellationRefundAmountCents(15, undefined)).toBe(1500);
  });

  it('dépôt et frais de gestion null → 0', () => {
    expect(proCancellationRefundAmountCents(null, null)).toBe(0);
  });

  it('arrondit chaque part au centime (évite les artefacts de flottants)', () => {
    expect(proCancellationRefundAmountCents(9.999, 1.999)).toBe(1200);
  });
});

// Bug critique corrigé : sur un remboursement PARTIEL (dépôt seul, frais de
// gestion conservés — bookings/cancel, refund-gesture, freeze-business),
// `reverse_transfer` sur stripe.refunds.create ne récupère qu'une fraction
// proportionnelle du transfert (ratio remboursé/charge totale, toujours <100%
// puisque la charge inclut aussi les frais de gestion) — d'où cet appel
// SÉPARÉ à l'API Transfer Reversals pour un montant exact. Seule EXCEPTION :
// C15 (pro/cancel-booking) rembourse 100% de la charge, `reverse_transfer`
// natif suffit là-bas et n'appelle jamais ce helper (voir
// pro-cancel-booking-route.test.ts).
describe('reverseConnectedAccountTransfer', () => {
  function makeStripe(overrides: Partial<Record<'retrieve' | 'createReversal', any>> = {}) {
    return {
      paymentIntents: {
        retrieve: overrides.retrieve ?? vi.fn(async () => ({ latest_charge: { transfer: 'tr_123' } })),
      },
      transfers: {
        createReversal: overrides.createReversal ?? vi.fn(async () => ({ id: 'trr_123' })),
      },
    } as any;
  }

  it('cas nominal : réversal créée avec le montant exact demandé', async () => {
    const createReversal = vi.fn(async () => ({ id: 'trr_123' }));
    const stripe = makeStripe({ createReversal });

    const result = await reverseConnectedAccountTransfer(stripe, 'pi_123', 1000, 'Test');

    expect(result).toEqual({ done: true });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123', { expand: ['latest_charge'] });
    expect(createReversal).toHaveBeenCalledWith('tr_123', { amount: 1000 });
  });

  it('paymentIntentId absent → aucun appel Stripe, pas une erreur', async () => {
    const stripe = makeStripe();
    const result = await reverseConnectedAccountTransfer(stripe, null, 1000, 'Test');

    expect(result).toEqual({ done: false });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('montant à 0 → aucun appel Stripe (rien à récupérer)', async () => {
    const stripe = makeStripe();
    const result = await reverseConnectedAccountTransfer(stripe, 'pi_123', 0, 'Test');

    expect(result).toEqual({ done: false });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('pas de transfert à l\'origine (fixture sans compte Connect en mode test) → done:false, pas une erreur', async () => {
    const stripe = makeStripe({ retrieve: vi.fn(async () => ({ latest_charge: { transfer: null } })) });
    const result = await reverseConnectedAccountTransfer(stripe, 'pi_123', 1000, 'Test');

    expect(result).toEqual({ done: false });
    expect(result.error).toBeUndefined();
  });

  it('transfert déjà entièrement réversé (erreur Stripe) → done:false + message, jamais une exception qui remonte', async () => {
    const stripe = makeStripe({
      createReversal: vi.fn(async () => { throw new Error('This transfer has already been fully reversed.'); }),
    });

    const result = await reverseConnectedAccountTransfer(stripe, 'pi_123', 1000, 'Test');

    expect(result.done).toBe(false);
    expect(result.error).toBe('This transfer has already been fully reversed.');
  });

  it('montant demandé supérieur au reste disponible sur le transfert → done:false + message', async () => {
    const stripe = makeStripe({
      createReversal: vi.fn(async () => { throw new Error('Refund amount exceeds unreversed transfer amount.'); }),
    });

    const result = await reverseConnectedAccountTransfer(stripe, 'pi_123', 5000, 'Test');

    expect(result.done).toBe(false);
    expect(result.error).toContain('exceeds');
  });
});
