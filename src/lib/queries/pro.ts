// src/lib/queries/pro.ts
// Requêtes pour l'espace pro — s'appuient sur RLS (owns_biz) pour la sécurité,
// donc utilisables directement depuis le client une fois authentifié.
import { createClient } from '@/lib/supabase/server';
import { isCreatedOffHours, type BizHoraires } from '@/lib/booking-utils';

export async function getProBookingsForMonth(bizId: string, year: number, month: number) {
  const supabase = await createClient();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_members(*), services(price)')
    .eq('biz_id', bizId)
    .gte('date', from)
    .lte('date', to)
    .neq('status', 'cancelled');

  if (error) {
    console.error('[getProBookingsForMonth]', error.message);
    return [];
  }
  return data || [];
}

export async function getProBookings(bizId: string, opts: { from?: string; to?: string } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from('bookings')
    .select('*, booking_members(*), services(name, price, deposit)')
    .eq('biz_id', bizId)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (opts.from) query = query.gte('date', opts.from);
  if (opts.to) query = query.lte('date', opts.to);

  const { data, error } = await query;
  if (error) {
    console.error('[getProBookings]', error.message);
    return [];
  }
  return data || [];
}

export async function getProProfile() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('*, businesses!fk_app_users_biz(*)')
    .eq('id', authData.user.id)
    .maybeSingle();

  return profile;
}

export async function getBusinessSettings(bizId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('business_settings')
    .select('*')
    .eq('biz_id', bizId)
    .maybeSingle();

  if (error) {
    console.error('[getBusinessSettings]', error.message);
    return null;
  }
  return data;
}

export interface ProStats {
  totalBookings: number;
  totalRevenue: number;
  noShowRate: number;
  upcomingCount: number;
  // "Ce que Book'nPay vous apporte" (19/07) — volontairement factuels, pas de
  // chiffre spéculatif (ex. "temps gagné" écarté faute de vraie mesure).
  depositSecuredCount: number;   // nb de RDV avec acompte réellement encaissé, CUMUL depuis l'inscription
  depositSecuredAmount: number;  // idem en €. Portée volontairement différente de totalRevenue (mois
                                  // courant) — un cumul depuis l'inscription, pas le même chiffre sous
                                  // un autre nom (relecture 19/07 : le doublon nuisait à la crédibilité
                                  // du bloc "valeur" au moment où elle compte le plus).
  offHoursBookingsCount: number; // RDV RÉSERVÉS (created_at) hors jour/heure d'ouverture ce mois
}

export async function getProStats(bizId: string, biz: BizHoraires): Promise<ProStats> {
  const supabase = await createClient();
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const fromDate = firstOfMonth.toISOString().split('T')[0];
  // Borne haute ajoutée (audit 19/07) : sans elle, "CA ce mois"/"Réservations"
  // incluaient aussi tout RDV pris à l'avance pour un mois futur — grossit
  // avec le volume ET fausse le libellé "ce mois".
  const lastOfMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0);
  const toDate = lastOfMonth.toISOString().split('T')[0];

  const { data: bookings } = await supabase
    .from('bookings')
    .select('date, status, created_at, booking_members(status, deposit)')
    .eq('biz_id', bizId)
    .gte('date', fromDate)
    .lte('date', toDate);

  let totalRevenue = 0;
  let totalMembers = 0;
  let noShows = 0;
  let offHoursBookingsCount = 0;

  for (const b of bookings || []) {
    if (b.status !== 'cancelled' && isCreatedOffHours(b.created_at, biz)) offHoursBookingsCount++;
    for (const m of b.booking_members || []) {
      if (m.status === 'paid' || m.status === 'arrived' || m.status === 'no_show') {
        totalMembers++;
        if (m.deposit) totalRevenue += m.deposit;
      }
      if (m.status === 'no_show') noShows++;
    }
  }

  // "À venir" reste volontairement sans borne haute (tout RDV futur compte,
  // peu importe le mois) — requête count-only séparée pour ne pas re-élargir
  // la requête ci-dessus, qui doit rester bornée au mois courant.
  const today = new Date().toISOString().split('T')[0];
  const { count: upcomingCount } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('biz_id', bizId)
    .gte('date', today)
    .neq('status', 'cancelled');

  const totalRevenueRounded = Math.round(totalRevenue * 100) / 100;

  // Cumul depuis l'inscription (pas de borne de date, volontaire) — requête
  // séparée et minimale (une seule colonne) pour ne pas répéter le coût d'un
  // `select('*')` sur tout l'historique. Candidat à une vraie agrégation SQL
  // (vue/RPC SUM) si le volume devient un sujet un jour ; suffisant en l'état.
  const { data: depositRows } = await supabase
    .from('booking_members')
    .select('deposit, bookings!inner(biz_id)')
    .eq('bookings.biz_id', bizId)
    .in('status', ['paid', 'arrived', 'no_show']);

  const depositSecuredCount = depositRows?.length || 0;
  const depositSecuredAmount = Math.round(
    (depositRows || []).reduce((sum, r) => sum + (r.deposit || 0), 0) * 100
  ) / 100;

  return {
    totalBookings: bookings?.length || 0,
    totalRevenue: totalRevenueRounded,
    noShowRate: totalMembers > 0 ? Math.round((noShows / totalMembers) * 100) : 0,
    upcomingCount: upcomingCount || 0,
    depositSecuredCount,
    depositSecuredAmount,
    offHoursBookingsCount,
  };
}
