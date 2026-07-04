// src/app/api/bookings/checkin-by-qr/route.ts
// Retrouve un booking_member par son qr_code et le marque 'arrived'.
// Le pro scanne le QR du client à l'accueil.
//
// ⚠️ CORRECTIFS DE SÉCURITÉ (audit) :
// 1. La route ne vérifiait que la présence d'une session, jamais que l'appelant
//    était bien un pro/admin — un CLIENT pouvait s'auto-check-in avec son propre
//    QR code, déclenchant la récompense fidélité sans s'être présenté.
//    Corrigé : rôle pro/admin exigé.
// 2. Un pro d'un établissement A pouvait checker un client de l'établissement B
//    s'il connaissait son QR code (UUID non-devinable mais absence de contrôle
//    explicite). Corrigé : vérification biz_id du pro == biz_id du booking.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // SECURITY_TODO.md #3 — qr_code = 6 chiffres (1M combinaisons),
    // brute-forçable sans limite. Rate limit par compte pro/admin appelant,
    // assez large pour un scan rapide en rafale à l'accueil.
    const { allowed } = await checkRateLimit(`checkin-by-qr:${authData.user.id}`, 30, 5 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, patiente quelques minutes.' }, { status: 429 });
    }

    const { data: callerProfile } = await supabase
      .from('app_users')
      .select('role, biz_id')
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

    // Un pro ne peut checker que les clients de son propre établissement.
    const bookingBizId = (member.bookings as any)?.biz_id;
    if (callerProfile?.role === 'pro' && callerProfile.biz_id !== bookingBizId) {
      return NextResponse.json({ error: 'QR code introuvable ou non autorisé' }, { status: 403 });
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
    return logAndRespond('[CheckinByQR] Erreur:', error);
  }
}
