// src/app/api/admin/freeze-business/route.ts
// ⚠️ Aucune fonction Base44 d'origine ne gérait le GEL lui-même — seule
// `notifyUnfreeze` existait (notification post-dégel), supposant qu'un gel
// avait eu lieu par un mécanisme jamais construit. Cette route construit la
// mécanique complète : geler annule les réservations futures actives et
// notifie les clients concernés ; dégeler notifie les clients annulés que
// l'établissement a repris (port de notifyUnfreeze).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { depositRefundAmountCents, retrieveManagementFeeAmount } from '@/lib/refunds';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';
import { formatTime, getParisDateOffsetStr } from '@/lib/booking-utils';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role')
      .eq('id', authData.user.id)
      .single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Accès réservé aux admins' }, { status: 403 });
    }

    const { bizId, action, reason } = await req.json();
    if (!bizId || !['freeze', 'unfreeze'].includes(action)) {
      return NextResponse.json({ error: 'bizId et action (freeze|unfreeze) requis' }, { status: 400 });
    }

    const serviceSupabase = createServiceRoleClient();
    const { data: business } = await serviceSupabase
      .from('businesses')
      .select('id, name')
      .eq('id', bizId)
      .maybeSingle();
    if (!business) return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 });

    if (action === 'freeze') {
      // Instanciation paresseuse (comme refund-gesture/route.ts) : évite un
      // crash au chargement du module si STRIPE_SECRET_KEY est absente d'un
      // environnement (ex: Preview Vercel, où seule la clé Production est
      // configurée) — l'ancien `new Stripe(...)` au niveau module plantait le
      // build même sur des routes jamais appelées.
      const stripe = await getStripeClient(serviceSupabase);

      await serviceSupabase
        .from('businesses')
        .update({ frozen: true, frozen_reason: reason || null })
        .eq('id', bizId);

      const today = getParisDateOffsetStr(0);
      const { data: futureBookings } = await serviceSupabase
        .from('bookings')
        .select(
          'id, client_email, service_name, date, time, booking_members(id, phone, name, status, email, deposit, stripe_payment_intent_id, stripe_checkout_session_id)'
        )
        .eq('biz_id', bizId)
        .neq('status', 'cancelled')
        .gte('date', today);

      let cancelledCount = 0;
      let refundedCount = 0;
      // ⚠️ CORRECTIF (audit 26/07, même classe que le BLOQUANT expireGroup) —
      // NUANCE : contrairement au groupe, il n'existe ici aucun cron/filet
      // lazy qui repasse sur un membre 'cancelled' non remboursé, et un gel
      // d'établissement est une décision admin déjà actée — la réservation
      // doit se libérer quoi qu'il arrive côté Stripe. L'alerte admin
      // groupée en fin de boucle est donc le SEUL filet pour les refunds en
      // échec : sans elle, ils ne remontaient qu'en console.
      const refundFailures: { bookingId: string; memberId: string; deposit: number; message: string }[] = [];
      for (const booking of futureBookings || []) {
        await serviceSupabase.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
        await serviceSupabase.from('booking_logs').insert({
          booking_id: booking.id,
          message: `Réservation annulée — gel établissement (${reason || 'raison non précisée'})`,
        });

        const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });

        for (const member of (booking as any).booking_members || []) {
          if (member.status !== 'paid' && member.status !== 'arrived') continue;

          // Rembourse systématiquement les membres déjà payés — même logique
          // que expireGroup.ts pour un groupe expiré. Sans ça, le client perd
          // ses frais de réservation sans remboursement ni notification.
          if (member.stripe_payment_intent_id) {
            try {
              await stripe.refunds.create({
                payment_intent: member.stripe_payment_intent_id,
                // Ne rembourse que les frais de réservation — les frais de
                // gestion Book'nPay restent acquis même sur un gel d'établissement.
                amount: depositRefundAmountCents(member.deposit),
                metadata: { reason: 'business_frozen', biz_id: bizId },
              });
              await serviceSupabase
                .from('booking_members')
                .update({ status: 'cancelled', montant_rembourse: member.deposit ?? 0 })
                .eq('id', member.id);
              refundedCount++;

              const emailTo = member.email || booking.client_email;
              if (emailTo) {
                // Best-effort — un échec ici ne doit jamais bloquer le gel
                // (déjà effectif au-dessus) ni le remboursement (déjà fait).
                const managementFeeAmount = await retrieveManagementFeeAmount(
                  stripe,
                  member.stripe_checkout_session_id,
                  'FreezeBusiness'
                );
                // Deux lignes chiffrées distinctes plutôt qu'un rappel vague
                // (jusqu'ici absent : l'ancien texte ne mentionnait même pas
                // que des frais restaient acquis) — même correctif que C15
                // (pro/cancel-booking, `e7cfe60`).
                const managementFeeLine = managementFeeAmount != null
                  ? `❌ Conservé : ${managementFeeAmount.toFixed(2)}€ (frais de gestion Book'nPay, CGV Art. 2 — jamais remboursés)`
                  : `⚠️ Les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 2).`;
                await sendEmail({
                  to: emailTo,
                  subject: `💸 Remboursement — Réservation annulée chez ${business.name}`,
                  text: `Bonjour ${member.name || 'vous'},\n\nL'établissement ${business.name} est temporairement indisponible, votre réservation a donc été annulée.\n\n💆 ${booking.service_name}\n📅 ${dateFormatted} à ${formatTime(booking.time)}\n\n✅ Remboursé : ${member.deposit ?? 0}€ (frais de réservation) sous 5 à 10 jours ouvrés.\n${managementFeeLine}\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
                }).catch(() => {});
              }
            } catch (err: any) {
              console.error(`[FreezeBusiness] Remboursement échoué membre ${member.id}:`, err.message);
              await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', member.id);
              await serviceSupabase.from('booking_logs').insert({
                booking_id: booking.id,
                message: `Remboursement gel établissement échoué — membre ${member.id}, ${member.deposit ?? 0}€ — à vérifier manuellement (pas de retry automatique sur ce flux)`,
              });
              refundFailures.push({
                bookingId: booking.id,
                memberId: member.id,
                deposit: member.deposit ?? 0,
                message: err.message,
              });
            }
          } else {
            // Statut paid/arrived mais pas d'ID de paiement (paiement especes/tpe) — pas de remboursement Stripe possible.
            await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', member.id);
          }
          cancelledCount++;
        }
      }

      if (refundFailures.length > 0) {
        await notifyAdminOnFailure('admin/freeze-business:refunds', {
          processed: refundedCount,
          failed: refundFailures.length,
          failedItems: refundFailures,
          failedDescriptions: refundFailures.map(
            (f) => `membre ${f.memberId} (booking ${f.bookingId}, ${f.deposit}€) — ${f.message}`
          ),
        });
      }

      console.log(`[FreezeBusiness] ${business.name} gelé — ${cancelledCount} membre(s) annulé(s), ${refundedCount} remboursement(s), ${refundFailures.length} échec(s)`);
      return NextResponse.json({ success: true, frozen: true, cancelledMembers: cancelledCount, refundedMembers: refundedCount, refundFailures: refundFailures.length });
    }

    // ── unfreeze ──────────────────────────────────────────────────────────
    await serviceSupabase
      .from('businesses')
      .update({ frozen: false, frozen_reason: null })
      .eq('id', bizId);

    const cutoffIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: recentLogs } = await serviceSupabase
      .from('booking_logs')
      .select('booking_id, message, created_at, bookings!inner(biz_id, biz_name, service_name, date, time, client_email)')
      .ilike('message', '%gel établissement%')
      .gte('created_at', cutoffIso);

    let notified = 0;
    for (const log of recentLogs || []) {
      const booking = (log as any).bookings;
      if (booking?.biz_id !== bizId || !booking.client_email) continue;
      const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      await sendEmail({
        to: booking.client_email,
        subject: `✅ ${business.name} a repris son activité — Rebookez !`,
        text: `Bonjour,

Bonne nouvelle ! L'établissement qui avait dû annuler votre réservation a repris son activité normale.

📍 Établissement : ${business.name}
💆 Prestation concernée : ${booking.service_name}
📅 Rendez-vous annulé le : ${dateFormatted} à ${formatTime(booking.time)}

Vous pouvez dès maintenant reprendre rendez-vous directement sur Book'nPay.

L'équipe Book'nPay`,
      });
      notified++;
    }

    console.log(`[FreezeBusiness] ${business.name} dégelé — ${notified} client(s) notifié(s)`);
    return NextResponse.json({ success: true, frozen: false, notified });
  } catch (error: any) {
    return logAndRespond('[FreezeBusiness] Erreur:', error);
  }
}
