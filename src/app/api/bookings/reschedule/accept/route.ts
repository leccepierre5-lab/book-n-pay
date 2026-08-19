// src/app/api/bookings/reschedule/accept/route.ts
// Le client accepte le créneau proposé (migration 0055) — public, token
// uniquement. Décision actée 15/08 : le créneau n'est PAS bloqué à la
// création de la proposition, il est re-vérifié ICI, au moment de
// l'acceptation, sans toucher aux fonctions Postgres anti-double-booking
// (voir la migration pour le détail du risque résiduel accepté). Si le
// créneau n'est plus libre, la réservation reste inchangée — jamais
// d'écriture partielle.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, formatTime } from '@/lib/booking-utils';
import { buildIcs } from '@/lib/ics';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { notifyProRescheduleOutcome } from '@/lib/pro-notifications';
import { isProposedSlotStillFree } from '@/lib/reschedule';

function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`reschedule-accept:${getClientIp(req)}`, 10, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const { token } = await req.json();
    if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: proposal } = await supabase
      .from('reschedule_proposals')
      .select('id, booking_id, status, expires_at, proposed_date, proposed_time, staff_id')
      .eq('token', token)
      .maybeSingle();
    if (!proposal) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 });

    if (proposal.status === 'accepted') {
      // Idempotent — un double clic (ou un refresh après succès) ne doit pas
      // renvoyer une erreur alors que le report a déjà été acté.
      return NextResponse.json({ success: true, alreadyAccepted: true });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json({ error: 'Cette proposition n\'est plus valide', status: proposal.status }, { status: 409 });
    }
    if (new Date(proposal.expires_at) < new Date()) {
      await supabase.from('reschedule_proposals').update({ status: 'expired' }).eq('id', proposal.id).eq('status', 'pending');
      return NextResponse.json({ error: 'Cette proposition a expiré', status: 'expired' }, { status: 409 });
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, biz_id, status, ics_sequence, biz_name, service_name, client_email, client_name, services(duration_minutes), businesses(business_locations(address))')
      .eq('id', proposal.booking_id)
      .maybeSingle();
    if (!booking || booking.status !== 'active') {
      return NextResponse.json({ error: 'Réservation introuvable ou déjà modifiée' }, { status: 409 });
    }

    const svc = Array.isArray((booking as any).services) ? (booking as any).services[0] : (booking as any).services;
    const durationMinutes = svc?.duration_minutes ?? 60;

    const stillFree = await isProposedSlotStillFree(
      supabase,
      booking.biz_id,
      proposal.proposed_date,
      proposal.proposed_time,
      durationMinutes,
      proposal.staff_id
    );

    if (!stillFree) {
      await supabase
        .from('reschedule_proposals')
        .update({ status: 'slot_taken', responded_at: new Date().toISOString() })
        .eq('id', proposal.id)
        .eq('status', 'pending');

      await supabase.from('booking_logs').insert({
        booking_id: proposal.booking_id,
        message: `RESCHEDULE_SLOT_TAKEN | proposal_id=${proposal.id} | proposed=${proposal.proposed_date} ${formatTime(proposal.proposed_time)}`,
      });

      await notifyProRescheduleOutcome(supabase, proposal.booking_id, {
        outcome: 'slot_taken',
        proposedDate: proposal.proposed_date,
        proposedTime: proposal.proposed_time,
      });

      return NextResponse.json(
        { error: 'Ce créneau vient d\'être réservé. Le professionnel va vous recontacter.', status: 'slot_taken' },
        { status: 409 }
      );
    }

    let staffName: string | null = null;
    if (proposal.staff_id) {
      const { data: staffRow } = await supabase.from('staff').select('name').eq('id', proposal.staff_id).maybeSingle();
      staffName = staffRow?.name ?? null;
    }

    const nextIcsSequence = (booking.ics_sequence ?? 0) + 1;
    const { data: updatedBooking } = await supabase
      .from('bookings')
      .update({
        date: proposal.proposed_date,
        time: proposal.proposed_time,
        staff_id: proposal.staff_id,
        staff_name: staffName,
        ics_sequence: nextIcsSequence,
      })
      .eq('id', booking.id)
      .eq('status', 'active')
      .select()
      .maybeSingle();

    if (!updatedBooking) {
      // La réservation a été modifiée (ex. annulée) entre notre lecture et
      // cet UPDATE — extrêmement rare, mais l'écriture partielle n'a pas eu
      // lieu (clause .eq('status','active')), rien à réparer.
      return NextResponse.json({ error: 'Réservation introuvable ou déjà modifiée' }, { status: 409 });
    }

    await supabase
      .from('reschedule_proposals')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', proposal.id)
      .eq('status', 'pending');

    await supabase.from('booking_logs').insert({
      booking_id: proposal.booking_id,
      message: `RESCHEDULE_ACCEPTED | proposal_id=${proposal.id} | nouveau=${proposal.proposed_date} ${formatTime(proposal.proposed_time)}`,
    });

    if (booking.client_email) {
      let icsAttachment: { filename: string; content: string } | null = null;
      try {
        const biz = Array.isArray((booking as any).businesses) ? (booking as any).businesses[0] : (booking as any).businesses;
        const loc = Array.isArray(biz?.business_locations) ? biz.business_locations[0] : biz?.business_locations;
        const ics = buildIcs({
          uid: `${booking.id}@book-n-pay.com`,
          start: parseParisDatetime(proposal.proposed_date, proposal.proposed_time),
          durationMin: durationMinutes,
          summary: `RDV — ${booking.service_name}`,
          location: loc?.address,
          organizerName: booking.biz_name,
          organizerEmail: 'contact@book-n-pay.com',
          attendeeEmail: booking.client_email,
          sequence: nextIcsSequence,
          method: 'REQUEST',
        });
        icsAttachment = { filename: 'rdv-reporte.ics', content: Buffer.from(ics, 'utf8').toString('base64') };
      } catch (e: any) {
        console.warn('[RescheduleAccept] Génération ICS échouée (email envoyé sans pièce jointe calendrier):', e.message);
      }

      await sendEmail({
        to: booking.client_email,
        subject: `✅ RDV reporté — ${booking.biz_name}`,
        text: `Bonjour ${booking.client_name || ''},

Votre RDV a bien été reporté.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Nouveau créneau : ${formatDateFr(proposal.proposed_date)} à ${formatTime(proposal.proposed_time)}

À bientôt,
L'équipe Book'nPay`,
        ...(icsAttachment ? { attachments: [icsAttachment] } : {}),
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      date: proposal.proposed_date,
      time: proposal.proposed_time,
    });
  } catch (error: any) {
    return logAndRespond('[RescheduleAccept] Erreur:', error);
  }
}
