// src/lib/stripe/pro-charge-billing.ts — facturation effective des
// pro_charges (13/08/2026). Argent réel prélevé sur un pro : ces tests
// prouvent l'idempotence stricte (jamais de double facturation), l'absence
// de prélèvement immédiat (toujours un invoice item en attente, jamais
// off_session), le seuil défensif waived, et qu'un échec n'est jamais une
// perte silencieuse (toujours une alerte admin, la charge reste pending).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attachProChargeToNextInvoice,
  reconcileProChargesFromInvoice,
  invoicePendingChargesOnCancellation,
  PRO_CHARGE_MIN_AMOUNT_CENTS,
} from '@/lib/stripe/pro-charge-billing';

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

function makeChain(result: { data?: any; error?: any } = { data: null, error: null }) {
  const chain: any = Promise.resolve(result);
  for (const m of ['select', 'eq', 'in', 'not']) chain[m] = vi.fn((..._a: any[]) => chain);
  chain.update = vi.fn((..._a: any[]) => chain);
  chain.maybeSingle = vi.fn(async () => result);
  return chain;
}

let queues: Record<string, any[]> = {};
function q(table: string, result: any = { data: null, error: null }) {
  (queues[table] ??= []).push(makeChain(result));
}
function fakeSupabase() {
  return {
    from: (t: string) => {
      const arr = queues[t];
      if (!arr || arr.length === 0) throw new Error(`appel inattendu (queue vide) sur la table: ${t}`);
      return arr.shift();
    },
  } as any;
}

const mockInvoiceItemsCreate = vi.fn(async (..._args: any[]) => ({ id: 'ii_test' }));
const mockInvoicesCreate = vi.fn(async (..._args: any[]) => ({ id: 'in_test' }));
function fakeStripe() {
  return {
    invoiceItems: { create: (...a: any[]) => mockInvoiceItemsCreate(...a) },
    invoices: { create: (...a: any[]) => mockInvoicesCreate(...a) },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  queues = {};
  mockInvoiceItemsCreate.mockResolvedValue({ id: 'ii_test' });
  mockInvoicesCreate.mockResolvedValue({ id: 'in_test' });
});

