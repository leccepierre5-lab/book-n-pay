import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateQrCode, generateGroupRef, normalizePhone } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      console.warn('[create-group] authData.user is null — booking will have client_id=null');
    }

    const body = await req.json();
    const {
      bizId, bizName, serviceId, serviceName, staffId, staffName,
      date, slots, mode, clientName, clientPhone, clientEmail,
      guestNames = [],   // Mode A: optional participant names
      guests = [],       // Mode B: [{ name?, phone }] for each invited guest
    } = body;

    if (!bizId || !serviceId || !date || !Array.isArray(slots) || slots.length < 2) {
      return NextResponse.json({ error: 'Champs requis manquants (slots min 2)' }, { status: 400 });
    }
    if (slots.length > 23) {
      return NextResponse.json({ error: 'Groupe limité à 23 personnes maximum' }, { status: 400 });
    }
    if (mode === 'b' && guests.length !== slots.length - 1) {
      return NextResponse.json({ error: 'Nombre d\'invités incorrect pour le mode B' }, { status: 400 });
    }

    const supabaseService = createServiceRoleClient();

    // Check biz not frozen
    const { data: biz } = await supabaseService
      .from('businesses')
      .select('frozen')
      .eq('id', bizId)
      .maybeSingle();
    if (biz?.frozen) {
      return NextResponse.json({ error: 'Établissement temporairement indisponible.' }, { status: 423 });
    }

    // Upsert organizer profile
    if (authData.user?.id) {
      await supabaseService.from('app_users').upsert({
        id: authData.user.id,
        name: clientName,
        phone: clientPhone || null,
        role: 'client',
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    // Referrer name for organizer (denormalized for pro dashboard)
    let referrerName: string | null = null;
    if (authData.user?.id) {
      const { data: profile } = await supabaseService
        .from('app_users')
        .select('referred_by')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profile?.referred_by) {
        const { data: referrer } = await supabaseService
          .from('app_users')
          .select('name')
          .eq('id', profile.referred_by)
          .maybeSingle();
        referrerName = referrer?.name || null;
      }
    }

    const groupRef = generateGroupRef();
    const paymentDeadline = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const created: { bookingId: string; memberId: string; isOrganizer: boolean }[] = [];

    for (let i = 0; i < slots.length; i++) {
      const isOrganizer = i === 0;
      const guestIdx = i - 1; // index into guests[] / guestNames[]

      const participantName = isOrganizer
        ? clientName
        : (mode === 'a'
            ? (guestNames[i] || `Personne ${i + 1}`)
            : (guests[guestIdx]?.name || `Invité ${i}`));

      const participantPhone = isOrganizer
        ? (clientPhone || null)
        : (mode === 'b' ? normalizePhone(guests[guestIdx]?.phone || '') : null);

      const { data: booking, error: bookingError } = await supabaseService
        .from('bookings')
        .insert({
          biz_id: bizId,
          biz_name: bizName,
          service_id: serviceId,
          service_name: serviceName,
          staff_id: staffId || null,
          staff_name: staffName || null,
          date,
          time: slots[i],
          status: 'active',
          group_ref: groupRef,
          payment_deadline: paymentDeadline,
          client_id: isOrganizer ? (authData.user?.id || null) : null,
          client_phone: participantPhone,
          client_name: participantName,
          client_email: isOrganizer ? clientEmail : null,
        })
        .select('id')
        .single();

      if (bookingError) throw bookingError;

      const { data: member, error: memberError } = await supabaseService
        .from('booking_members')
        .insert({
          booking_id: booking.id,
          name: participantName,
          phone: participantPhone,
          status: 'invite',
          qr_code: generateQrCode(),
          referrer_name: isOrganizer ? referrerName : null,
        })
        .select('id')
        .single();

      if (memberError) throw memberError;

      created.push({ bookingId: booking.id, memberId: member.id, isOrganizer });
    }

    const organizer = created[0];
    const guestData = created.slice(1);

    return NextResponse.json({
      groupRef,
      primaryBookingId: organizer.bookingId,
      primaryMemberId: organizer.memberId,
      allMemberIds: created.map((c) => c.memberId),
      guestMemberIds: guestData.map((c) => c.memberId),
    });
  } catch (error: any) {
    console.error('[CreateGroup] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
