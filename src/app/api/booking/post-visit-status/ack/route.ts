// src/app/api/booking/post-visit-status/ack/route.ts
// Marque un booking_member comme "popup post-visite vu" — appelé par le
// client uniquement quand PostVisitPopup affiche réellement le popup (pas à
// chaque poll de vérification, voir ../route.ts). Vérifie que le membre visé
// appartient bien à l'appelant (même correspondance téléphone que le GET),
// pour empêcher un utilisateur connecté de marquer "vu" le popup de
// quelqu'un d'autre en devinant un memberId.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { phonesMatch } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const { memberId } = await req.json();
  if (!memberId) {
    return NextResponse.json({ error: 'memberId requis' }, { status: 400 });
  }

  const supabaseAdmin = createServiceRoleClient();

  const { data: profile } = await supabaseAdmin
    .from('app_users')
    .select('phone')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.phone) {
    return NextResponse.json({ error: 'Profil incomplet' }, { status: 403 });
  }

  const { data: member } = await supabaseAdmin
    .from('booking_members')
    .select('id, phone')
    .eq('id', memberId)
    .maybeSingle();

  if (!member || !phonesMatch(member.phone, profile.phone)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
  }

  await supabaseAdmin
    .from('booking_members')
    .update({ post_visit_popup_shown: true })
    .eq('id', memberId);

  return NextResponse.json({ ok: true });
}
