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

// Trouvé le 15/08/2026 en testant le report de RDV en conditions réelles :
// le webhook Stripe marquait bookings.status='completed' dès que tous les
// membres actifs avaient status='paid' — c'est-à-dire dès le paiement
// réussi, PAS quand le service a été rendu. Un RDV payé aujourd'hui pour
// dans 5 jours se retrouvait "completed" avant même d'avoir eu lieu,
// cassant tout ce qui suppose qu'une réservation 'active' est un RDV à
// venir (report de RDV notamment). Introduit intentionnellement le
// 26/06/2026 ("auto-complete booking"), jamais requestionné depuis.
//
// 'arrived' (posé par checkin-by-qr et cloturer-prestation quand le client
// se présente réellement) est le seul signal fiable de "service rendu" qui
// existe déjà dans le produit — ce helper reprend exactement le motif de
// cancelBookingIfNoActiveMembers ci-dessus. `.eq('status', 'active')` en
// garde-fou sur le update : ne jamais écraser une réservation déjà annulée
// par ailleurs.
//
// Définition de "membre actif" pour CETTE complétion (précisée le 15/08
// après relecture) : 'cancelled' est exclu par la requête elle-même (comme
// pour cancelBookingIfNoActiveMembers) ; parmi le reste, 'arrived' ET
// 'no_show' sont tous deux des états TERMINAUX — le sort du membre est
// connu, rien d'autre ne va se passer pour lui. Seuls 'paid' (payé, pas
// encore vu) et 'invite' (jamais payé) signifient que le RDV n'est pas
// encore résolu et doivent bloquer la complétion. Un no-show ne doit jamais
// laisser un booking bloqué 'active' pour toujours : le RDV a bien eu lieu
// (à l'heure prévue), le client n'est simplement pas venu.
//
// Hypothèse posée le 15/08, à REVÉRIFIER si elle change : à ce jour,
// AUCUN code ne lit bookings.status==='completed' (vérifié par grep dans
// tout le repo) — c'est ce qui rend inoffensif le cas "tous les membres en
// no_show → completed quand même" ci-dessus (personne ne le compte
// aujourd'hui comme une prestation réalisée). Le jour où un écran de stats
// pro, une facturation, ou un export lit bookings.status, revérifier
// spécifiquement ce cas — il faudra peut-être distinguer "complété avec au
// moins un arrived" de "complété tout no_show" avant de l'utiliser comme
// signal de revenu/activité réelle.
export async function completeBookingIfAllArrived(
  supabase: SupabaseClient,
  bookingId: string
): Promise<boolean> {
  const { data: activeMembers } = await supabase
    .from('booking_members')
    .select('status')
    .eq('booking_id', bookingId)
    .neq('status', 'cancelled');

  if (!activeMembers || activeMembers.length === 0) return false;
  if (activeMembers.some((m) => m.status !== 'arrived' && m.status !== 'no_show')) return false;

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'completed' })
    .eq('id', bookingId)
    .eq('status', 'active');

  return !error;
}
