// src/app/api/cron/reset-jokers-annuel/route.ts
// Port de base44/functions/resetJokersAnnuel/entry.ts
// Cron 1er janvier (voir vercel.json) — réinitialise les Jokers selon le
// statut, applique le déclassement minimum annuel (5 RDV/an) pour les
// statuts non-Standard.
//
// ⚠️ La règle de déclassement par inactivité (60j) a été retirée le 21/08
// (décision Pierre, CGU art. 4.4 supprimé) : un client inactif conserve
// désormais son statut, ses Jokers et son historique — seule cette
// réinitialisation annuelle (Jokers + règle des 5 RDV/an, art. 4.3) subsiste.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';
import { JOKERS_LIMITES } from '@/lib/booking-utils';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

const DOWNGRADE: Record<string, string> = { Gold: 'Argent', Argent: 'Bronze', Bronze: 'Standard' };
const MIN_RDV_ANNUEL = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const { data: users } = await supabase.from('app_users').select('id, name, phone, statut, derniere_activite');

  let reset = 0;
  let degraded = 0;
  const readFailures: string[] = [];

  for (const user of users || []) {
    const statut = user.statut || 'Standard';
    const derniereActivite = user.derniere_activite || '';
    let statutFinal = statut;

    if (statut !== 'Standard' && derniereActivite < oneYearAgo) {
      // ⚠️ Une erreur de requête ne doit JAMAIS entraîner un déclassement —
      // trouvé le 13/08 (incident pro_charges/0041, même motif) : l'ancien
      // code faisait `count || 0`, indiscernable d'un vrai "0 RDV" sur un
      // échec de requête. Un client fidèle ne doit jamais être sanctionné
      // sur la base d'une erreur technique. En cas d'échec : on ne touche
      // pas au statut de CE client, on alerte, et le cron continue pour
      // les autres.
      const { count, error: countError } = await supabase
        .from('booking_members')
        .select('id, bookings!inner(date)', { count: 'exact', head: true })
        .eq('phone', user.phone)
        .eq('status', 'arrived')
        .gte('bookings.date', oneYearAgo);

      if (countError) {
        console.error(`[Reset 1er jan] Comptage RDV échoué pour ${user.name} (${user.id}) — statut NON modifié par prudence:`, countError.message);
        readFailures.push(`${user.name} (${user.id}) — ${countError.message}`);
      } else {
        const rdvRecents = count ?? 0;
        if (rdvRecents < MIN_RDV_ANNUEL) {
          statutFinal = DOWNGRADE[statut] || 'Standard';
          degraded++;
          console.log(`[Reset 1er jan] Déclassement min RDV ${user.name}: ${statut} → ${statutFinal} (${rdvRecents} RDV/an)`);
        }
      }
    }

    const newJokers = JOKERS_LIMITES[statutFinal] || 1;
    const rdvUpdate = statutFinal === 'Standard' && statut !== 'Standard' ? { rdv_honores: 0 } : {};

    await supabase
      .from('app_users')
      .update({
        jokers_disponibles: newJokers,
        jokers_utilises: 0,
        statut: statutFinal,
        ...rdvUpdate,
      })
      .eq('id', user.id);

    reset++;
  }

  if (readFailures.length > 0) {
    await notifyAdminOnFailure('cron/reset-jokers-annuel:rdv-count', {
      processed: reset - readFailures.length,
      failed: readFailures.length,
      failedItems: readFailures,
      failedDescriptions: readFailures.map((f) => `vérification min. RDV/an ignorée, statut inchangé par prudence — ${f}`),
    });
  }

  console.log(`[resetJokersAnnuel] ${reset} utilisateurs réinitialisés, ${degraded} déclassés, ${readFailures.length} vérification(s) échouée(s) (statut non modifié)`);
  return NextResponse.json({ success: true, reset, degraded, readFailures: readFailures.length });
}
