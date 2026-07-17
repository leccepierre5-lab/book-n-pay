// src/lib/pro-notifications.ts
// Notifications email au pro sur les événements liés à SES réservations —
// extrait de stripe/webhook/route.ts (notif "nouvelle résa", 17/07) au
// moment d'ajouter "annulation" (cancel/route.ts, use-joker/route.ts) pour
// ne pas dupliquer une 3e fois le même bloc fetch-booking/owner/prefs/envoi.
//
// Chaque fonction est auto-protégée (try/catch interne, ne throw jamais) —
// une notification qui échoue ne doit JAMAIS faire échouer le paiement ou
// l'annulation qu'elle accompagne, déjà traités avant l'appel.
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/send';

interface NotifBookingInfo {
  biz_id: string;
  biz_name: string;
  service_name: string;
  staff_name: string | null;
  date: string;
  time: string;
}

// Seul le owner a un compte/email (la table `staff` n'a aucun champ email —
// un praticien assigné n'est jamais notifiable séparément). `toggleKey`
// correspond à une clé de business_settings.notification_prefs
// (NotificationsConfig.tsx) — merge par défaut à `true` comme le fait le
// composant (DEFAULTS), un pro qui n'a jamais ouvert ses réglages doit être
// notifié par défaut, pas silencieusement exclu faute de préférence
// enregistrée.
async function resolveNotifiableOwnerEmail(
  supabase: SupabaseClient,
  bizId: string,
  toggleKey: string
): Promise<string | null> {
  const { data: biz } = await supabase.from('businesses').select('owner_id').eq('id', bizId).maybeSingle();
  if (!biz?.owner_id) return null;

  const { data: settings } = await supabase
    .from('business_settings')
    .select('notification_prefs')
    .eq('biz_id', bizId)
    .maybeSingle();
  const enabled = (settings?.notification_prefs as Record<string, boolean> | null)?.[toggleKey] !== false;
  if (!enabled) return null;

  const { data: ownerAuth } = await supabase.auth.admin.getUserById(biz.owner_id);
  return ownerAuth.user?.email || null;
}

function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// Déclenché sur le PAIEMENT confirmé (checkout.session.completed), pas la
// création (bookings/create, status='invite') — évite de notifier pour des
// paniers abandonnés. Idempotence héritée de l'appelant : ce module ne fait
// aucun contrôle lui-même, c'est au webhook de n'appeler ceci qu'après son
// propre early-return "déjà paid".
export async function notifyProNewBooking(
  supabase: SupabaseClient,
  bookingId: string,
  opts: { depositAmount: number; groupSize?: number }
): Promise<void> {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('biz_id, biz_name, service_name, staff_name, date, time')
      .eq('id', bookingId)
      .maybeSingle<NotifBookingInfo>();
    if (!booking) return;

    const ownerEmail = await resolveNotifiableOwnerEmail(supabase, booking.biz_id, 'newBooking');
    if (!ownerEmail) return;

    const groupNote = opts.groupSize && opts.groupSize > 1 ? ` (groupe de ${opts.groupSize} personnes)` : '';

    await sendEmail({
      to: ownerEmail,
      subject: `✅ Nouvelle réservation — ${booking.service_name}`,
      text: `Bonjour,\n\nVous avez une nouvelle réservation confirmée${groupNote} !\n\n💆 Prestation : ${booking.service_name}${booking.staff_name ? `\n👤 Praticien : ${booking.staff_name}` : ''}\n📅 Date : ${formatDateFr(booking.date)}\n🕐 Heure : ${booking.time}\n💶 Frais de réservation reçus : ${opts.depositAmount}€\n\nRetrouvez le détail dans votre espace pro.\nL'équipe Book'nPay`,
    }).catch(() => {});
  } catch (err: any) {
    console.error('[ProNotif] notifyProNewBooking échouée:', err.message);
  }
}

// Déclenché quand un client annule une place déjà payée (cancel/route.ts,
// use-joker/route.ts — les deux exigent déjà member.status==='paid' avant
// d'accepter l'annulation, donc tout appel ici correspond à un engagement
// réel qui vient d'être défait, pas juste un 'invite' nettoyé). PAS branché
// sur refund-gesture (pro/refund-gesture/route.ts) : c'est le pro lui-même
// qui déclenche ce geste, inutile de l'en notifier.
export async function notifyProBookingCancelled(
  supabase: SupabaseClient,
  bookingId: string,
  opts: { memberName: string | null; refunded: boolean; refundAmount: number }
): Promise<void> {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('biz_id, biz_name, service_name, staff_name, date, time')
      .eq('id', bookingId)
      .maybeSingle<NotifBookingInfo>();
    if (!booking) return;

    const ownerEmail = await resolveNotifiableOwnerEmail(supabase, booking.biz_id, 'cancelBooking');
    if (!ownerEmail) return;

    const refundLine = opts.refunded
      ? `Remboursement de ${opts.refundAmount}€ effectué.`
      : `Frais de réservation conservés (annulation tardive ou geste sans remboursement).`;

    await sendEmail({
      to: ownerEmail,
      subject: `❌ Annulation — ${booking.service_name}`,
      text: `Bonjour,\n\n${opts.memberName || 'Un client'} a annulé sa réservation.\n\n💆 Prestation : ${booking.service_name}${booking.staff_name ? `\n👤 Praticien : ${booking.staff_name}` : ''}\n📅 Date : ${formatDateFr(booking.date)}\n🕐 Heure : ${booking.time}\n\n${refundLine}\n\nCe créneau est de nouveau disponible à la réservation.\nL'équipe Book'nPay`,
    }).catch(() => {});
  } catch (err: any) {
    console.error('[ProNotif] notifyProBookingCancelled échouée:', err.message);
  }
}
