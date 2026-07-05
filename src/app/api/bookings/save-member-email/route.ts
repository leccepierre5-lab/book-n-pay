import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';

export async function PATCH(req: NextRequest) {
  try {
    // memberId n'est pas lié à une session (participants invités sans compte) —
    // le rate limit borne le brute-force d'IDs plutôt que de bloquer l'accès légitime.
    const { allowed } = await checkRateLimit(`save-member-email:${getClientIp(req)}`, 20, 10 * 60);
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
      .select('email, status')
      .eq('id', memberId)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
    }

    // Ne pas écraser si le membre a déjà payé (email définitif fourni par Stripe)
    if (member.status === 'paid' || member.status === 'arrived') {
      return NextResponse.json({ saved: false, reason: 'already_paid' });
    }

    await supabase
      .from('booking_members')
      .update({ email: email.trim().toLowerCase() })
      .eq('id', memberId);

    return NextResponse.json({ saved: true });
  } catch (err: any) {
    return logAndRespond('[SaveMemberEmail] Erreur:', err);
  }
}
