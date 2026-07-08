// src/app/api/admin/freeze-business/route.ts
// ⚠️ Aucune fonction Base44 d'origine ne gérait le GEL lui-même — seule
// `notifyUnfreeze` existait (notification post-dégel), supposant qu'un gel
// avait eu lieu par un mécanisme jamais construit. Cette route construit la
// mécanique complète : geler annule les réservations futures actives et
// notifie les clients concernés ; dégeler notifie les clients annulés que
// l'établissement a repris (port de notifyUnfreeze).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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
      await serviceSupabase
        .from('businesses')
        .update({ frozen: true, frozen_reason: reason || null })
        .eq('id', bizId);

      const today = new Date().toISOString().split('T')[0];
      const { data: futureBookings } = await serviceSupabase
        .from('bookings')
        .select(
          'id, client_email, service_name, date, time, booking_members(id, phone, name, status, email, deposit, stripe_payment_intent_id)'
        )
        .eq('biz_id', bizId)
        .neq('status', 'cancelled')
        .gte('date', today);

      let cancelledCount = 0;
      let refundedCount = 0;
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
                metadata: { reason: 'business_frozen', biz_id: bizId },
              });
              await serviceSupabase
                .from('booking_members')
                .update({ status: 'cancelled', montant_rembourse: member.deposit ?? 0 })
                .eq('id', member.id);
              refundedCount++;

              const emailTo = member.email || booking.client_email;
              if (emailTo) {
                await sendEmail({
                  to: emailTo,
                  subject: `💸 Remboursement — Réservation annulée chez ${business.name}`,
                  text: `Bonjour ${member.name || 'vous'},\n\nL'établissement ${business.name} est temporairement indisponible, votre réservation a donc été annulée.\n\n💆 ${booking.service_name}\n📅 ${dateFormatted} à ${booking.time}\n\nVos frais de réservation (${member.deposit ?? 0}€) vous seront remboursés sous 5 à 10 jours ouvrés.\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
                }).catch(() => {});
              }
            } catch (err: any) {
              console.error(`[FreezeBusiness] Remboursement échoué membre ${member.id}:`, err.message);
              await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', member.id);
            }
          } else {
            // Statut paid/arrived mais pas d'ID de paiement (paiement especes/tpe) — pas de remboursement Stripe possible.
            await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', member.id);
          }
          cancelledCount++;
        }
      }

      console.log(`[FreezeBusiness] ${business.name} gelé — ${cancelledCount} membre(s) annulé(s), ${refundedCount} remboursement(s)`);
      return NextResponse.json({ success: true, frozen: true, cancelledMembers: cancelledCount, refundedMembers: refundedCount });
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
📅 Rendez-vous annulé le : ${dateFormatted} à ${booking.time}

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
