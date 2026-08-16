// src/app/api/cron/purge-search-misses-pii/route.ts
// Rétention des données personnelles de search_misses (migration 0054,
// dette notée le 14/08 — voir [[project_bnp_dette_technique]]).
//
// Scope volontairement limité aux lignes porteuses de données personnelles :
// action='notify' (user_email du visiteur) et action='invite'
// (invited_business_name/invited_business_contact, données d'un tiers non
// consentant — voir informed_at dans la migration). Le journal silencieux
// action='none' est explicitement conçu SANS aucune donnée reliable à une
// personne (voir search-misses.ts) — il n'a pas de contrainte RGPD de
// rétention, seulement une valeur commerciale qui grandit avec le temps
// (démarchage), donc volontairement PAS purgé par ce cron.
//
// N=90 jours choisi par défaut ici (pas de décision Pierre au moment
// d'écrire) : delai jugé large pour laisser le temps du démarchage manuel
// via /admin/recherches-vides tout en évitant une conservation indéfinie
// d'un email. À CONFIRMER/AJUSTER — changer SEARCH_MISSES_PII_RETENTION_DAYS
// suffit, aucune autre modification nécessaire.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';

export const SEARCH_MISSES_PII_RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - SEARCH_MISSES_PII_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('search_misses')
    .delete()
    .in('action', ['notify', 'invite'])
    .lt('created_at', cutoff)
    .select('id');

  if (error) {
    console.error('[purge-search-misses-pii] échec de la purge:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deleted = data?.length ?? 0;
  console.log(`[purge-search-misses-pii] ${deleted} ligne(s) 'notify'/'invite' purgée(s) (> ${SEARCH_MISSES_PII_RETENTION_DAYS}j)`);
  return NextResponse.json({ deleted });
}
