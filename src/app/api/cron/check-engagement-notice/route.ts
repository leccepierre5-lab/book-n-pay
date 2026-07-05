// src/app/api/cron/check-engagement-notice/route.ts
// Loi Chatel — preavis de fin d'engagement (voir plans-config.ts:52-54).
//
// DRY-RUN UNIQUEMENT : detecte les abonnements pro entrant dans la fenetre de
// preavis et LOGGE le resultat (console + reponse JSON). N'envoie AUCUN
// email — le texte legal du preavis n'est pas encore valide juridiquement.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';
import { getParisDateOffsetStr } from '@/lib/booking-utils';
import { ENGAGEMENT_NOTICE_DAYS } from '@/lib/plans-config';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const todayUTC = new Date(getParisDateOffsetStr(0) + 'T00:00:00Z').getTime();

  const { data: rows } = await supabase
    .from('business_settings')
    .select('biz_id, plan_key, subscription_status, engagement_end_date')
    .eq('subscription_status', 'active')
    .not('engagement_end_date', 'is', null);

  const inNoticeWindow: {
    bizId: string;
    bizName: string;
    planKey: string;
    engagementEndDate: string;
    daysRemaining: number;
  }[] = [];

  for (const row of rows ?? []) {
    const endUTC = new Date(row.engagement_end_date + 'T00:00:00Z').getTime();
    const daysRemaining = Math.round((endUTC - todayUTC) / (1000 * 60 * 60 * 24));

    // Fenetre "devrait deja avoir recu son preavis" : entre la fin
    // d'engagement (0) et le seuil ENGAGEMENT_NOTICE_DAYS (30). Volontairement
    // un intervalle plutot qu'une egalite stricte pour rester robuste si le
    // cron rate un jour d'execution (meme logique que verifier-inactivite).
    if (daysRemaining < 0 || daysRemaining > ENGAGEMENT_NOTICE_DAYS) continue;

    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', row.biz_id)
      .maybeSingle();

    const entry = {
      bizId: row.biz_id,
      bizName: business?.name || 'Inconnu',
      planKey: row.plan_key,
      engagementEndDate: row.engagement_end_date,
      daysRemaining,
    };
    inNoticeWindow.push(entry);
    console.log(
      `[ChatelNotice] ${entry.bizName} (${entry.bizId}) — plan ${entry.planKey}, fin d'engagement ${entry.engagementEndDate}, J-${entry.daysRemaining}`
    );
  }

  // TODO: activer l'envoi email ici une fois le texte Chatel valide
  // juridiquement par Pierre. Ex: pour chaque entree de `inNoticeWindow`,
  // recuperer l'email du pro (supabase.auth.admin.getUserById via l'id
  // app_users lie a biz_id) et sendEmail({ to, subject, html: emailTemplate(...) }).
  //
  // ATTENTION avant d'activer l'envoi : la fenetre ci-dessus (0 <= daysRemaining
  // <= ENGAGEMENT_NOTICE_DAYS) detecte le MEME pro chaque jour pendant toute la
  // periode de preavis (jusqu'a 31 executions quotidiennes du cron). En dry-run
  // c'est un log repete, sans consequence. Une fois l'envoi d'email active, ce
  // sera un email par jour au meme pro sauf ajout d'un flag anti-repetition
  // (ex: colonne `notice_sent_at` sur business_settings, mise a jour au premier
  // envoi et verifiee ici pour ne plus redeclencher) — ne PAS activer l'envoi
  // sans ce garde-fou.

  return NextResponse.json({
    success: true,
    checked: rows?.length ?? 0,
    inNoticeWindow: inNoticeWindow.length,
    businesses: inNoticeWindow,
  });
}
