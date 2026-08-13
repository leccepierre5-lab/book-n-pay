// src/lib/stripe/pro-charge-billing.ts
// Facturation effective des pro_charges (frais de gestion refacturés au pro
// suite à ses propres annulations, migration 0041) — jusqu'ici créées mais
// jamais facturées (dette signalée dans ProDashboard.tsx le 11/08).
//
// Principe : JAMAIS de prélèvement immédiat (off_session). Un invoice item
// est posé EN ATTENTE sur le customer Stripe du pro ; Stripe l'attache
// automatiquement à SA PROCHAINE facture (renouvellement d'abonnement
// normal) — exactement ce que l'email envoyé à la création de la charge
// promet déjà ("sur une prochaine facture", pro/cancel-booking/route.ts —
// formulation volontairement non déterministe depuis le 13/08 : une charge
// créée entre la génération et le paiement d'une facture glisse au cycle
// suivant, "votre" laissait croire à une garantie de délai qu'on ne tient
// pas toujours).
// Le pro voit la ligne apparaître sur la facture qu'il attend déjà, jamais
// un débit séparé surprise.
//
// Différence assumée avec l'ancien invoiceUnpaidOverageCharges (LOT 2,
// supprimé) : celui-ci tentait un PaymentIntent off_session immédiat avant
// de regrouper les impayés — interdit ici par design (voir règle ci-dessus).
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

// Garde défensive, jamais atteinte aujourd'hui : calcFraisGestion (seule
// source de montant pour 'management_fee_pro_cancellation') a un plancher
// de 1,99€, toujours au-dessus. Coûte rien à écrire, protège si un futur
// `type` de pro_charges introduit des montants plus petits — vérifié
// (13/08) que les frais Stripe réels (0,4% facturation + 1,5%+0,25€ carte
// EEE) restent très inférieurs au montant sur la plage actuelle (~12-15%
// du montant, jamais la totalité), donc pas de seuil plus haut nécessaire.
export const PRO_CHARGE_MIN_AMOUNT_CENTS = 100;

// Appelée juste après l'insertion réussie d'une pro_charges 'pending'
// (pro/cancel-booking/route.ts). N'échoue jamais bruyamment vers l'appelant
// — best-effort avec alerte admin, même logique que le reste de cette route
// (l'annulation et le remboursement client sont déjà actés avant cet appel).
export async function attachProChargeToNextInvoice(
  stripe: Stripe,
  supabase: SupabaseClient,
  chargeId: string,
  bizId: string,
  amountCents: number
): Promise<void> {
  // Fonction ENTIÈREMENT best-effort — appelée depuis pro/cancel-booking
  // juste après l'insertion réussie de la charge (déjà actée), ne doit
  // JAMAIS lever d'exception vers l'appelant : une erreur ici serait sinon
  // à tort attribuée à "insertion pro_charges échouée" par l'appelant (bug
  // trouvé aux tests le 13/08 — la lecture business_settings n'était pas
  // couverte par le try/catch, seul l'appel Stripe l'était).
  try {
    if (amountCents < PRO_CHARGE_MIN_AMOUNT_CENTS) {
      await supabase
        .from('pro_charges')
        .update({
          status: 'waived',
          waived_at: new Date().toISOString(),
          waived_by: null, // NULL = automatique (système), voir migration 0050
          waived_reason: `Montant sous le seuil minimum de facturation (${(amountCents / 100).toFixed(2)}€ < ${(PRO_CHARGE_MIN_AMOUNT_CENTS / 100).toFixed(2)}€) — frais Stripe non couverts.`,
        })
        .eq('id', chargeId);
      return;
    }

    const { data: settings } = await supabase
      .from('business_settings')
      .select('stripe_customer_id')
      .eq('biz_id', bizId)
      .maybeSingle();

    if (!settings?.stripe_customer_id) {
      // Pas de moyen de facturation connu (pro pas encore passé par
      // setup-billing) — reste 'pending'. Rattrapé soit dès que le pro
      // configure sa facturation (prochain appel de cette fonction, aucun
      // point d'ancrage automatique aujourd'hui), soit à la résiliation
      // (invoicePendingChargesOnCancellation, qui retente aussi). Pas une
      // erreur en soi, juste loggé.
      console.warn(`[ProChargeBilling] Pas de stripe_customer_id — biz ${bizId}, charge ${chargeId}, reste pending`);
      return;
    }

    const item = await stripe.invoiceItems.create(
      {
        customer: settings.stripe_customer_id,
        amount: amountCents,
        currency: 'eur',
        description: 'Frais de gestion — annulation de réservation par le professionnel',
      },
      { idempotencyKey: `pro-charge-ii-${chargeId}` }
    );
    await supabase.from('pro_charges').update({ stripe_invoice_item_id: item.id }).eq('id', chargeId);
  } catch (e: any) {
    console.error(`[ProChargeBilling] Rattachement à la prochaine facture échoué — biz ${bizId}, charge ${chargeId}:`, e.message);
    await notifyAdminOnFailure('pro-charge-billing:invoice-item', {
      processed: 0,
      failed: 1,
      failedItems: [chargeId],
      failedDescriptions: [`charge ${chargeId} (biz ${bizId}, ${(amountCents / 100).toFixed(2)}€) — ${e.message}`],
    });
    // Reste 'pending' — idempotencyKey stable, un futur appel avec le même
    // chargeId retentera proprement sans jamais créer de doublon.
  }
}

