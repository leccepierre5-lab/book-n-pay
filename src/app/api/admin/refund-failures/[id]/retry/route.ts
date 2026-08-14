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
    .select('*')
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

  const stripe = await getStripeClient(serviceSupabase);

  try {
    // Même règle que pro/cancel-booking/route.ts (bug reverse_transfer
    // corrigé le 14/08) : ne poser reverse_transfer que si un transfert est
    // réellement associé à la charge.
    const pi = await stripe.paymentIntents.retrieve(failure.stripe_charge_id, {
      expand: ['latest_charge'],
    });
    const charge = pi.latest_charge;
    const hasTransfer = Boolean(charge && typeof charge !== 'string' && charge.transfer);

    await stripe.refunds.create({
      payment_intent: failure.stripe_charge_id,
      amount: failure.amount_cents,
      reason: 'requested_by_customer',
      ...(hasTransfer ? { reverse_transfer: true } : {}),
      metadata: { email_sent: 'true', reason: 'refund_failure_retry' },
    });

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
