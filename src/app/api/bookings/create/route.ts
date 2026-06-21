// src/app/api/bookings/create/route.ts
// Crée le booking + son premier booking_member (statut 'invite') avant
// paiement. Le statut passera à 'paid' via le webhook Stripe une fois le
// paiement confirmé (cohérent avec le flow Base44 : create booking → checkout
// → webhook met à jour members[].status).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateQrCode } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();

    const body = await req.json();
    const { bizId, bizName, serviceId, serviceName, staffId, staffName, date, time, clientName, clientPhone, clientEmail } = body;

    if (!bizId || !serviceId || !date || !time) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    // Empêche toute nouvelle réservation chez un établissement gelé par
    // l'admin — sans ce contrôle, le gel n'aurait d'effet que rétroactif
    // (annulation des résas existantes) mais n'empêcherait pas d'en créer
    // de nouvelles juste après.
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

    const { data: booking, error: bookingError } = await supabase
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

    const { data: member, error: memberError } = await supabase
      .from('booking_members')
      .insert({
        booking_id: booking.id,
        name: clientName,
        phone: clientPhone,
        status: 'invite',
        qr_code: generateQrCode(),
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
