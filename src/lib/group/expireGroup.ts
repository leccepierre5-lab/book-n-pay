// Deux contextes d'appel réels, testés séparément (Lot 2, 16/08) — même
// fonction, même comportement attendu (idempotente : rejouable sans risque
// sur un groupe déjà expiré, voir hasCancelledPaidMember plus bas), mais
// des déclencheurs très différents :
// 1. Cron nocturne (`api/cron/expire-groups/route.ts`, 1x/jour) — filet de
//    sécurité qui balaie TOUS les groupes dont payment_deadline est dépassé
//    en base, qu'un humain les ait revus ou non. Couvert par
//    tests/unit/expire-groups-route.test.ts.
// 2. Polling lazy (`api/group/pending-status/route.ts`, appelé à chaque
//    chargement de page côté client tant qu'un groupe est en attente) —
//    ne traite QUE le(s) groupe(s) où l'UTILISATEUR COURANT a lui-même un
//    membre, déclenché en side-effect d'une simple lecture de statut. Peut
//    donc expirer un groupe bien avant le passage du cron nocturne si l'un
//    des participants revient sur le site après le délai — c'est le chemin
//    normal en usage réel, le cron n'est qu'un filet pour ceux qui ne
//    reviennent jamais. Couvert par tests/unit/group-pending-status-route.test.ts.
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/send';
import { depositRefundAmountCents, reverseConnectedAccountTransfer, withRefundClaim, RefundAlreadyClaimedError } from '@/lib/refunds';
import { processBatch } from '@/lib/cron-batch';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

interface RefundJob {
  bookingId: string;
  member: any;
  clientEmail: string | null;
}

