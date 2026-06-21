// src/lib/queries/pro.ts
// Requêtes pour l'espace pro — s'appuient sur RLS (owns_biz) pour la sécurité,
// donc utilisables directement depuis le client une fois authentifié.
import { createClient } from '@/lib/supabase/server';

export async function getProBookingsForMonth(bizId: string, year: number, month: number) {
  const supabase = await createClient();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
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
}

export async function getProStats(bizId: string): Promise<ProStats> {
  const supabase = await createClient();
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const fromDate = firstOfMonth.toISOString().split('T')[0];

  const { data: bookings } = await supabase
    .from('bookings')
    .select('date, status, booking_members(status, deposit)')
    .eq('biz_id', bizId)
    .gte('date', fromDate);

  let totalRevenue = 0;
  let totalMembers = 0;
  let noShows = 0;
  const today = new Date().toISOString().split('T')[0];
  let upcomingCount = 0;

  for (const b of bookings || []) {
    if (b.date >= today && b.status === 'active') upcomingCount++;
    for (const m of b.booking_members || []) {
      if (m.status === 'paid' || m.status === 'arrived' || m.status === 'no_show') {
        totalMembers++;
        if (m.deposit) totalRevenue += m.deposit;
      }
      if (m.status === 'no_show') noShows++;
    }
  }

  return {
    totalBookings: bookings?.length || 0,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    noShowRate: totalMembers > 0 ? Math.round((noShows / totalMembers) * 100) : 0,
    upcomingCount,
  };
}
