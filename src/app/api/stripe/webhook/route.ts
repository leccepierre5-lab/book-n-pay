// src/app/api/stripe/webhook/route.ts
// Port de base44/functions/stripeWebhook/entry.ts
//
// ⚠️ Sur Vercel, désactive le bodyParser par défaut via `export const config`
// n'est plus nécessaire avec l'App Router : req.text() lit déjà le body brut,
// ce qui est obligatoire pour la vérification de signature Stripe.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { maybeCreateOverageCharge, invoiceUnpaidOverageCharges } from '@/lib/stripe/overageCharge';
import { notifyProNewBooking } from '@/lib/pro-notifications';

// ⚠️ CORRECTIF (test E2E billing) : sur ce compte Stripe (version d'API
// 2026-05-27.dahlia), invoice.subscription n'est plus peuplé — confirmé en
// inspectant le payload brut d'un evenement invoice.payment_succeeded reel.
// La reference vit desormais sous invoice.parent.subscription_details.subscription.
// Le SDK stripe installe (v17.7.0) ne declare ni `parent` sur Invoice, ni
// `subscription` sur SubscriptionDetails — d'ou le cast local ici plutot
// qu'un acces type par type partout ou c'est utilise.
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string } } | null;
  }).parent;
  return parent?.subscription_details?.subscription;
}

