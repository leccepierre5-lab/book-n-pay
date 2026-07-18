// src/app/api/bookings/update-member/route.ts
// Port de base44/functions/updateBookingMember/entry.ts
// Utilisée par le pro pour le check-in (statut → 'arrived') ou marquer un
// no-show manuel. Déclenche le recalcul de fidélité quand un membre arrive.
//
// ⚠️ CORRECTIFS DE SÉCURITÉ (trouvés en audit) :
// 1. RLS autorise le créateur d'un booking à modifier ses propres
//    booking_members (légitime pour annuler sa propre réservation), mais
//    ne distingue pas QUEL champ peut être changé par qui. Un client
//    aurait pu appeler cette route avec `{ status: 'arrived' }` sur sa
//    propre réservation pour déclencher la récompense fidélité sans
//    s'être présenté.
// 2. Plus largement, la route passait `updates` (objet arbitraire reçu du
//    body) directement à `.update()` sans filtrage de champs. Même avec la
//    vérification de rôle sur `status`, un appelant aurait pu glisser
//    d'autres champs (`deposit`, `joker_applique`, `montant_rembourse`...)
//    dans le même body sans aucun contrôle.
// Corrigé en n'acceptant qu'une whitelist explicite de champs, et en
// exigeant le rôle pro/admin dès que le statut visé est 'arrived'/'no_show'.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

const PRO_ONLY_STATUSES = ['arrived', 'no_show'];
const ALLOWED_FIELDS = ['status'] as const;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bookingId, memberId, updates } = await req.json();

    if (!bookingId || !memberId || !updates) {
      return NextResponse.json({ error: 'bookingId, memberId et updates requis' }, { status: 400 });
    }

    // Whitelist stricte : seuls les champs listés sont retenus, le reste du
    // body (même envoyé par un appelant malveillant) est ignoré.
    const safeUpdates: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (updates[field] !== undefined) safeUpdates[field] = updates[field];
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: 'Aucun champ valide à mettre à jour' }, { status: 400 });
    }

    if (safeUpdates.status && PRO_ONLY_STATUSES.includes(safeUpdates.status as string)) {
      const { data: callerProfile } = await supabase
        .from('app_users')
        .select('role')
        .eq('id', authData.user.id)
        .single();
      if (callerProfile?.role !== 'pro' && callerProfile?.role !== 'admin') {
        return NextResponse.json(
          { error: 'Seul le professionnel peut marquer une présence ou une absence' },
          { status: 403 }
        );
      }
    }

    const { data: previousMember } = await supabase
      .from('booking_members')
      .select('status, phone')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();

    const { data: updatedMember, error } = await supabase
      .from('booking_members')
      .update(safeUpdates)
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .select()
      .single();

    if (error) throw error;

    if (safeUpdates.status === 'arrived' && previousMember?.status !== 'arrived' && previousMember?.phone) {
      fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app'}/api/loyalty/update-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({ memberPhone: previousMember.phone }),
      }).catch((e) => console.warn('[updateBookingMember] Échec appel fidélité:', e));
    }

    return NextResponse.json({ success: true, member: updatedMember });
  } catch (error: any) {
    return logAndRespond('[updateBookingMember] Erreur:', error);
  }
}
