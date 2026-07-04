// src/app/api/bookings/cloturer-prestation/route.ts
// Port de base44/functions/cloturerPrestation/entry.ts
// Marque la prestation comme honorée (arrived) avec le mode de paiement du
// solde choisi par le pro (app/tpe/especes), et envoie un email de reçu.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, escapeHtml } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';

const MODE_LABEL: Record<string, string> = {
  app: "via l'application Book'nPay",
  tpe: 'par carte bancaire (TPE)',
  especes: 'en espèces',
};
const MODE_EMOJI: Record<string, string> = { app: '📱', tpe: '💳', especes: '💵' };

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bookingId, memberId, paymentMode } = await req.json();
    if (!bookingId || !memberId || !paymentMode) {
      return NextResponse.json({ error: 'bookingId, memberId et paymentMode requis' }, { status: 400 });
    }

    const serviceSupabase = createServiceRoleClient();
    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role, biz_id')
      .eq('id', authData.user.id)
      .single();
    if (profile?.role !== 'admin' && profile?.biz_id !== booking.biz_id) {
      return NextResponse.json({ error: 'Non autorisé pour ce business' }, { status: 403 });
    }

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('*')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });

    await serviceSupabase
      .from('booking_members')
      .update({ status: 'arrived', payment_mode: paymentMode })
      .eq('id', memberId);

    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `Prestation clôturée — paiement ${paymentMode}`,
    });

    if (member.phone) {
      fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/loyalty/update-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({ memberPhone: member.phone }),
      }).catch((e) => console.warn('[Clôture] Échec appel fidélité:', e));
    }

    const clientEmail = member.phone === booking.client_phone ? booking.client_email : null;
    let emailSent = false;

    if (clientEmail) {
      const result = await sendEmail({
        to: clientEmail,
        subject: `✅ Prestation clôturée — ${booking.service_name} chez ${booking.biz_name}`,
        html: `<div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <div style="background: linear-gradient(135deg, #059669, #10b981); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
    <p style="font-size: 40px; margin: 0;">✅</p>
    <h2 style="color: white; margin: 8px 0 4px; font-size: 20px;">Prestation confirmée</h2>
  </div>
  <p style="font-size: 15px; color: #2A2A3A;">Bonjour <strong>${escapeHtml(member.name)}</strong>, votre prestation chez <strong>${escapeHtml(booking.biz_name)}</strong> a bien été clôturée.</p>
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0;">
    <p style="font-size: 13px; color: #7A7A8C; margin: 4px 0;">Prestation : <strong style="color:#0D0D14;">${escapeHtml(booking.service_name)}</strong></p>
    <p style="font-size: 13px; color: #7A7A8C; margin: 4px 0;">Date : <strong style="color:#0D0D14;">${booking.date} à ${booking.time}</strong></p>
    <p style="font-size: 13px; color: #7A7A8C; margin: 4px 0;">Mode de paiement : <strong style="color:#059669;">${MODE_EMOJI[paymentMode]} ${MODE_LABEL[paymentMode]}</strong></p>
  </div>
  <p style="font-size: 12px; color: #7A7A8C; text-align: center;">Merci d'avoir utilisé Book'nPay 🙏</p>
</div>`,
      });
      emailSent = result.sent;
    }

    return NextResponse.json({ success: true, paymentMode, emailSent });
  } catch (error: any) {
    return logAndRespond('[Clôture] Erreur:', error);
  }
}