// Épinglée explicitement (audit 23/07, voir lib/stripe/client.ts) — cette
// route construit son propre client Stripe (toujours en mode live, jamais
// test — un webhook ne peut arriver que du compte réellement configuré côté
// Stripe Dashboard) au lieu de passer par getStripeClient. Même version que
// les appels sortants centralisés, pour rester cohérent.
const STRIPE_API_VERSION = '2025-02-24.acacia' as const;

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: STRIPE_API_VERSION });
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
  } catch (err: any) {
    console.error('[Webhook] Signature invalide:', err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  console.log('[Webhook] Événement reçu:', event.type);

  // ── PAIEMENT CONFIRMÉ ────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};
    const bookingId = meta.bookingId;
    const memberId = meta.memberId;
    const groupRef = meta.groupRef || '';
    const dep = meta.depositAmount
      ? parseFloat(meta.depositAmount)
      : Math.max(0, (session.amount_total || 0) / 100 - 1.99);

    const isPaidForMember = meta.mode === 'pay_for_member';
    const payerMemberId: string | null = meta.payerMemberId || null;

    if (!bookingId || !memberId) {
      console.warn('[Webhook] Métadonnées manquantes — bookingId ou memberId absent');
      return NextResponse.json({ received: true });
    }

    try {
      const { data: member } = await supabase
        .from('booking_members')
        .select('*')
        .eq('id', memberId)
        .eq('booking_id', bookingId)
        .maybeSingle();

      // Idempotence : si déjà payé/arrivé, on ignore (webhook potentiellement rejoué)
      if (member?.status === 'paid' || member?.status === 'arrived') {
        console.warn(`[Webhook] Membre ${memberId} déjà 'paid' — ignoré (idempotent)`);
        return NextResponse.json({ received: true });
      }

      const memberEmail = session.customer_details?.email || meta.clientEmail || null;

      await supabase
        .from('booking_members')
        .update({
          status: 'paid',
          deposit: dep,
          email: memberEmail,
          stripe_payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          stripe_checkout_session_id: session.id,
          ...(isPaidForMember && payerMemberId
            ? { paid_by_member_id: payerMemberId, paid_for_at: new Date().toISOString() }
            : {}),
        })
        .eq('id', memberId)
        .eq('booking_id', bookingId);

      console.log(`[Webhook] ✅ Paiement validé — booking ${bookingId}, membre ${memberId}, ${dep}€`);

      // Notification pro — nouvelle réservation payée. Placé APRÈS le
      // early-return d'idempotence ci-dessus (webhook rejoué sur un membre
      // déjà 'paid' → return avant d'arriver ici), donc un seul email par
      // paiement réel, jamais de doublon sur rejeu. Voir lib/pro-notifications.ts.
      const allMemberIdsForNotif = meta.allMemberIds
        ? meta.allMemberIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      await notifyProNewBooking(supabase, bookingId, {
        depositAmount: dep,
        groupSize: allMemberIdsForNotif.length,
      });

      // ── Consommation de la réduction de parrainage ────────────────────────
      // Déclenché uniquement si le paiement est confirmé (jamais sur session abandonnée)
      const clientUserId = meta.clientUserId || '';
      const referralDiscountPct = parseInt(meta.referralDiscountPct || '0', 10);
      if (clientUserId && referralDiscountPct > 0) {
        // Stocker le % de réduction dans booking_members pour que la caisse recalcule
        // le bon solde (prix réduit - dépôt)
        if (memberId) {
          await supabase
            .from('booking_members')
            .update({ referral_discount_pct: referralDiscountPct })
            .eq('id', memberId);
        }

        if (referralDiscountPct === 20) {
          // Parrain : décrémentation atomique du stock (GREATEST protège contre race condition)
          await supabase.rpc('decr_referral_discounts', { uid: clientUserId });

          // Marquer l'événement le plus ancien non-consommé
          const { data: unconsumedEvent } = await supabase
            .from('referral_events')
            .select('id')
            .eq('referrer_id', clientUserId)
            .eq('parrain_discount_consumed', false)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (unconsumedEvent) {
            await supabase
              .from('referral_events')
              .update({
                parrain_discount_consumed: true,
                parrain_discount_consumed_at: new Date().toISOString(),
              })
              .eq('id', unconsumedEvent.id);
          }
        } else {
          // Filleul (-10%) : réduction unique, on remet à 0
          await supabase
            .from('app_users')
            .update({ pending_referral_discount_pct: 0 })
            .eq('id', clientUserId);
        }

        console.log(`[Parrainage] Réduction -${referralDiscountPct}% consommée pour user=${clientUserId}`);
      }

      // ── Frais de gestion offerts (bonus palier parrainage) ────────────────
      if (meta.hasFreeManagementFee === 'true' && clientUserId) {
        await supabase.rpc('decr_free_management_fees', { uid: clientUserId });
        console.log(`[Parrainage] Frais de gestion offert consommé pour user=${clientUserId}`);
      }

      // Mode A groupe : l'organisateur a payé pour tous — marquer chaque membre
      const allMemberIds = meta.allMemberIds
        ? meta.allMemberIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      if (allMemberIds.length > 1) {
        // Vérification de cohérence montant : alerte si le total Stripe ne correspond pas
        // au calcul attendu (N × dépôt + fraisGestion). Non bloquant — le paiement est
        // déjà encaissé par Stripe ; c'est un filet de sécurité contre nos propres bugs.
        const metaFrais = parseFloat(meta.fraisGestion || '0');
        const metaQty = parseInt(meta.groupQuantity || '1', 10);
        const expectedTotal = Math.round((dep * metaQty + metaFrais) * 100);
        const actualTotal = session.amount_total || 0;
        if (metaFrais > 0 && Math.abs(expectedTotal - actualTotal) > 2) {
          console.error(
            `[Webhook] ⚠️ MONTANT INATTENDU Mode A — groupRef=${groupRef}` +
            ` attendu=${expectedTotal / 100}€ (${metaQty}×${dep}+${metaFrais})` +
            ` reçu=${actualTotal / 100}€ — paiement accepté, investigation requise`
          );
        }

        const otherIds = allMemberIds.filter((id: string) => id !== memberId);
        if (otherIds.length > 0) {
          await supabase
            .from('booking_members')
            .update({
              status: 'paid',
              deposit: dep,
              stripe_payment_intent_id:
                typeof session.payment_intent === 'string' ? session.payment_intent : null,
              stripe_checkout_session_id: session.id,
            })
            .in('id', otherIds)
            .neq('status', 'paid');
          console.log(`[Webhook] Mode A — ${otherIds.length} membres supplémentaires marqués paid`);
        }
      }

      // member_ref (ancien flow rejoindre) : même participant sur plusieurs bookings
      if (groupRef && member?.member_ref && allMemberIds.length <= 1) {
        const { data: groupMembers } = await supabase
          .from('booking_members')
          .select('id, booking_id, status')
          .eq('member_ref', member.member_ref)
          .neq('booking_id', bookingId);

        for (const gm of groupMembers || []) {
          if (gm.status !== 'paid') {
            await supabase
              .from('booking_members')
              .update({ status: 'paid', deposit: dep })
              .eq('id', gm.id);
          }
        }
      }

      // Auto-complete : si tous les membres non-annulés ont payé → booking complete
      const { data: allMembers } = await supabase
        .from('booking_members')
        .select('id, status')
        .eq('booking_id', bookingId);

      const { data: bookingRow } = await supabase
        .from('bookings')
        .select('biz_id, status, group_ref, biz_name, service_name, date, time')
        .eq('id', bookingId)
        .maybeSingle();

      const activeMembers = (allMembers ?? []).filter(m => m.status !== 'cancelled');
      // ⚠️ 'completed' est la seule valeur valide de l'enum booking_status
      // (active/cancelled/completed) — 'complete' (sans d) était utilisé ici
      // par erreur, ce qui faisait échouer l'update silencieusement à chaque
      // fois (aucune inspection de { error }) et rendait wasAlreadyComplete
      // structurellement toujours false, cassant la protection anti-double-
      // facturation hors-forfait ci-dessous.
      const wasAlreadyComplete = bookingRow?.status === 'completed';
      if (activeMembers.length > 0 && activeMembers.every(m => m.status === 'paid')) {
        const { error: completeError } = await supabase
          .from('bookings')
          .update({ status: 'completed' })
          .eq('id', bookingId);
        if (completeError) {
          console.error(`[Webhook] ❌ Échec update status=completed — booking ${bookingId}:`, completeError.message);
        } else {
          console.log(`[Webhook] ✅ Booking ${bookingId} → completed (tous les membres ont payé)`);
        }

        // ── Hors-forfait pro ────────────────────────────────────────────────
        // Idempotence : on ne compte la réservation qu'une seule fois, à la
        // toute première bascule vers 'completed' (le webhook peut être rejoué).
        if (!wasAlreadyComplete && bookingRow?.biz_id) {
          await maybeCreateOverageCharge(supabase, bookingRow.biz_id, bookingId);
        }
      }

      // ── Complétion de groupe ─────────────────────────────────────────────
      // Si ce booking appartient à un groupe, vérifier si TOUS les bookings
      // du groupe sont maintenant complets → email de confirmation à tous
      if (bookingRow?.group_ref) {
        const { data: groupBookings } = await supabase
          .from('bookings')
          .select('id, status, client_email, biz_name, service_name, staff_name, date, time, booking_members(id, name, status, email, deposit, qr_code)')
          .eq('group_ref', bookingRow.group_ref);

        const allGroupBookings = groupBookings ?? [];
        const allGroupActive = allGroupBookings.flatMap((b: any) =>
          (b.booking_members ?? []).filter((m: any) => m.status !== 'cancelled')
        );
        const allGroupPaid = allGroupActive.length > 0 && allGroupActive.every((m: any) =>
          m.status === 'paid' || m.status === 'arrived'
        );

        if (allGroupPaid) {
          // Marquer tous les bookings du groupe comme completed
          const incompleteIds = allGroupBookings
            .filter((b: any) => b.status !== 'completed' && b.status !== 'cancelled')
            .map((b: any) => b.id);
          if (incompleteIds.length > 0) {
            const { error: completeGroupError } = await supabase
              .from('bookings')
              .update({ status: 'completed' })
              .in('id', incompleteIds);
            if (completeGroupError) {
              console.error(`[Webhook] ❌ Échec update status=completed — groupe ${bookingRow.group_ref}, ids ${incompleteIds.join(',')}:`, completeGroupError.message);
            }
          }

          // Email de confirmation à chaque participant (via booking_members.email ou booking.client_email)
          const dateFormatted = new Date(allGroupBookings[0].date + 'T12:00:00').toLocaleDateString('fr-FR', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          });
          const totalParticipants = allGroupActive.length;

          for (const bk of allGroupBookings) {
            const emailTargets = new Set<string>();
            if ((bk as any).client_email) emailTargets.add((bk as any).client_email);
            for (const m of (bk as any).booking_members ?? []) {
              if (m.email) emailTargets.add(m.email);
            }
            for (const email of emailTargets) {
              await sendEmail({
                to: email,
                subject: `🎉 Groupe complet — ${(bk as any).biz_name}`,
                text: `Bonne nouvelle !\n\nVotre groupe est complet : ${totalParticipants} participant${totalParticipants > 1 ? 's ont' : ' a'} confirmé.\n\n📍 Établissement : ${(bk as any).biz_name}\n💆 Prestation : ${(bk as any).service_name}${(bk as any).staff_name ? `\n👤 Praticien : ${(bk as any).staff_name}` : ''}\n📅 Date : ${dateFormatted}\n🕐 Créneau : ${(bk as any).time}\n\nVotre place est réservée. À bientôt !\nL'équipe Book'nPay`,
              }).catch(() => {});
            }
          }
          console.log(`[Webhook] ✅ Groupe ${bookingRow.group_ref} complet — emails envoyés`);
        }
      }

      // Email de confirmation
      const { data: booking } = await supabase
        .from('bookings')
        .select('biz_name, service_name, staff_name, date, time')
        .eq('id', bookingId)
        .single();

      const customerEmail = session.customer_details?.email || meta.clientEmail || '';
      if (customerEmail && booking && member) {
        const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        await sendEmail({
          to: customerEmail,
          subject: `✅ Réservation confirmée — ${booking.biz_name}`,
          text: `Bonjour ${member.name},

Votre réservation est confirmée ! 🎉

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}${booking.staff_name ? `\n👤 Praticien : ${booking.staff_name}` : ''}
📅 Date : ${dateFormatted}
🕐 Heure : ${booking.time}
💶 Frais de réservation versés : ${dep}€

Votre code QR de check-in : ${member.qr_code || 'N/A'}
Présentez ce code à l'accueil le jour J.

ℹ️ Conditions :
• Vous venez → les frais de réservation sont déduits du montant final.
• Vous annulez > 48h avant → remboursement des frais de réservation.
• Vous annulez < 48h avant ou no-show → frais conservés par le professionnel.
• Le professionnel annule → remboursement intégral de vos frais de réservation.

⚠️ Note : les frais de gestion Book'nPay ne sont pas remboursés (CGV Art. 3).

À bientôt !
L'équipe Book'nPay`,
        });
      }
    } catch (err: any) {
      console.error('[Webhook] Erreur mise à jour booking:', err.message);
    }
  }

  // ── SESSION EXPIRÉE — client n'a jamais payé (tunnel Stripe abandonné) ───
  // ⚠️ Nécessite que cet event type soit abonné côté Dashboard Stripe sur cet
  // endpoint — sans ça ce bloc ne s'exécute jamais (dormant, sans risque).
  // Ne concerne aujourd'hui que les sessions solo (expires_at posé
  // uniquement là, voir stripe/checkout/route.ts) ; générique quand même —
  // même logique idempotente que le cron cleanup-expired-invites (filet si
  // ce webhook n'arrive pas ou n'est pas encore abonné).
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};
    const bookingId = meta.bookingId;
    const memberId = meta.memberId;

    if (bookingId && memberId) {
      const { data: member } = await supabase
        .from('booking_members')
        .select('status')
        .eq('id', memberId)
        .eq('booking_id', bookingId)
        .maybeSingle();

      // Ne jamais écraser un statut réel (paid/arrived/cancelled) — l'ordre
      // de livraison des webhooks Stripe n'est pas garanti.
      if (member?.status === 'invite') {
        await supabase.from('booking_members').update({ status: 'cancelled' }).eq('id', memberId);

        const { data: remaining } = await supabase
          .from('booking_members')
          .select('status')
          .eq('booking_id', bookingId)
          .in('status', ['paid', 'arrived']);

        if (!remaining || remaining.length === 0) {
          await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
        }

        console.log(`[Webhook] Session expirée — membre ${memberId} (booking ${bookingId}) → cancelled`);
      }
    }
  }

  // ── REMBOURSEMENT ────────────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    let meta = charge.metadata || {};

    // `metadata` posée par stripe.refunds.create() vit sur le Refund, pas
    // sur la Charge (ni le PaymentIntent) : c'est pour ça qu'on la lit sur
    // charge.refunds.data et pas sur `meta`. Dette n°6 (double email) :
    // bookings/cancel et pro/refund-gesture envoient déjà leur propre
    // email contextualisé et posent ce flag — le webhook reste le filet
    // silencieux uniquement pour ces deux chemins. Un remboursement
    // déclenché ailleurs (dashboard Stripe, admin freeze) n'a pas ce flag
    // et déclenche l'email générique ci-dessous comme avant : mieux vaut
    // un email en trop qu'un client remboursé sans le savoir.
    //
    // Tri par `created` plutôt qu'un ID exact — LIMITE CONNUE, PAS UN OUBLI :
    // sur `charge.refunded`, `event.data.object` est la Charge, pas le
    // Refund ; aucun champ de l'événement ne pointe directement le refund
    // qui vient de le déclencher (vérifié, pas supposé). En théorie, deux
    // refunds rapprochés sur la même charge + webhooks retardés/rejoués
    // pourraient faire lire le mauvais refund. En pratique ce chemin est
    // FERMÉ aujourd'hui : `member.status === 'cancelled'` (cancel/route.ts
    // et pro/refund-gesture/route.ts) empêche l'app d'émettre un second
    // `stripe.refunds.create` sur le même paiement — la seule façon
    // d'atteindre deux refunds sur une charge est une action manuelle dans
    // le Dashboard Stripe en parallèle d'un refund applicatif, pas un
    // chemin produit.
    // Si un jour l'app peut légitimement émettre plusieurs refunds sur la
    // même charge (ex. remboursements partiels successifs sur un booking
    // de groupe), ce tri cesse d'être fiable — la sortie connue est de
    // s'abonner à `refund.updated` côté Dashboard Stripe : l'objet de cet
    // événement EST le Refund concerné, plus besoin de le déduire d'une
    // liste.
    const refunds = charge.refunds?.data ?? [];
    const latestRefund = refunds.reduce<Stripe.Refund | undefined>(
      (latest, r) => (!latest || r.created > latest.created ? r : latest),
      undefined
    );
    const emailAlreadySent = latestRefund?.metadata?.email_sent === 'true';

    if ((!meta.bookingId || !meta.memberId) && charge.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(charge.payment_intent as string);
        meta = { ...meta, ...(pi.metadata || {}) };
      } catch (e: any) {
        console.warn('[Webhook] Impossible de récupérer le PaymentIntent:', e.message);
      }
    }

    const bookingId = meta.bookingId;
    const memberId = meta.memberId;
    const refundedAmount = charge.amount_refunded / 100;
    const customerEmail = charge.billing_details?.email || meta.clientEmail || '';
    const customerName = charge.billing_details?.name || meta.clientName || 'Client';

    if (bookingId && memberId) {
      await supabase
        .from('booking_members')
        .update({ status: 'cancelled' })
        .eq('id', memberId)
        .eq('booking_id', bookingId);
    }

    if (customerEmail && !emailAlreadySent) {
      await sendEmail({
        to: customerEmail,
        subject: `💸 Remboursement effectué — Book'nPay`,
        text: `Bonjour ${customerName},

Votre remboursement de ${refundedAmount}€ a bien été traité.

Le montant sera crédité sur votre moyen de paiement d'origine sous 5 à 10 jours ouvrés selon votre banque.

⚠️ Note : les frais de gestion Book'nPay ne sont pas remboursés conformément aux CGV Art. 3.

Si vous avez des questions, contactez-nous à contact@book-n-pay.com

À bientôt,
L'équipe Book'nPay`,
      });
    }
  }

  // ── ABONNEMENT PRO — paiement de facture confirmé ───────────────────────
  // Audit (Élevé #5) : c'est ce webhook, pas la création de la Subscription,
  // qui fait passer subscription_status à 'active'.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);

    if (subscriptionId) {
      const { data: settings } = await supabase
        .from('business_settings')
        .select('biz_id, subscription_status')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();

      if (settings && settings.subscription_status !== 'active') {
        await supabase
          .from('business_settings')
          .update({ subscription_status: 'active' })
          .eq('biz_id', settings.biz_id);
        console.log(`[Webhook] ✅ Abonnement actif — biz ${settings.biz_id}`);
      }

      // ── Hors-forfait pro — regroupement des impayés ─────────────────────
      // Renouvellement mensuel de l'abonnement : on facture séparément les
      // charges hors-forfait encore en retry_scheduled/failed du mois écoulé.
      if (settings) {
        await invoiceUnpaidOverageCharges(supabase, settings.biz_id);

        // ── Reset mensuel du compteur de réservations ──────────────────────
        // Uniquement sur un vrai renouvellement de cycle (pas subscription_create
        // ni subscription_update), et seulement APRÈS avoir facturé les
        // dépassements en attente ci-dessus — sinon un dépassement du mois
        // écoulé se retrouverait compté sur le nouveau mois qui démarre à 0.
        if (invoice.billing_reason === 'subscription_cycle') {
          const { error: resetError } = await supabase
            .from('business_settings')
            .update({ monthly_bookings_count: 0, bookings_count_reset_at: new Date().toISOString() })
            .eq('biz_id', settings.biz_id);

          if (resetError) {
            console.error(`[Webhook] ❌ Échec reset monthly_bookings_count — biz ${settings.biz_id}:`, resetError);
          } else {
            console.log(`[Webhook] 🔄 Compteur mensuel remis à 0 — biz ${settings.biz_id}`);
          }
        }
      }
    }
  }

  // ── ABONNEMENT PRO — échec de paiement de facture ───────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);

    if (subscriptionId) {
      const { data: settings } = await supabase
        .from('business_settings')
        .select('biz_id')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();

      if (settings) {
        await supabase
          .from('business_settings')
          .update({ subscription_status: 'past_due' })
          .eq('biz_id', settings.biz_id);
        console.warn(`[Webhook] ⚠️ Échec de paiement abonnement — biz ${settings.biz_id}`);

        const { data: biz } = await supabase
          .from('businesses')
          .select('name, owner_id')
          .eq('id', settings.biz_id)
          .maybeSingle();

        if (biz?.owner_id) {
          const { data: authUser } = await supabase.auth.admin.getUserById(biz.owner_id);
          const email = authUser.user?.email;
          if (email) {
            const amount = (invoice.amount_due / 100).toFixed(2);
            const reason = invoice.last_finalization_error?.message || null;
            await sendEmail({
              to: email,
              subject: `⚠️ Échec de paiement Book'nPay`,
              text: `Bonjour,

Le paiement de votre abonnement Book'nPay (${amount}€) pour ${biz.name} n'a pas abouti.${reason ? `\n\nRaison : ${reason}` : ''}

Merci de mettre à jour votre moyen de paiement dès que possible pour éviter une interruption de service :
${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app'}/pro/reglages

L'équipe Book'nPay`,
            }).catch(() => {});
          }
        }
      }
    }
  }

  // ── ABONNEMENT PRO — résiliation ─────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;

    const { data: settings } = await supabase
      .from('business_settings')
      .select('biz_id')
      .eq('stripe_subscription_id', subscription.id)
      .maybeSingle();

    if (settings) {
      await supabase
        .from('business_settings')
        .update({ subscription_status: 'cancelled' })
        .eq('biz_id', settings.biz_id);
      console.log(`[Webhook] Abonnement résilié — biz ${settings.biz_id}`);
    }
  }

  return NextResponse.json({ received: true });
}
