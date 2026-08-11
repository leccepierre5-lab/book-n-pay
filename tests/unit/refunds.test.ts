// src/lib/refunds.ts fige la règle "les frais de gestion Book'nPay ne sont
// jamais remboursés" — un refund Stripe sans `amount` explicite rembourse par
// défaut la totalité du PaymentIntent (deposit + frais de gestion, un seul
// PaymentIntent par paiement). Ce helper est la seule source du montant
// passé à stripe.refunds.create dans les 4 flux de remboursement
// (annulation client, geste commercial pro, expiration de groupe, gel
// d'établissement) — une régression ici referait fuiter la rémunération
// Book'nPay sur chaque remboursement.
import { describe, it, expect } from 'vitest';
import { depositRefundAmountCents, proCancellationRefundAmountCents } from '@/lib/refunds';

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