export async function expireGroupByRef(
  ref: string,
  supabase: SupabaseClient,
  stripe: Stripe,
): Promise<{ expired: boolean }> {
  const { data: groupBookings } = await supabase
    .from('bookings')
    .select('id, status, client_email, biz_name, service_name, date, time, booking_members(id, name, status, email, deposit, stripe_payment_intent_id)')
    .eq('group_ref', ref);

  const allBks = groupBookings ?? [];
  const allMembers = allBks.flatMap((b: any) => b.booking_members ?? []);
  const activeMembers = allMembers.filter((m: any) => m.status !== 'cancelled');
  const paidMembers = activeMembers.filter((m: any) => m.status === 'paid' || m.status === 'arrived');
  const unpaidMembers = activeMembers.filter((m: any) => m.status === 'invite');

  // Un membre 'cancelled' qui a un stripe_payment_intent_id a nécessairement
  // payé avant d'être annulé — soit remboursé avec succès par un passage
  // précédent de CETTE fonction, soit (le cas qui nous intéresse ici) un
  // refund resté en échec sur un passage précédent, retenté plus bas dans le
  // bloc refundJobs. Dans les deux cas, ce n'est PAS le scénario "tout le
  // monde vient de payer, webhook pas encore retombé" que ce filet de course
  // couvre — sans cette garde, un refund en échec sur un passage précédent
  // ferait reprendre ce chemin à tort au passage suivant (tous les autres
  // membres 'invite' déjà annulés sans paiement, donc unpaidMembers=0), qui
  // marquerait le groupe 'completed' au lieu de retenter le remboursement —
  // silencieux de la même manière que le bug corrigé plus bas (audit 26/07).
  const hasCancelledPaidMember = allMembers.some(
    (m: any) => m.status === 'cancelled' && !!m.stripe_payment_intent_id
  );

  if (!hasCancelledPaidMember && unpaidMembers.length === 0 && paidMembers.length > 0) {
    // Rien à expirer — tout le monde a payé, ce groupe n'est pas concerné
    // par le délai. Corrigé le 15/08/2026 : cette branche marquait autrefois
    // le groupe 'completed' ici (motif : "protéger contre une lecture juste
    // avant que le webhook Stripe ne le fasse lui-même"), sur la même
    // condition erronée que le webhook — dès le paiement, pas le service
    // rendu. Depuis que le webhook ne pose plus jamais 'completed' (voir
    // src/app/api/stripe/webhook/route.ts), cette branche n'a plus rien à
    // "protéger" : le groupe reste simplement 'active', l'état correct pour
    // un RDV à venir. 'completed' n'est posé QUE par
    // completeBookingIfAllArrived (src/lib/booking-lifecycle.ts).
    return { expired: false };
  }

  const firstBk = allBks[0];
  const dateFormatted = firstBk
    ? new Date(firstBk.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  // ⚠️ CORRECTIF (audit 26/07) : le remboursement Stripe est tenté AVANT tout
  // changement de bookings.status — auparavant le statut passait à
  // 'cancelled' pour tout le groupe en une seule update, avant même de
  // savoir si les refunds allaient réussir. Un refund en échec (réseau,
  // solde Connect insuffisant...) n'était alors QUE loggué en console : le
  // booking, déjà 'cancelled', sortait pour toujours du filtre
  // `.eq('status','active')` utilisé aussi bien par le cron nocturne que par
  // le polling lazy (group/pending-status) — aucun des deux mécanismes ne
  // repassait donc jamais dessus. Un client débité restait indéfiniment non
  // remboursé, sans qu'aucune alerte ne remonte à personne. Maintenant : un
  // booking dont au moins un membre a un refund en échec reste 'active',
  // pour être retenté au prochain passage (cron ou lazy), et déclenche une
  // alerte admin + une trace `booking_logs` interrogeable.
  const refundJobs: RefundJob[] = [];
  for (const bk of allBks) {
    for (const member of (bk as any).booking_members ?? []) {
      if (member.status === 'paid' && member.stripe_payment_intent_id) {
        refundJobs.push({ bookingId: bk.id, member, clientEmail: (bk as any).client_email ?? null });
      }
    }
  }

  const refundResult = await processBatch(
    refundJobs,
    `expire-groups:refunds:${ref}`,
    (job) => `membre ${job.member.id} (booking ${job.bookingId}, ${job.member.deposit ?? 0}€)`,
    async (job) => {
      const { member } = job;
      try {
        // Verrou anti-double-remboursement (audit 22/08, migration 0063) —
        // voir lib/refunds.ts withRefundClaim(). Ferme précisément la course
        // décrite dans l'audit : cron nocturne + polling lazy sur le même
        // group_ref, tous deux capables de lire ce membre 'paid' et
        // d'appeler Stripe en parallèle.
        await withRefundClaim(supabase, member.id, () => stripe.refunds.create({
          payment_intent: member.stripe_payment_intent_id,
          // Ne rembourse que les frais de réservation — les frais de
          // gestion Book'nPay restent acquis même sur une expiration de groupe.
          amount: depositRefundAmountCents(member.deposit),
          metadata: { reason: 'group_expired', group_ref: ref },
        }));
      } catch (err) {
        if (err instanceof RefundAlreadyClaimedError) {
          // Pas un échec — l'autre déclencheur (cron ou polling lazy) traite
          // déjà ce membre au même instant. Il mènera le remboursement à son
          // terme ; ce job-ci s'arrête ici sans compter comme échec (pas
          // d'alerte admin, pas de blocage du booking pour retry).
          console.warn(`[expireGroup] ${err.message}`);
          return;
        }
        throw err;
      }

      // ⚠️ CORRECTIF (audit 22/08) : ce remboursement partiel (dépôt seul)
      // ne récupérait jamais le dépôt déjà transféré au pro — même bug que
      // reverse_transfer (d77eaa1) et que loyalty/use-joker, un point
      // d'appel de plus oublié par ces deux correctifs. Best-effort strict,
      // comme les autres sites : un échec ici est une alerte admin, ne doit
      // jamais faire échouer ce job (le client est déjà remboursé juste
      // au-dessus) ni rouvrir le booking pour retry.
      const reversal = await reverseConnectedAccountTransfer(
        stripe,
        member.stripe_payment_intent_id,
        depositRefundAmountCents(member.deposit),
        'ExpireGroup'
      );
      if (reversal.error) {
        await notifyAdminOnFailure('expire-groups:reverse_transfer', {
          processed: 0,
          failed: 1,
          failedItems: [member.id],
          failedDescriptions: [
            `membre ${member.id} (booking ${job.bookingId}) — récupération du dépôt (${member.deposit ?? 0}€) auprès du pro échouée, à vérifier manuellement — ${reversal.error}`,
          ],
        }, 'action');
        await supabase.from('booking_logs').insert({
          booking_id: job.bookingId,
          message: `Réversal du dépôt auprès du pro échoué (expiration groupe) — membre ${member.id}, ${member.deposit ?? 0}€ — à vérifier manuellement — ${reversal.error}`,
        });
      }

      await supabase
        .from('booking_members')
        .update({ status: 'cancelled', montant_rembourse: member.deposit ?? 0 })
        .eq('id', member.id);

      const emailTo = member.email || job.clientEmail;
      if (emailTo) {
        await sendEmail({
          to: emailTo,
          subject: `💸 Remboursement — Groupe expiré Book'nPay`,
          text: `Bonjour ${member.name || 'vous'},\n\nMalheureusement, le délai de paiement pour votre réservation de groupe est expiré car tous les participants n'ont pas confirmé à temps.\n\n📍 ${firstBk ? (firstBk as any).biz_name : ''}\n💆 ${firstBk ? (firstBk as any).service_name : ''}\n📅 ${dateFormatted}\n\nVotre réservation a été annulée et vos frais de réservation (${member.deposit ?? 0}€) vous seront remboursés sous 5 à 10 jours ouvrés (hors frais de gestion, non remboursables).\n\nVous pouvez reprendre votre réservation en solo dès maintenant si vous le souhaitez, sans attendre les autres participants.\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
        }).catch(() => {});
      }
    }
  );

  // Membres jamais payés ('invite') — place libérée sans remboursement,
  // jamais concernés par un échec Stripe.
  for (const bk of allBks) {
    for (const member of (bk as any).booking_members ?? []) {
      if (member.status === 'invite') {
        await supabase
          .from('booking_members')
          .update({ status: 'cancelled' })
          .eq('id', member.id);

        const emailTo = member.email || (bk as any).client_email;
        if (emailTo) {
          await sendEmail({
            to: emailTo,
            subject: `❌ Réservation de groupe annulée — Book'nPay`,
            text: `Bonjour ${member.name || 'vous'},\n\nLe délai de paiement pour la réservation de groupe est expiré. Tous les participants n'ont pas confirmé dans les 20 minutes.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre place a été libérée. Aucun montant ne vous a été débité.\n\nVous pouvez reprendre votre réservation en solo dès maintenant si vous le souhaitez, sans attendre les autres participants.\n\nL'équipe Book'nPay`,
          }).catch(() => {});
        }
      }
    }
  }

  // Statut du booking posé EN DERNIER, et seulement sur les bookings dont
  // aucun refund n'est en échec — voir commentaire ci-dessus.
  const failedBookingIds = new Set(refundResult.failedItems.map((job) => job.bookingId));
  const bookingIdsToCancel = allBks.map((b: any) => b.id).filter((id: string) => !failedBookingIds.has(id));
  if (bookingIdsToCancel.length > 0) {
    await supabase.from('bookings').update({ status: 'cancelled' }).in('id', bookingIdsToCancel);
  }

  if (refundResult.failed > 0) {
    for (const job of refundResult.failedItems) {
      await supabase.from('booking_logs').insert({
        booking_id: job.bookingId,
        message: `Remboursement expiration groupe échoué — membre ${job.member.id}, ${job.member.deposit ?? 0}€ — à vérifier manuellement (retenté automatiquement au prochain passage)`,
      });
    }
    await notifyAdminOnFailure(`expire-groups:refunds (${ref})`, refundResult);
  }

  console.log(
    `[expireGroup] Groupe ${ref} expiré — ${refundResult.processed} remboursement(s) OK, ${refundResult.failed} échec(s) (booking laissé 'active' pour retry), ${unpaidMembers.length} annulation(s) sans paiement`
  );
  return { expired: true };
}
