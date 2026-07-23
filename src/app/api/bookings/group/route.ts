// src/app/api/bookings/group/route.ts
// Port de base44/functions/joinGroupBooking/entry.ts
//
// Une seule route, multi-actions (comme l'original Base44), pour rester
// simple à appeler depuis le front. Toutes les actions sont publiques
// (un invité non connecté doit pouvoir rejoindre un groupe via un lien).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion, generateQrCode, normalizePhone, INVITE_EXPIRY_MS } from '@/lib/booking-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { constantTimeEqual } from '@/lib/constant-time';

const MAX_GROUP_SIZE = 23;

export async function POST(req: NextRequest) {
  const supabase = createServiceRoleClient();
  const body = await req.json();
  const { action, bookingId, memberId, memberData, token } = body;

  // Normalise le téléphone dès la réception — voir normalizePhone() pour
  // le détail du problème que ça résout (comparaisons phone === phone
  // fragiles sans format unique en base).
  if (memberData?.phone) {
    memberData.phone = normalizePhone(memberData.phone);
  }

  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId requis' }, { status: 400 });
  }

  try {
    // ── getBooking ──────────────────────────────────────────────────────────
    // Route publique (rejoindre un groupe sans compte) : le seul contrôle
    // d'accès est de connaître le bookingId. Ne renvoyer donc que les champs
    // effectivement affichés par JoinGroupClient — jamais le téléphone/email/
    // qr_code/IDs Stripe des membres ni les coordonnées du client organisateur
    // (IDOR — voir SECURITY_TODO.md #2).
    if (action === 'getBooking') {
      const { data: booking } = await supabase
        .from('bookings')
        .select(
          'id, biz_name, service_name, date, time, status, services(max_persons, deposit, price), booking_members(id, name, status, invite_expiry)'
        )
        .eq('id', bookingId)
        .maybeSingle();
      if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });
      return NextResponse.json({ booking });
    }

    // ── addMemberAndGetCheckout ──────────────────────────────────────────────
    // ⚠️ Nom historique de Base44 — cette action NE crée PAS de session Stripe.
    // Elle insère le membre puis renvoie memberId + fraisGestion ; c'est au
    // FRONT d'appeler ensuite /api/stripe/checkout avec ces infos (même
    // pattern que StepPayment.tsx pour une réservation simple).
    if (action === 'addMemberAndGetCheckout') {
      // SECURITY_TODO.md #3 — évite qu'un script spamme la création de
      // membres invités (route publique, sans compte requis) par IP.
      const { allowed } = await checkRateLimit(`join-group:${getClientIp(req)}`, 10, 10 * 60);
      if (!allowed) {
        return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
      }

      if (!memberData) return NextResponse.json({ error: 'memberData requis' }, { status: 400 });

      const { data: booking } = await supabase
        .from('bookings')
        .select('*, booking_members(*), services(max_persons), businesses(phone)')
        .eq('id', bookingId)
        .maybeSingle();
      if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

      const members = booking.booking_members || [];

      const existingByPhone = members.find(
        (m: any) => m.phone && m.phone === memberData.phone && m.status !== 'cancelled'
      );
      if (existingByPhone) {
        // Ne renvoie pas la ligne brute (qr_code, stripe_*, email...) —
        // le front n'utilise que le flag pour recharger la réservation.
        return NextResponse.json({ alreadyJoined: true });
      }

      if (memberData.phone && memberData.phone === booking.businesses?.phone) {
        return NextResponse.json(
          { error: "Un établissement ne peut pas rejoindre sa propre réservation." },
          { status: 400 }
        );
      }

      const normalizedName = (memberData.name || '').trim().toLowerCase();
      const duplicateName = members.find(
        (m: any) =>
          m.status !== 'cancelled' &&
          (m.name || '').trim().toLowerCase() === normalizedName &&
          m.phone !== memberData.phone
      );
      if (duplicateName) {
        return NextResponse.json(
          { error: `Un participant nommé "${memberData.name}" est déjà dans ce groupe.`, duplicateName: true },
          { status: 400 }
        );
      }

      const activeMembers = members.filter((m: any) => m.status !== 'cancelled');
      const hardLimit = booking.services?.max_persons
        ? Math.min(booking.services.max_persons, MAX_GROUP_SIZE)
        : MAX_GROUP_SIZE;
      if (activeMembers.length >= hardLimit) {
        return NextResponse.json(
          { error: `Groupe complet (max ${hardLimit} personnes)`, capacityFull: true },
          { status: 400 }
        );
      }

      const inviteExpiry = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();

      const { data: newMember, error: insertError } = await supabase
        .from('booking_members')
        .insert({
          booking_id: bookingId,
          member_ref: memberData.memberRef || memberData.id || null,
          name: memberData.name,
          phone: memberData.phone,
          status: 'invite',
          deposit: memberData.dep || null,
          qr_code: generateQrCode(),
          is_referral: true,
          invite_expiry: inviteExpiry,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      console.log(
        `[JoinGroup] Membre ajouté: ${memberData.name} (${memberData.phone}) → booking ${bookingId} | groupe: ${activeMembers.length + 1}/${hardLimit}`
      );

      const dep = memberData.dep || 0;
      const fraisGestion = calcFraisGestion(dep);

      return NextResponse.json({
        success: true,
        memberId: newMember.id,
        fraisGestion,
        groupSize: activeMembers.length + 1,
        groupCapacity: hardLimit,
      });
    }

    // ── removeInvite ─────────────────────────────────────────────────────────
    // Action réservée à l'organisateur — celui-ci n'a pas forcément de compte
    // (voir en-tête de fichier), donc pas de check client_id === auth.uid()
    // possible ici : c'est organizer_token (migration 0039) qui fait foi,
    // jamais diffusé dans le lien invité (ShareGroupLink.tsx), seulement dans
    // le lien organisateur affiché sur confirmation/page.tsx.
    if (action === 'removeInvite') {
      if (!memberId) return NextResponse.json({ error: 'memberId requis' }, { status: 400 });

      const { data: bookingRow } = await supabase
        .from('bookings')
        .select('organizer_token')
        .eq('id', bookingId)
        .maybeSingle();

      if (!bookingRow || !token || !constantTimeEqual(token, bookingRow.organizer_token)) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
      }

      const { data: member } = await supabase
        .from('booking_members')
        .select('*')
        .eq('id', memberId)
        .eq('booking_id', bookingId)
        .maybeSingle();

      if (!member) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
      if (member.status !== 'invite') {
        return NextResponse.json(
          { error: 'Ce membre a déjà payé, impossible de le retirer' },
          { status: 400 }
        );
      }

      await supabase.from('booking_members').delete().eq('id', memberId);

      console.log(`[JoinGroup] Membre retiré: ${member.name} (${member.phone}) par l'organisateur`);
      return NextResponse.json({ success: true });
    }

    // ── cancelExpiredBooking ─────────────────────────────────────────────────
    if (action === 'cancelExpiredBooking') {
      const { data: booking } = await supabase
        .from('bookings')
        .select('*, booking_members(*)')
        .eq('id', bookingId)
        .maybeSingle();
      if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

      const now = Date.now();
      const members = booking.booking_members || [];
      const expiredMembers = members.filter(
        (m: any) => m.status === 'invite' && m.invite_expiry && new Date(m.invite_expiry).getTime() < now
      );

      if (expiredMembers.length === 0) {
        return NextResponse.json({ expired: false });
      }

      for (const m of expiredMembers) {
        await supabase.from('booking_members').update({ status: 'cancelled' }).eq('id', m.id);
      }

      const remainingPaid = members.filter(
        (m: any) =>
          !expiredMembers.find((e: any) => e.id === m.id) &&
          (m.status === 'paid' || m.status === 'arrived')
      );
      const newStatus = remainingPaid.length === 0 ? 'cancelled' : 'active';

      await supabase.from('bookings').update({ status: newStatus }).eq('id', bookingId);

      console.log(
        `[JoinGroup] Booking ${bookingId} — ${expiredMembers.length} invite(s) expirés → status: ${newStatus}`
      );

      return NextResponse.json({
        expired: true,
        cancelled: newStatus === 'cancelled',
        partialExpiry: newStatus === 'active',
      });
    }

    return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
  } catch (error: any) {
    return logAndRespond('[joinGroupBooking] Erreur:', error);
  }
}
