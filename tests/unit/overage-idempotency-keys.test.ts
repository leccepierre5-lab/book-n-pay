// buildOverageChargeIdempotencyKey / buildOverageInvoiceIdempotencyKey
// (src/lib/stripe/overageCharge.ts) construisent les clés d'idempotence
// Stripe qui protègent respectivement le débit unitaire (anti-double-débit)
// et le regroupement en facture (anti-double-facture) contre un rejeu de
// webhook. Un changement silencieux de format ici (ex: perte du tri des
// chargeIds, mauvais fallback) désactive la protection sans qu'aucune
// erreur ne se déclenche — critique au même titre que getOverageStatus.
import { describe, it, expect } from 'vitest';
import {
  buildOverageChargeIdempotencyKey,
  buildOverageInvoiceIdempotencyKey,
} from '@/lib/stripe/overageCharge';

describe('buildOverageChargeIdempotencyKey', () => {
  it('utilise booking_id quand présent', () => {
    expect(buildOverageChargeIdempotencyKey('booking-1', 'charge-1', 1)).toBe(
      'overage-charge-booking-1-attempt-1'
    );
  });

  it('retombe sur chargeId quand booking_id est null (fallback documenté)', () => {
    expect(buildOverageChargeIdempotencyKey(null, 'charge-1', 1)).toBe(
      'overage-charge-charge-1-attempt-1'
    );
  });

  it('deux tentatives différentes (attemptCount) produisent des clés différentes', () => {
    const k1 = buildOverageChargeIdempotencyKey('booking-1', 'charge-1', 1);
    const k2 = buildOverageChargeIdempotencyKey('booking-1', 'charge-1', 2);
    expect(k1).not.toBe(k2);
  });

  it('même booking_id + même attemptCount → même clé (idempotence garantie)', () => {
    const k1 = buildOverageChargeIdempotencyKey('booking-1', 'charge-1', 1);
    const k2 = buildOverageChargeIdempotencyKey('booking-1', 'charge-1', 1);
    expect(k1).toBe(k2);
  });
});

describe('buildOverageInvoiceIdempotencyKey', () => {
  it('construit la clé à partir de bizId + chargeIds', () => {
    expect(buildOverageInvoiceIdempotencyKey('biz-1', ['charge-a', 'charge-b'])).toBe(
      'overage-invoice-biz-1-charge-a-charge-b'
    );
  });

  it('trie les chargeIds — un lot dans un ordre différent produit la MÊME clé (essentiel pour l\'idempotence sur rejeu)', () => {
    const k1 = buildOverageInvoiceIdempotencyKey('biz-1', ['charge-b', 'charge-a']);
    const k2 = buildOverageInvoiceIdempotencyKey('biz-1', ['charge-a', 'charge-b']);
    expect(k1).toBe(k2);
  });

  it('un lot de charges différent produit une clé différente (pas de collision entre deux facturations distinctes)', () => {
    const k1 = buildOverageInvoiceIdempotencyKey('biz-1', ['charge-a']);
    const k2 = buildOverageInvoiceIdempotencyKey('biz-1', ['charge-a', 'charge-b']);
    expect(k1).not.toBe(k2);
  });

  it('deux business différents avec les mêmes chargeIds ne collisionnent jamais', () => {
    const k1 = buildOverageInvoiceIdempotencyKey('biz-1', ['charge-a']);
    const k2 = buildOverageInvoiceIdempotencyKey('biz-2', ['charge-a']);
    expect(k1).not.toBe(k2);
  });

  it('ne mute pas le tableau chargeIds passé en argument (pas d\'effet de bord)', () => {
    const chargeIds = ['charge-b', 'charge-a'];
    buildOverageInvoiceIdempotencyKey('biz-1', chargeIds);
    expect(chargeIds).toEqual(['charge-b', 'charge-a']);
  });
});
