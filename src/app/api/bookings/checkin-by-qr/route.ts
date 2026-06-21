// src/app/api/bookings/checkin-by-qr/route.ts
// Retrouve un booking_member par son qr_code et le marque 'arrived'.
// Le pro scanne le QR du client à l'accueil.
//
// ⚠️ CORRECTIF DE SÉCURITÉ (trouvé en audit) : la route ne vérifiait que la
// présence d'une session, jamais que l'appelant était bien un pro/admin —
// RLS aurait laissé un CLIENT authentifié connaissant son propre QR code
// s'auto-check-in lui-même (puisque RLS autorise déjà le créateur du
// booking à lire/modifier ses propres booking_members), déclenchant la
// récompense fidélité sans s'être réellement présenté. Corrigé en exigeant
// explicitement le rôle pro ou admin avant toute action.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: callerProfile } = await supabase
      .from('app_users')
      .select('role')
      .eq('id', authData.user.id)
      .single();

    if (callerProfile?.role !== 'pro' && callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Réservé aux professionnels' }, { status: 403 });
    }

    const { qrCode } = await req.json();
    if (!qrCode) return NextResponse.json({ error: 'qrCode requis' }, { status: 400 });

    const { data: member } = await supabase
      .from('booking_members')
      .select('*, bookings(id, biz_name, service_name, date, time, biz_id)')
      .eq('qr_code', qrCode)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: 'QR code introuvable ou non autorisé' }, { status: 404 });
    }

    if (member.status === 'arrived') {
      return NextResponse.json({ alreadyCheckedIn: true, member });
    }

    if (member.status !== 'paid') {
      return NextResponse.json(
        { error: `Ce membre a le statut "${member.status}", check-in impossible.` },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from('booking_members')
      .update({ status: 'arrived' })
      .eq('id', member.id)
      .select()
      .single();

    if (error) throw error;

    if (member.phone) {
      fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/loyalty/update-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({ memberPhone: member.phone }),
      }).catch((e) => console.warn('[CheckinByQR] Échec appel fidélité:', e));
    }

    return NextResponse.json({ success: true, member: updated, booking: member.bookings });
  } catch (error: any) {
    console.error('[CheckinByQR] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
