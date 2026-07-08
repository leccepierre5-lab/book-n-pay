// src/lib/stripe/overageCharge.ts
// Logique de facturation hors-forfait (voir supabase/migrations/0020_overage_charges.sql).
// Utilisée depuis le webhook (tentative immédiate) et le cron
// retry-overage-charges (tentative à +24h).
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOverageStatus } from '@/lib/booking-utils';
import { OVERAGE_FEE_HT, type PlanKey } from '@/lib/plans-config';

export interface OverageChargeRow {
  id: string;
  biz_id: string;
  booking_id: string | null;
  amount_ht: number;
  status: string;
  attempt_count: number;
}

// ⚠️ Le customer/payment method d'un pro sont créés via /api/pro/setup-billing,
// qui respecte déjà app_config.mode_test_paiement — on doit construire le
// client Stripe de la même façon ici, sinon "No such customer" en prod dès
// que le mode test est actif (le webhook, lui, vérifie les signatures avec
// la clé live et ne peut pas servir pour émettre ces PaymentIntents).
async function getStripeClient(supabase: SupabaseClient): Promise<Stripe> {
  const { data: testModeConfig } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'mode_test_paiement')
    .maybeSingle();
  const isTestMode = testModeConfig?.value === 'true';
  return new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);
}

// Incrémente le compteur mensuel du pro et crée une charge hors-forfait si la
// réservation qui vient d'être payée dépasse le quota + marge de grâce.
// Appelé une fois par réservation confirmée (webhook checkout.session.completed).
export async function maybeCreateOverageCharge(
  supabase: SupabaseClient,
  bizId: string,
  bookingId: string
): Promise<void> {
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc('increment_booking_count', { p_biz_id: bizId })
    .single();

  if (rpcError || !rpcResult) {
    console.error('[overageCharge] increment_booking_count a échoué:', rpcError?.message);
    return;
  }

  const { new_count, plan_key } = rpcResult as { new_count: number; plan_key: PlanKey };
  const overage = getOverageStatus(new_count, plan_key);
  if (overage.status !== 'overage') return;

  const { data: charge, error: insertError } = await supabase
    .from('overage_charges')
    .insert({ biz_id: bizId, booking_id: bookingId, amount_ht: OVERAGE_FEE_HT, status: 'pending' })
    .select()
    .single();

  if (insertError || !charge) {
    console.error('[overageCharge] Création de la charge échouée:', insertError?.message);
    return;
  }

  console.log(`[overageCharge] Dépassement quota — biz ${bizId}, réservation ${bookingId} (${new_count}e du mois)`);
  await attemptOverageCharge(supabase, charge as OverageChargeRow);
}

