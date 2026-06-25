// src/app/api/bookings/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateQrCode } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    const body = await req.json();
    const { bizId, bizName, serviceId, serviceName, staffId, staffName, date, time, clientPhone, clientEmail } = body;
    // Fallback serveur : user_metadata ou email si le profil app_users n'existe pas encore
    const clientName: string =
      body.clientName ||
      (authData.user?.user_metadata as any)?.name ||
      authData.user?.email ||
      'Client';

    if (!bizId || !serviceId || !date || !time) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('frozen')
      .eq('id', bizId)
      .maybeSingle();
    if (business?.frozen) {
      return NextResponse.json(
        { error: 'Cet établissement est temporairement indisponible.' },
        { status: 423 }
      );
    }

    const supabaseService = createServiceRoleClient();

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
        time,
        status: 'active',
        client_id: authData.user?.id || null,
        client_phone: clientPhone,
        client_name: clientName,
        client_email: clientEmail,
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    // Nom du parrain (si le client a été parrainé) — dénormalisé pour le pro
    let referrerName: string | null = null;
    if (authData.user?.id) {
      const { data: clientProfile } = await supabaseService
        .from('app_users')
        .select('referred_by')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (clientProfile?.referred_by) {
        const { data: referrer } = await supabaseService
          .from('app_users')
          .select('name')
          .eq('id', clientProfile.referred_by)
          .maybeSingle();
        referrerName = referrer?.name || null;
      }
    }

    const { data: member, error: memberError } = await supabaseService
      .from('booking_members')
      .insert({
        booking_id: booking.id,
        name: clientName,
        phone: clientPhone,
        status: 'invite',
        qr_code: generateQrCode(),
        referrer_name: referrerName,
      })
      .select()
      .single();

    if (memberError) throw memberError;

    return NextResponse.json({ booking, member });
  } catch (error: any) {
    console.error('[CreateBooking] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
