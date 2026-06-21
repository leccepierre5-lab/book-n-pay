// src/app/api/loyalty/update-status/route.ts
// Port de base44/functions/calculerStatutFidelite/entry.ts
//
// Appelé après qu'un membre passe au statut 'arrived' (depuis la route qui
// gère le check-in pro). Recalcule le statut de fidélité et les jokers.
//
// ⚠️ CORRECTIF DE SÉCURITÉ (trouvé en audit) : cette route est appelée
// serveur-à-serveur (par cloturerPrestation, checkin-by-qr, update-member)
// mais n'avait aucune protection — n'importe qui connaissant l'URL pouvait
// l'appeler directement avec un memberPhone arbitraire pour créditer des RDV
// honorés et des Jokers sans avoir réellement honoré de rendez-vous.
// Protégée par INTERNAL_API_SECRET, un secret partagé connu uniquement des
// routes serveur (jamais exposé au navigateur, contrairement à
// NEXT_PUBLIC_*). Pense à le définir dans .env.
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

    // ── Récompense de parrainage ──────────────────────────────────────────
    // Déclenchée au PREMIER RDV honoré du parrainé (currentRdv === 1), une
    // seule fois (referral_reward_granted évite tout double crédit en cas
    // de rejeu). Récompense : +5 RDV honorés et +1 Joker pour le parrain ET
    // le parrainé — cohérent avec la promesse affichée dans ParrainageCard
    // ("vous recevez tous les deux +5 RDV honorés et un Joker bonus").
    // ⚠️ Cette récompense n'existait dans AUCUNE fonction Base44 d'origine —
    // le composant promettait une récompense jamais appliquée. Ajoutée ici
    // pour que la promesse affichée au client soit réellement honorée.
    if (currentRdv === 1 && user.referred_by && !user.referral_reward_granted) {
      const { data: referrer } = await supabase
        .from('app_users')
        .select('id, rdv_honores, jokers_disponibles')
        .eq('id', user.referred_by)
        .maybeSingle();

      if (referrer) {
        const REFERRAL_RDV_BONUS = 5;
        const REFERRAL_JOKER_BONUS = 1;

        await supabase
          .from('app_users')
          .update({
            rdv_honores: (referrer.rdv_honores || 0) + REFERRAL_RDV_BONUS,
            jokers_disponibles: (referrer.jokers_disponibles || 0) + REFERRAL_JOKER_BONUS,
          })
          .eq('id', referrer.id);

        await supabase
          .from('app_users')
          .update({
            rdv_honores: currentRdv + REFERRAL_RDV_BONUS,
            jokers_disponibles: jokersDisponibles + REFERRAL_JOKER_BONUS,
            referral_reward_granted: true,
          })
          .eq('id', user.id);

        console.log(`[Parrainage] Récompense créditée — parrain=${referrer.id} parrainé=${user.id}`);
      }
    }

    // Email d'upgrade (branche ton fournisseur email dans sendEmail si besoin)
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