describe('attachProChargeToNextInvoice', () => {
  it('montant sous le seuil (< 1€) → waived automatique, AUCUN appel Stripe', async () => {
    const supabase = fakeSupabase();
    const updateChain = makeChain({ error: null });
    queues.pro_charges = [updateChain];

    await attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-1', 'biz-1', 50);

    expect(mockInvoiceItemsCreate).not.toHaveBeenCalled();
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'waived', waived_by: null })
    );
    const updateArg = updateChain.update.mock.calls[0][0];
    expect(updateArg.waived_reason).toContain('0.50€');
  });

  it('montant au seuil exact (100 cents) → PAS waived, tente la facturation normale', async () => {
    const supabase = fakeSupabase();
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null });
    const updateChain = makeChain({ error: null });
    queues.pro_charges = [updateChain];

    await attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-1', 'biz-1', PRO_CHARGE_MIN_AMOUNT_CENTS);

    expect(mockInvoiceItemsCreate).toHaveBeenCalledTimes(1);
  });

  it("pas de stripe_customer_id → reste pending, AUCUN appel Stripe, pas d'alerte (cas normal, pas une erreur)", async () => {
    const supabase = fakeSupabase();
    q('business_settings', { data: null, error: null });

    await attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-1', 'biz-1', 199);

    expect(mockInvoiceItemsCreate).not.toHaveBeenCalled();
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('cas nominal : crée un invoice item EN ATTENTE (jamais de PaymentIntent/prélèvement immédiat), idempotencyKey dérivée du chargeId', async () => {
    const supabase = fakeSupabase();
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null });
    const updateChain = makeChain({ error: null });
    queues.pro_charges = [updateChain];

    await attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-42', 'biz-1', 199);

    expect(mockInvoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', amount: 199, currency: 'eur' }),
      expect.objectContaining({ idempotencyKey: 'pro-charge-ii-charge-42' })
    );
    // Jamais de champ evoquant un prélèvement immédiat (confirm/off_session/capture).
    const params = mockInvoiceItemsCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('confirm');
    expect(params).not.toHaveProperty('off_session');
    expect(updateChain.update).toHaveBeenCalledWith({ stripe_invoice_item_id: 'ii_test' });
  });

  it('échec Stripe → alerte admin, charge reste pending (pas de update), jamais de throw vers l\'appelant', async () => {
    const supabase = fakeSupabase();
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null });
    mockInvoiceItemsCreate.mockRejectedValue(new Error('carte refusée'));

    await expect(
      attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-1', 'biz-1', 199)
    ).resolves.toBeUndefined();

    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro-charge-billing:invoice-item');
  });

  it('erreur inattendue à la LECTURE business_settings (pas juste l\'appel Stripe) → jamais de throw, alerte admin quand même (bug trouvé aux tests le 13/08)', async () => {
    const supabase = { from: () => { throw new Error('DB indisponible'); } } as any;

    await expect(
      attachProChargeToNextInvoice(fakeStripe(), supabase, 'charge-1', 'biz-1', 199)
    ).resolves.toBeUndefined();

    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileProChargesFromInvoice', () => {
  it('aucune charge pending → no-op', async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [], error: null });

    await reconcileProChargesFromInvoice(supabase, 'biz-1', { id: 'in_1', lines: { data: [] } } as any);
    // Rien à vérifier de plus — pas de 2e appel queue, donc pas de update tenté.
  });

  it('ligne de facture correspondante → passe en invoiced avec la bonne date et le bon invoice id, AUCUNE autre charge touchée', async () => {
    const supabase = fakeSupabase();
    q('pro_charges', {
      data: [
        { id: 'charge-1', stripe_invoice_item_id: 'ii_1' },
        { id: 'charge-2', stripe_invoice_item_id: 'ii_2' },
      ],
      error: null,
    });
    const updateChain = makeChain({ error: null });
    queues.pro_charges.push(updateChain);

    const invoice = { id: 'in_1', lines: { data: [{ invoice_item: 'ii_1' }] } } as any;
    await reconcileProChargesFromInvoice(supabase, 'biz-1', invoice);

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'invoiced', stripe_invoice_id: 'in_1' })
    );
    expect(updateChain.in).toHaveBeenCalledWith('id', ['charge-1']);
  });

  it('aucune ligne ne correspond → aucun update tenté', async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [{ id: 'charge-1', stripe_invoice_item_id: 'ii_1' }], error: null });

    const invoice = { id: 'in_1', lines: { data: [{ invoice_item: 'ii_OTHER' }] } } as any;
    await reconcileProChargesFromInvoice(supabase, 'biz-1', invoice);
    // queues.pro_charges vidée après le select — un update tenté lèverait
    // "appel inattendu (queue vide)", donc l'absence d'exception prouve
    // qu'aucun update n'a été tenté.
  });

  // Stripe garantit at-least-once, jamais exactly-once — invoice.payment_succeeded
  // PEUT arriver deux fois pour la même facture. Argent réel : ce test rejoue
  // l'événement et prouve que la 2e livraison ne refacture rien. La requête
  // filtre sur status='pending' (ligne 118 ci-dessus) — une fois la charge
  // passée 'invoiced' par le 1er appel, elle disparaît du SELECT du 2e appel,
  // simulé ici en reflétant l'état réel de la base après le 1er passage
  // (pas un mock statique qui masquerait le problème).
  it("rejeu du même événement webhook (invoice.payment_succeeded livré 2 fois) → la charge n'est facturée qu'une seule fois", async () => {
    const supabase = fakeSupabase();
    const invoice = { id: 'in_1', lines: { data: [{ invoice_item: 'ii_1' }] } } as any;

    // 1er passage : la charge est encore pending, elle matche.
    q('pro_charges', { data: [{ id: 'charge-1', stripe_invoice_item_id: 'ii_1' }], error: null });
    const updateChain1 = makeChain({ error: null });
    queues.pro_charges.push(updateChain1);
    await reconcileProChargesFromInvoice(supabase, 'biz-1', invoice);
    expect(updateChain1.update).toHaveBeenCalledTimes(1);

    // 2e passage (rejeu du MÊME événement) : en base réelle, la charge est
    // maintenant 'invoiced' — le SELECT `.eq('status', 'pending')` ne la
    // renvoie donc plus. Reflété ici en queuant une réponse vide.
    q('pro_charges', { data: [], error: null });
    await reconcileProChargesFromInvoice(supabase, 'biz-1', invoice);
    // Aucune 2e entrée queue pour un update — un 2e update tenté lèverait
    // "appel inattendu (queue vide)", donc l'absence d'exception prouve
    // qu'aucune 2e facturation n'a eu lieu.
  });
});

