import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { sendEmail, emailTemplate } from '@/lib/email/send';

export async function PATCH(req: NextRequest) {
  try {
    // memberId n'est pas lié à une session (participants invités sans compte,
    // parcours groupe intentionnellement anonyme — le lien /pay/[memberId]
    // partagé par l'organisateur EST la preuve d'appartenance, comme un lien
    // Doodle/Drive : voir docs/memory sur le modèle de sécurité du parcours
    // groupe, revu le 18/08). Resserré (était 20/10min) après l'audit du
    // 18/08 : rejouer cet appel plusieurs fois ne coûte rien à un appelant
    // qui a obtenu un memberId par une voie qui ne lui était pas destinée
    // (ex. lien collé dans un fil de discussion partagé par l'organisateur).
    const { allowed } = await checkRateLimit(`save-member-email:${getClientIp(req)}`, 5, 15 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const { memberId, email } = await req.json();

    if (!memberId || typeof memberId !== 'string') {
      return NextResponse.json({ error: 'memberId requis' }, { status: 400 });
    }

    // Email optionnel — si vide, on ignore silencieusement
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ saved: false });
    }

    const supabase = createServiceRoleClient();

    // Ne pas écraser un email déjà enregistré par le webhook (paiement confirmé)
    const { data: member } = await supabase
      .from('booking_members')
      .select('email, status, name, bookings(biz_name, date, time)')
      .eq('id', memberId)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
    }

    // Ne pas écraser si le membre a déjà payé (email définitif fourni par Stripe)
    if (member.status === 'paid' || member.status === 'arrived') {
      return NextResponse.json({ saved: false, reason: 'already_paid' });
    }

    const oldEmail = member.email;
    const newEmail = email.trim().toLowerCase();

    await supabase
      .from('booking_members')
      .update({ email: newEmail })
      .eq('id', memberId);

    // Alerte à l'ANCIENNE adresse en cas de changement — décision du 18/08 :
    // verrouiller l'email casserait le cas légitime (invité qui corrige une
    // faute de frappe) sans fermer le vrai risque (l'attaquant qui arrive en
    // premier peut de toute façon payer/annuler avec le même memberId, ce
    // n'est pas spécifique à cette route). Rendre le changement visible est
    // la protection qui reste : les 3 conditions comptent — jamais à la
    // PREMIÈRE définition (oldEmail vide, rien à notifier), jamais si
    // l'email ne change pas réellement, et le message ne révèle JAMAIS la
    // nouvelle adresse (sinon cet email devient lui-même un outil de
    // reconnaissance pour l'attaquant qui voudrait confirmer sa propre
    // adresse a bien été acceptée).
    if (oldEmail && oldEmail !== newEmail) {
      const booking = (member as any).bookings;
      sendEmail({
        to: oldEmail,
        subject: "Book'nPay — l'email associé à votre réservation a changé",
        html: emailTemplate(`
          <h2 style="color: #34d399; font-size: 18px; margin: 0 0 12px;">Changement d'adresse email</h2>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
            L'adresse email associée à votre réservation${booking?.biz_name ? ` chez ${booking.biz_name}` : ''}
            a été modifiée. Cette adresse (${oldEmail}) ne recevra plus les notifications de ce rendez-vous.
          </p>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.6; margin: 0;">
            Si vous n'êtes pas à l'origine de ce changement, contactez-nous rapidement en répondant à cet email.
          </p>
        `),
      }).catch((err) => {
        console.error('[SaveMemberEmail] Échec envoi alerte changement email:', err);
      });
    }

    return NextResponse.json({ saved: true });
  } catch (err: any) {
    return logAndRespond('[SaveMemberEmail] Erreur:', err);
  }
}
