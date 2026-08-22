// src/app/api/admin/refund-failures/[id]/retry/route.ts
// Migration 0052 — bouton "relance" de la page /admin/remboursements.
// Retrouve le paiement via stripe_charge_id (= stripe_payment_intent_id,
// stocké tel quel par insertRefundFailure) plutôt que par un member_id —
// la table n'en stocke pas, un seul échec ouvert par booking suffit pour
// l'usage actuel (voir index unique refund_failures_booking_open_idx).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getStripeClient } from '@/lib/stripe/client';
import { withErrorHandling } from '@/lib/api-error';
import { reverseConnectedAccountTransfer, withRefundClaim, RefundAlreadyClaimedError } from '@/lib/refunds';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

export const POST = withErrorHandling('[RefundFailureRetry]', async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux admins' }, { status: 403 });
  }

  const { id } = await params;
  const serviceSupabase = createServiceRoleClient();

  const { data: failure } = await serviceSupabase
    .from('refund_failures')
    .select('booking_id, stripe_charge_id, amount_cents, attempts, failure_type')
    .eq('id', id)
    .eq('status', 'open')
    .maybeSingle();
  if (!failure) return NextResponse.json({ error: 'Échec introuvable ou déjà traité' }, { status: 404 });

  if (!failure.stripe_charge_id) {
    return NextResponse.json(
      { error: "Aucun payment_intent associé à cet échec — résous-le manuellement." },
      { status: 400 }
    );
  }

  const { data: member } = await serviceSupabase
    .from('booking_members')
    .select('id, montant_rembourse')
    .eq('booking_id', failure.booking_id)
    .eq('stripe_payment_intent_id', failure.stripe_charge_id)
    .maybeSingle();

  // Sans memberId on ne peut pas passer par le verrou refund_claimed_at —
  // refuser explicitement plutôt que de rejouer refunds.create sans garde
  // (audit 22/08, migration 0063/0064). Ne s'applique qu'à la branche
  // 'refund' : la branche 'reverse_transfer' ci-dessous n'appelle jamais
  // refunds.create et n'a pas besoin du verrou.
  if (failure.failure_type === 'refund' && !member) {
    return NextResponse.json(
      { error: 'Membre introuvable pour ce remboursement — vérifie et résous manuellement.' },
      { status: 400 }
    );
  }

  const stripe = await getStripeClient(serviceSupabase);

  try {
    // Le refund Stripe a déjà réussi pour cette ligne — seule la
    // récupération du dépôt auprès du pro a échoué. Ne JAMAIS rappeler
    // refunds.create ici : ce serait un second remboursement réel sur un
    // payment_intent déjà remboursé (bug trouvé le 22/08, migration 0064).
    if (failure.failure_type === 'reverse_transfer') {
      const reversal = await reverseConnectedAccountTransfer(
        stripe,
        failure.stripe_charge_id,
        failure.amount_cents,
        'RefundFailureRetry'
      );
      if (reversal.error) throw new Error(reversal.error);

      await serviceSupabase
        .from('refund_failures')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: authData.user.id,
          resolution_note: 'Récupération auprès du pro relancée avec succès depuis /admin/remboursements.',
        })
        .eq('id', id);

      await serviceSupabase.from('booking_logs').insert({
        booking_id: failure.booking_id,
        message: `REVERSE_TRANSFER_RETRY_OK | refund_failure_id=${id} | admin=${authData.user.email ?? authData.user.id}`,
      });

      return NextResponse.json({ success: true, resolved: true });
    }

    // Même règle que pro/cancel-booking/route.ts (bug reverse_transfer
    // corrigé le 14/08) : ne poser reverse_transfer que si un transfert est
    // réellement associé à la charge.
    const pi = await stripe.paymentIntents.retrieve(failure.stripe_charge_id, {
      expand: ['latest_charge'],
    });
    const charge = pi.latest_charge;
    const hasTransfer = Boolean(charge && typeof charge !== 'string' && charge.transfer);

    // Garde-fou (14/08, booking 59a81eb2) : Stripe ne rejette que le cas
    // "montant trop élevé" — un amount_cents trop BAS (ex: erreur de
    // backfill) passerait sans qu'aucun filet ne le signale. Vérifié ici,
    // avant l'appel refunds.create, contre le montant réel de la charge —
    // jamais après coup. Le throw est intentionnellement attrapé par le
    // catch ci-dessous (même traitement qu'un vrai refus Stripe : attempts
    // incrémenté, error_message posé, status reste 'open').
    const chargeAmount = charge && typeof charge !== 'string' ? charge.amount : null;
    if (chargeAmount != null && failure.amount_cents > chargeAmount) {
      throw new Error(
        `Montant à rembourser (${(failure.amount_cents / 100).toFixed(2)}€) supérieur au montant réel de la charge (${(chargeAmount / 100).toFixed(2)}€) — refusé avant tout appel Stripe.`
      );
    }

    // ⚠️ CORRECTIF (audit 22/08) : `reverse_transfer: true` posé quel que
    // soit le montant relançait TOUJOURS le bug reverse_transfer que ce
    // commentaire prétend éviter — sur un échec initial PARTIEL (dépôt
    // seul, la majorité des cas : bookings/cancel, refund-gesture,
    // freeze-business, use-joker, expire-groups en refont tous un dépôt
    // seul), Stripe annule le transfert proportionnellement au ratio
    // remboursé/charge totale, pas au montant réel du dépôt — sous-
    // récupération silencieuse (voir lib/refunds.ts). `isFullRefund`
    // restreint le flag au SEUL cas où ça marche (remboursement = 100% de
    // la charge, cf. pro/cancel-booking) ; sinon, réversal exact via
    // reverseConnectedAccountTransfer juste après le refund.
    const isFullRefund = chargeAmount != null && failure.amount_cents === chargeAmount;

    // member non-null ici — garde plus haut, uniquement pour failure_type
    // === 'refund'.
    await withRefundClaim(serviceSupabase, member!.id, () => stripe.refunds.create({
      payment_intent: failure.stripe_charge_id,
      amount: failure.amount_cents,
      reason: 'requested_by_customer',
      ...(isFullRefund && hasTransfer ? { reverse_transfer: true } : {}),
      metadata: { email_sent: 'true', reason: 'refund_failure_retry' },
    }));

    if (hasTransfer && !isFullRefund) {
      const reversal = await reverseConnectedAccountTransfer(
        stripe,
        failure.stripe_charge_id,
        failure.amount_cents,
        'RefundFailureRetry'
      );
      if (reversal.error) {
        await notifyAdminOnFailure('admin/refund-failures/retry:reverse_transfer', {
          processed: 0,
          failed: 1,
          failedItems: [id],
          failedDescriptions: [
            `refund_failure ${id} (booking ${failure.booking_id}) — refund OK mais récupération du dépôt (${(failure.amount_cents / 100).toFixed(2)}€) auprès du pro échouée, à vérifier manuellement — ${reversal.error}`,
          ],
        }, 'action');
        await serviceSupabase.from('booking_logs').insert({
          booking_id: failure.booking_id,
          message: `Réversal du dépôt auprès du pro échoué (relance manuelle) — refund_failure_id=${id} — à vérifier manuellement — ${reversal.error}`,
        });
      }
    }

    if (member && member.montant_rembourse == null) {
      await serviceSupabase
        .from('booking_members')
        .update({ montant_rembourse: failure.amount_cents / 100 })
        .eq('id', member.id);
    }

    await serviceSupabase
      .from('refund_failures')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: authData.user.id,
        resolution_note: 'Remboursement relancé avec succès depuis /admin/remboursements.',
      })
      .eq('id', id);

    await serviceSupabase.from('booking_logs').insert({
      booking_id: failure.booking_id,
      message: `REFUND_FAILURE_RETRY_OK | refund_failure_id=${id} | admin=${authData.user.email ?? authData.user.id} | montant=${(failure.amount_cents / 100).toFixed(2)}`,
    });

    return NextResponse.json({ success: true, resolved: true });
  } catch (stripeErr: any) {
    if (stripeErr instanceof RefundAlreadyClaimedError) {
      // Pas un échec — une requête concurrente (double-clic sur le bouton,
      // ou une des 5 routes de remboursement) traite déjà ce membre.
      console.warn(`[RefundFailureRetry] ${stripeErr.message}`);
      return NextResponse.json({ error: stripeErr.message }, { status: 409 });
    }
    console.error('[RefundFailureRetry] Nouvel échec Stripe:', stripeErr.message);
    await serviceSupabase
      .from('refund_failures')
      .update({
        attempts: (failure.attempts ?? 1) + 1,
        error_code: stripeErr.code ?? null,
        error_message: stripeErr.message,
      })
      .eq('id', id);

    return NextResponse.json(
      { error: `La relance a échoué — ${stripeErr.message}` },
      { status: 502 }
    );
  }
});
