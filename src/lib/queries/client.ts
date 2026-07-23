// src/lib/queries/client.ts
// Requêtes pour l'espace client (hors dashboard pro, voir queries/pro.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/booking-utils';

// "Mes réservations à venir actives" — même définition d'appartenance que
// mes-reservations/page.tsx (client_id organisateur OU téléphone en
// booking_members, les deux formats bruts/normalisés), restreinte aux
// dates futures et aux bookings non annulés (bookings.status != 'cancelled',
// même convention que booking-lifecycle.ts / getProBookingsForMonth).
// Utilisé pour bloquer la suppression de compte tant qu'un engagement est
// en cours (voir api/auth/delete-account/route.ts) — pas pour l'affichage
// complet de "mes réservations", qui veut aussi l'historique et les
// bookings annulés.
export async function getUpcomingActiveBookingIds(
  supabase: SupabaseClient,
  userId: string,
  phone: string | null
): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0];
  const bookingIdSet = new Set<string>();

  if (phone) {
    const normPhone = normalizePhone(phone);
    const phonesFilter =
      phone === normPhone ? `phone.eq.${phone}` : `phone.eq.${phone},phone.eq.${normPhone}`;

    const { data: memberRows } = await supabase
      .from('booking_members')
      .select('booking_id')
      .or(phonesFilter);
    (memberRows ?? []).forEach((r) => bookingIdSet.add(r.booking_id));
  }

  const { data: orgRows } = await supabase.from('bookings').select('id').eq('client_id', userId);
  (orgRows ?? []).forEach((b) => bookingIdSet.add(b.id));

  const allIds = [...bookingIdSet];
  if (allIds.length === 0) return [];

  const { data: upcoming } = await supabase
    .from('bookings')
    .select('id')
    .in('id', allIds)
    .neq('status', 'cancelled')
    .gte('date', today);

  return (upcoming ?? []).map((b) => b.id);
}