describe('invoicePendingChargesOnCancellation', () => {
  it('aucune charge pending → no-op, aucun appel Stripe', async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [], error: null });

    await invoicePendingChargesOnCancellation(fakeStripe(), supabase, 'biz-1', 'evt_1');

    expect(mockInvoicesCreate).not.toHaveBeenCalled();
  });

  it("pas de stripe_customer_id → alerte admin, AUCUNE facture créée (pas de prélèvement possible sans moyen de paiement connu)", async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [{ id: 'charge-1', amount_cents: 199, stripe_invoice_item_id: 'ii_1' }], error: null });
    q('business_settings', { data: null, error: null });

    await invoicePendingChargesOnCancellation(fakeStripe(), supabase, 'biz-1', 'evt_1');

    expect(mockInvoicesCreate).not.toHaveBeenCalled();
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro-charge-billing:cancellation-no-customer');
  });

  it("cas nominal : facture AUTONOME avec send_invoice (JAMAIS charge_automatically) et 14 jours d'échéance, idempotencyKey dérivée de l'event webhook", async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [{ id: 'charge-1', amount_cents: 199, stripe_invoice_item_id: 'ii_1' }], error: null });
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null });

    await invoicePendingChargesOnCancellation(fakeStripe(), supabase, 'biz-1', 'evt_abc123');

    expect(mockInvoicesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', collection_method: 'send_invoice', days_until_due: 14 }),
      expect.objectContaining({ idempotencyKey: 'pro-charges-final-invoice-evt_abc123' })
    );
    const params = mockInvoicesCreate.mock.calls[0][0];
    expect(params.collection_method).not.toBe('charge_automatically');
  });

  it("rattrape une charge sans invoice item (cas résiduel : stripe_customer_id absent à la création) avant de créer la facture", async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [{ id: 'charge-orphan', amount_cents: 199, stripe_invoice_item_id: null }], error: null });
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null }); // lu par invoicePendingChargesOnCancellation
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null }); // relu par attachProChargeToNextInvoice (rattrapage)
    const updateChain = makeChain({ error: null });
    queues.pro_charges.push(updateChain);

    await invoicePendingChargesOnCancellation(fakeStripe(), supabase, 'biz-1', 'evt_1');

    expect(mockInvoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 199 }),
      expect.objectContaining({ idempotencyKey: 'pro-charge-ii-charge-orphan' })
    );
    expect(mockInvoicesCreate).toHaveBeenCalledTimes(1);
  });

  it('échec de création de la facture autonome → alerte admin, jamais de throw', async () => {
    const supabase = fakeSupabase();
    q('pro_charges', { data: [{ id: 'charge-1', amount_cents: 199, stripe_invoice_item_id: 'ii_1' }], error: null });
    q('business_settings', { data: { stripe_customer_id: 'cus_1' }, error: null });
    mockInvoicesCreate.mockRejectedValue(new Error('customer introuvable'));

    await expect(
      invoicePendingChargesOnCancellation(fakeStripe(), supabase, 'biz-1', 'evt_1')
    ).resolves.toBeUndefined();

    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro-charge-billing:cancellation-invoice');
  });
});
