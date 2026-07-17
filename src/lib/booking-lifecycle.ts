// src/lib/booking-lifecycle.ts
// bookings.status et booking_members.status sont deux champs distincts,
// jamais synchronisés automatiquement : annuler UN membre (bookings/cancel,
// pro/refund-gesture) ne touchait jamais bookings.status, laissant le
// créneau occupé pour toujours — ni dans l'agenda pro (/api/pro/agenda,
// getProBookings), ni dans l'anti-collision réelle (staff-assignment.ts +
// la fonction Postgres assign_staff_and_create_booking, migration 0028),
// qui filtrent TOUTES les deux sur bookings.status != 'cancelled' sans
// jamais regarder booking_members. Trouvé en auditant le dashboard pro
// (17/07), confirmé en base : un membre remboursé + cancelled ne libérait
// jamais son créneau, bloquant tout futur client dessus.
//
// Ce helper referme le booking une fois que PLUS AUCUN membre actif n'y est
// rattaché — condition volontairement large (`!= 'cancelled'`, pas
// seulement paid/arrived) : un booking partagé par plusieurs membres (flux
// rejoindre-par-lien, bookings/group/route.ts) où un participant reste
// encore 'invite' doit rester réservé pour lui, pas libéré parce qu'un
// AUTRE participant a annulé sa propre place.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function cancelBookingIfNoActiveMembers(
  supabase: SupabaseClient,
  bookingId: string
): Promise<boolean> {
  const { data: remaining } = await supabase
    .from('booking_members')
    .select('id')
    .eq('booking_id', bookingId)
    .neq('status', 'cancelled');

  if (remaining && remaining.length > 0) return false;

  await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
  return true;
}
