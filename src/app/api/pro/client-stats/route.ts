// src/app/api/pro/client-stats/route.ts
// Alimente FicheClientIntelligente.tsx : historique de fiabilité d'un client
// (par téléphone) + son profil fidélité (statut, jokers, RDV honorés).
// Réservé aux pros (RLS sur booking_members suit la visibilité du booking,
// donc un pro ne voit que les RDV passés avec SON business — c'est volontaire,
// le score reflète la fiabilité du client CHEZ CE PRO, pas en absolu).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { normalizePhone } from '@/lib/booking-utils';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const rawPhone = searchParams.get('phone');
    if (!rawPhone) return NextResponse.json({ error: 'phone requis' }, { status: 400 });
    // Aujourd'hui toujours une valeur déjà en base (member.phone, voir
    // FicheClientIntelligente.tsx), donc déjà normalisée après 0059/0060 —
    // normalisé quand même pour ne pas dépendre silencieusement de ça si un
    // futur appelant passe un numéro saisi à la main.
    const phone = normalizePhone(rawPhone);

    const { data: profile } = await supabase
      .from('app_users')
      .select('biz_id, role')
      .eq('id', authData.user.id)
      .single();
    if (!profile?.biz_id && profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    let query = supabase
      .from('booking_members')
      .select('status, bookings!inner(biz_id)')
      .eq('phone', phone);

    if (profile?.role !== 'admin') {
      query = query.eq('bookings.biz_id', profile!.biz_id);
    }

    const { data: memberRows } = await query;

    const relevant = (memberRows || []).filter((m: any) => m.status !== 'invite' && m.status !== 'cancelled');
    const total = relevant.length;
    const noShow = relevant.filter((m: any) => m.status === 'no_show').length;
    const score = total > 0 ? Math.round(((total - noShow) / total) * 100) : 100;

    const { data: appUser } = await supabase
      .from('app_users')
      .select('statut, jokers_disponibles, jokers_utilises, rdv_honores')
      .eq('phone', phone)
      .maybeSingle();

    return NextResponse.json({
      stats: { total, noShow, score },
      appUser: appUser || null,
    });
  } catch (error: any) {
    return logAndRespond('[ClientStats] Erreur:', error);
  }
}
