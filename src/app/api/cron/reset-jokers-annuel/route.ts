// src/app/api/cron/reset-jokers-annuel/route.ts
// Port de base44/functions/resetJokersAnnuel/entry.ts
// Cron 1er janvier (voir vercel.json) — réinitialise les Jokers selon le
// statut, applique le déclassement par inactivité (60j) ou minimum annuel
// (5 RDV/an) pour les statuts non-Standard.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';
import { JOKERS_LIMITES } from '@/lib/booking-utils';

const DOWNGRADE: Record<string, string> = { Gold: 'Argent', Argent: 'Bronze', Bronze: 'Standard' };
const MIN_RDV_ANNUEL = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const { data: users } = await supabase.from('app_users').select('*');

  let reset = 0;
  let degraded = 0;

  for (const user of users || []) {
    const statut = user.statut || 'Standard';
    const derniereActivite = user.derniere_activite || '';
    let statutFinal = statut;

    if (statut !== 'Standard' && derniereActivite) {
      const dernier = new Date(derniereActivite);
      const joursInactivite = Math.floor((Date.now() - dernier.getTime()) / (1000 * 60 * 60 * 24));
      if (joursInactivite >= 60) {
        statutFinal = 'Standard';
        degraded++;
        console.log(`[Reset 1er jan] Déclassement inactivité ${user.name}: ${statut} → Standard (${joursInactivite}j)`);
      }
    }

    if (statutFinal !== 'Standard' && statut !== 'Standard' && derniereActivite < oneYearAgo) {
      const { count } = await supabase
        .from('booking_members')
        .select('id, bookings!inner(date)', { count: 'exact', head: true })
        .eq('phone', user.phone)
        .eq('status', 'arrived')
        .gte('bookings.date', oneYearAgo);

      const rdvRecents = count || 0;

      if (rdvRecents < MIN_RDV_ANNUEL) {
        statutFinal = DOWNGRADE[statut] || 'Standard';
        degraded++;
        console.log(`[Reset 1er jan] Déclassement min RDV ${user.name}: ${statut} → ${statutFinal} (${rdvRecents} RDV/an)`);
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

  console.log(`[resetJokersAnnuel] ${reset} utilisateurs réinitialisés, ${degraded} déclassés`);
  return NextResponse.json({ success: true, reset, degraded });
}