// Appelée depuis invoice.payment_succeeded (stripe/webhook/route.ts), que
// la facture soit celle de l'abonnement normal OU la facture autonome créée
// à la résiliation (invoicePendingChargesOnCancellation) — même logique de
// rapprochement dans les deux cas : une ligne de facture dont
// `invoice_item` correspond au stripe_invoice_item_id d'une charge encore
// pending = cette charge vient d'être payée. Idempotent par construction
// (WHERE status='pending' — un rejeu du même événement ne refait rien sur
// des charges déjà passées 'invoiced').
export async function reconcileProChargesFromInvoice(
  supabase: SupabaseClient,
  bizId: string,
  invoice: Stripe.Invoice
): Promise<void> {
  const { data: pendingCharges } = await supabase
    .from('pro_charges')
    .select('id, stripe_invoice_item_id')
    .eq('biz_id', bizId)
    .eq('status', 'pending')
    .not('stripe_invoice_item_id', 'is', null);

  if (!pendingCharges || pendingCharges.length === 0) return;

  const invoiceItemIds = new Set(
    (invoice.lines?.data ?? [])
      .map((l) => (l as unknown as { invoice_item?: string }).invoice_item)
      .filter((id): id is string => !!id)
  );
  if (invoiceItemIds.size === 0) return;

  const matched = pendingCharges.filter((c) => c.stripe_invoice_item_id && invoiceItemIds.has(c.stripe_invoice_item_id));
  if (matched.length === 0) return;

  await supabase
    .from('pro_charges')
    .update({ status: 'invoiced', invoiced_at: new Date().toISOString(), stripe_invoice_id: invoice.id })
    .in('id', matched.map((c) => c.id));

  console.log(`[ProChargeBilling] ${matched.length} charge(s) facturée(s) — biz ${bizId}, invoice ${invoice.id}`);
}

// Appelée depuis customer.subscription.deleted (résiliation) — bascule les
// charges encore pending sur une facture AUTONOME (il n'y aura plus de
// prochaine facture d'abonnement à laquelle les attacher), avec
// collection_method='send_invoice' — JAMAIS 'charge_automatically' : le pro
// reçoit la facture par email et a 14 jours avant tout prélèvement, même
// principe "prévenir avant" que le chemin normal. Idempotence :
// idempotencyKey dérivée de l'id de l'événement webhook — un rejeu du même
// événement ne crée jamais une 2e facture.
export async function invoicePendingChargesOnCancellation(
  stripe: Stripe,
  supabase: SupabaseClient,
  bizId: string,
  eventId: string
): Promise<void> {
  const { data: pending } = await supabase
    .from('pro_charges')
    .select('id, amount_cents, stripe_invoice_item_id')
    .eq('biz_id', bizId)
    .eq('status', 'pending');

  if (!pending || pending.length === 0) return;

  const { data: settings } = await supabase
    .from('business_settings')
    .select('stripe_customer_id')
    .eq('biz_id', bizId)
    .maybeSingle();

  if (!settings?.stripe_customer_id) {
    // Cas résiduel documenté (audit 13/08) : aucun chemin automatique ne
    // peut facturer un pro sans customer Stripe connu. Reste 'pending',
    // traitement manuel requis (waived ou facturation hors Stripe) —
    // c'est aussi ce qui bloquerait une suppression de compte pour ce
    // business tant que ce n'est pas résolu à la main.
    await notifyAdminOnFailure('pro-charge-billing:cancellation-no-customer', {
      processed: 0,
      failed: pending.length,
      failedItems: pending.map((c) => c.id),
      failedDescriptions: [
        `biz ${bizId} — abonnement résilié, ${pending.length} charge(s) pending sans stripe_customer_id, aucune facturation automatique possible — traitement manuel requis`,
      ],
    });
    return;
  }

  // Rattrape les charges qui n'ont jamais eu d'invoice item (cas résiduel :
  // stripe_customer_id absent au moment de l'annulation initiale).
  for (const charge of pending) {
    if (!charge.stripe_invoice_item_id) {
      await attachProChargeToNextInvoice(stripe, supabase, charge.id, bizId, charge.amount_cents);
    }
  }

  try {
    await stripe.invoices.create(
      {
        customer: settings.stripe_customer_id,
        collection_method: 'send_invoice',
        days_until_due: 14,
        auto_advance: true,
      },
      { idempotencyKey: `pro-charges-final-invoice-${eventId}` }
    );
    console.log(`[ProChargeBilling] Facture autonome créée (résiliation) — biz ${bizId}, ${pending.length} charge(s)`);
  } catch (e: any) {
    console.error(`[ProChargeBilling] Facture autonome de résiliation échouée — biz ${bizId}:`, e.message);
    await notifyAdminOnFailure('pro-charge-billing:cancellation-invoice', {
      processed: 0,
      failed: 1,
      failedItems: [bizId],
      failedDescriptions: [`biz ${bizId} — création facture autonome de résiliation échouée — ${e.message}`],
    });
  }
}
