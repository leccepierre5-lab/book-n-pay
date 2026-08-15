// src/app/api/pro/reschedule-propose/route.ts
// Le pro propose un nouveau créneau pour un RDV à venir (absence, imprévu) —
// migration 0055. Le client doit ACCEPTER via le lien envoyé par email
// (bookings/reschedule/[token]) ; cette route ne modifie jamais bookings
// elle-même, elle crée seulement la proposition. Portée : réservations
// individuelles uniquement (group_ref null) — décision actée 15/08, un
// report de groupe soulève la question de qui accepte pour les autres
// membres, hors sujet ici.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, formatTime } from '@/lib/booking-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { generateRescheduleToken, computeRescheduleExpiresAt } from '@/lib/reschedule';

function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { allowed } = await checkRateLimit(`pro-reschedule-propose:${authData.user.id}`, 20, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const { bookingId, proposedDate, proposedTime, staffId, reason } = await req.json();
    if (!bookingId || !proposedDate || !proposedTime) {
      return NextResponse.json({ error: 'bookingId, proposedDate et proposedTime requis' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('app_users')
      .select('role, biz_id')
      .eq('id', authData.user.id)
      .single();

    const serviceSupabase = createServiceRoleClient();
    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });
    if (profile?.role !== 'admin' && profile?.biz_id !== booking.biz_id) {
      return NextResponse.json({ error: 'Non autorisé pour cette réservation' }, { status: 403 });
    }
    if (booking.status !== 'active') {
      return NextResponse.json({ error: 'Seule une réservation active peut être reportée' }, { status: 400 });
    }
    if (booking.group_ref) {
      return NextResponse.json(
        { error: 'Le report en ligne ne couvre pas les réservations de groupe pour le moment' },
        { status: 400 }
      );
    }

    const rdvDateTime = parseParisDatetime(booking.date, booking.time);
    const expiresAt = computeRescheduleExpiresAt(rdvDateTime);
    if (!expiresAt) {
      return NextResponse.json(
        { error: 'Report impossible à moins de 2h du RDV — utilise l\'annulation directe.' },
        { status: 400 }
      );
    }

    const proposedDateTime = parseParisDatetime(proposedDate, proposedTime);
    if (proposedDateTime.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Le créneau proposé doit être dans le futur' }, { status: 400 });
    }

    const { data: existingPending } = await serviceSupabase
      .from('reschedule_proposals')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
      .maybeSingle();
    if (existingPending) {
      return NextResponse.json(
        { error: 'Une proposition de report est déjà en attente pour cette réservation' },
        { status: 409 }
      );
    }

    const token = generateRescheduleToken();
    const { data: proposal, error: insertError } = await serviceSupabase
      .from('reschedule_proposals')
      .insert({
        booking_id: bookingId,
        original_date: booking.date,
        original_time: booking.time,
        proposed_date: proposedDate,
        proposed_time: proposedTime,
        staff_id: staffId ?? null,
        token,
        status: 'pending',
        reason: reason ?? null,
        expires_at: expiresAt.toISOString(),
        created_by: authData.user.id,
      })
      .select()
      .single();

    if (insertError) {
      // Contrainte unique (proposition pending déjà créée entre-temps, ex.
      // double clic) — même famille de course que l'idempotence pro_charges.
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Une proposition de report est déjà en attente pour cette réservation' },
          { status: 409 }
        );
      }
      return logAndRespond('[RescheduleProposal] Erreur insertion:', insertError);
    }

    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `RESCHEDULE_PROPOSED | proposal_id=${proposal.id} | pro_id=${authData.user.id} | proposed=${proposedDate} ${formatTime(proposedTime)} | expires_at=${expiresAt.toISOString()}`,
    });

    if (booking.client_email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app';
      const link = `${siteUrl}/reschedule/${token}`;
      await sendEmail({
        to: booking.client_email,
        subject: `📅 Nouveau créneau proposé — ${booking.biz_name}`,
        text: `Bonjour ${booking.client_name || ''},

${booking.biz_name} vous propose un nouveau créneau pour votre RDV.

💆 Prestation : ${booking.service_name}
📅 Créneau actuel : ${formatDateFr(booking.date)} à ${formatTime(booking.time)}
📅 Nouveau créneau proposé : ${formatDateFr(proposedDate)} à ${formatTime(proposedTime)}
${reason ? `\nMotif : ${reason}\n` : ''}
Merci de répondre avant le ${expiresAt.toLocaleDateString('fr-FR')} à ${expiresAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} :
${link}

Si vous ne répondez pas ou refusez, votre réservation reste sur son créneau actuel.

L'équipe Book'nPay`,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, proposalId: proposal.id, expiresAt: expiresAt.toISOString() });
  } catch (error: any) {
    return logAndRespond('[RescheduleProposal] Erreur:', error);
  }
}