// Tente de débiter le moyen de paiement enregistré du pro pour une charge
// donnée. Utilisée à la fois pour la tentative immédiate (webhook) et pour
// le retry à +24h (cron). Une seule charge en échec passe de pending →
// retry_scheduled, puis retry_scheduled → failed (pas de 3e tentative — le
// solde sera regroupé dans la facture du mois suivant, voir invoiceUnpaidOverageCharges).
export async function attemptOverageCharge(
  supabase: SupabaseClient,
  charge: OverageChargeRow
): Promise<'paid' | 'retry_scheduled' | 'failed'> {
  const nextAttemptCount = charge.attempt_count + 1;

  const { data: settings } = await supabase
    .from('business_settings')
    .select('stripe_customer_id, stripe_payment_method_id')
    .eq('biz_id', charge.biz_id)
    .maybeSingle();

  if (!settings?.stripe_customer_id || !settings?.stripe_payment_method_id) {
    console.error(`[overageCharge] Pas de moyen de paiement enregistré — biz ${charge.biz_id}, charge ${charge.id}`);
    await supabase
      .from('overage_charges')
      .update({ status: 'failed', attempt_count: nextAttemptCount })
      .eq('id', charge.id);
    return 'failed';
  }

  const stripe = await getStripeClient(supabase);

  // Idempotence Stripe : clé stable sur (booking_id, tentative). Protège le
  // débit lui-même si cette fonction est invoquée deux fois pour la même
  // tentative (cron retry-overage-charges déclenché deux fois, chevauchement
  // avec un webhook, etc.) — Stripe renvoie alors le PaymentIntent déjà créé
  // au lieu d'en émettre un 2e. Scopée par attempt_count (pas juste
  // charge.id) pour qu'un VRAI retry à +24h après un échec (nextAttemptCount
  // différent) obtienne bien un nouveau PaymentIntent, pas celui, raté, de la
  // tentative précédente. Fallback sur charge.id si booking_id est absent
  // (nullable en base) pour rester unique dans tous les cas.
  const idempotencyKey = `overage-charge-${charge.booking_id ?? charge.id}-attempt-${nextAttemptCount}`;

  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(charge.amount_ht * 100),
      currency: 'eur',
      customer: settings.stripe_customer_id,
      payment_method: settings.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: { overageChargeId: charge.id, bizId: charge.biz_id },
    }, { idempotencyKey });

    await supabase
      .from('overage_charges')
      .update({
        status: 'paid',
        attempt_count: nextAttemptCount,
        charged_at: new Date().toISOString(),
        stripe_payment_intent_id: pi.id,
      })
      .eq('id', charge.id);

    console.log(`[overageCharge] ✅ Payée — biz ${charge.biz_id}, charge ${charge.id}, PI ${pi.id}`);
    return 'paid';
  } catch (err: any) {
    const nextStatus = charge.status === 'pending' ? 'retry_scheduled' : 'failed';
    const nextRetryAt = nextStatus === 'retry_scheduled'
      ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      : null;

    await supabase
      .from('overage_charges')
      .update({ status: nextStatus, attempt_count: nextAttemptCount, next_retry_at: nextRetryAt })
      .eq('id', charge.id);

    console.warn(`[overageCharge] Échec (${nextStatus}) — biz ${charge.biz_id}, charge ${charge.id}: ${err.message}`);
    return nextStatus;
  }
}

// Regroupe les charges hors-forfait impayées (retry_scheduled ou failed) d'un
// pro dans une Facture Stripe séparée, déclenché au renouvellement mensuel
// de l'abonnement (webhook invoice.payment_succeeded sur la subscription).
export async function invoiceUnpaidOverageCharges(supabase: SupabaseClient, bizId: string): Promise<void> {
  const { data: unpaidCharges } = await supabase
    .from('overage_charges')
    .select('id, amount_ht')
    .eq('biz_id', bizId)
    .in('status', ['retry_scheduled', 'failed']);

  if (!unpaidCharges || unpaidCharges.length === 0) return;

  const { data: settings } = await supabase
    .from('business_settings')
    .select('stripe_customer_id')
    .eq('biz_id', bizId)
    .maybeSingle();

  if (!settings?.stripe_customer_id) {
    console.error(`[overageCharge] Regroupement impossible, pas de customer Stripe — biz ${bizId}`);
    return;
  }

  const stripe = await getStripeClient(supabase);
  const customerId = settings.stripe_customer_id;

  try {
    for (const charge of unpaidCharges) {
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: Math.round(charge.amount_ht * 100),
        currency: 'eur',
        description: 'Dépassement quota réservations Book\'nPay',
      });
    }

    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: true,
    });
    await stripe.invoices.finalizeInvoice(invoice.id!);
    await stripe.invoices.pay(invoice.id!);

    await supabase
      .from('overage_charges')
      .update({ status: 'invoiced', stripe_invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
      .in('id', unpaidCharges.map((c) => c.id));

    console.log(`[overageCharge] ✅ ${unpaidCharges.length} charge(s) regroupée(s) — biz ${bizId}, facture ${invoice.id}`);
  } catch (err: any) {
    console.error(`[overageCharge] Regroupement facture échoué — biz ${bizId}:`, err.message);
  }
}
