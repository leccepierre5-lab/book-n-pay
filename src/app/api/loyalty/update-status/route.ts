// src/app/api/loyalty/update-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeStatut } from '@/lib/booking-utils';

const UPGRADE_MESSAGES: Record<string, { subject: string; body: string }> = {
  Bronze: {
    subject: '🥉 Bravo ! Vous êtes désormais membre Bronze',
    body: "Grâce à votre fidélité, vous bénéficiez maintenant d'une garantie 100% sérénité : votre premier imprévu de l'année est désormais couvert par votre Joker !",
  },
  Argent: {
    subject: '🥈 Félicitations, vous accédez au statut Argent !',
    body: 'Vous faites partie de nos clients les plus fiables. En récompense, vous doublez votre protection avec 2 Jokers annuels.',
  },
  Gold: {
    subject: '🏆 Statut Gold atteint !',
    body: "Votre fidélité est récompensée. Vous gardez votre statut Gold à vie tant que vous restez actif. Vos 3 Jokers annuels se réinitialisent chaque 1er janvier.",
  },
};

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const { memberPhone } = await req.json();

    if (!memberPhone) {
      return NextResponse.json({ error: 'memberPhone requis' }, { status: 400 });
    }

    const { data: user } = await supabase
      .from('app_users')
      .select('*')
      .eq('phone', memberPhone)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ skipped: true, reason: 'Utilisateur non trouvé' });
    }

    const oldStatut = user.statut || 'Standard';
    const currentRdv = (user.rdv_honores || 0) + 1;
    const { statut: newStatut, jokers: jokersDuStatut } = computeStatut(currentRdv);
    const upgraded = newStatut !== oldStatut;
    const jokersDisponibles = upgraded ? jokersDuStatut : (user.jokers_disponibles ?? jokersDuStatut);

    await supabase
      .from('app_users')
      .update({
        rdv_honores: currentRdv,
        statut: newStatut,
        jokers_disponibles: jokersDisponibles,
        derniere_activite: new Date().toISOString().split('T')[0],
      })
      .eq('id', user.id);

    // ── Récompense de parrainage ──────────────────────────────────────────────
    // Déclenchée au PREMIER RDV honoré du parrainé (referral_reward_granted évite
    // le double crédit pour ce même parrainé). Le parrain peut en revanche recevoir
    // une nouvelle récompense pour chaque parrainé différent (B, C, D…).
    if (currentRdv === 1 && user.referred_by && !user.referral_reward_granted) {
      const { data: referrer } = await supabase
        .from('app_users')
        .select('id, rdv_honores, jokers_disponibles')
        .eq('id', user.referred_by)
        .maybeSingle();

      if (referrer) {
        // Parrain : -20% sur sa prochaine prestation
        await supabase
          .from('app_users')
          .update({ pending_referral_discount_pct: 20 })
          .eq('id', referrer.id);

        // Parrainé : -10% unique + marqué comme récompensé
        await supabase
          .from('app_users')
          .update({
            referral_reward_granted: true,
            pending_referral_discount_pct: 10,
          })
          .eq('id', user.id);

        // Historique parrainage (1 ligne par parrainage réussi)
        await supabase.from('referral_events').insert({
          referrer_id: referrer.id,
          referred_id: user.id,
        });

        console.log(`[Parrainage] Récompense créditée — parrain=${referrer.id} parrainé=${user.id} | -20% parrain, -10% parrainé`);
      }
    }

    if (upgraded) {
      const msg = UPGRADE_MESSAGES[newStatut];
      console.log(`[Fidélité] ${user.name} : ${oldStatut} → ${newStatut} (email à envoyer: ${!!msg})`);
    }

    return NextResponse.json({
      success: true,
      oldStatut,
      newStatut,
      rdvHonores: currentRdv,
      jokersDisponibles,
      upgraded,
    });
  } catch (error: any) {
    console.error('[Fidélité] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
