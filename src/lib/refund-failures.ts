// src/lib/refund-failures.ts
// Mécanisme réel derrière "une vérification manuelle peut être nécessaire"
// (migration 0052) — appelé sur chaque échec de remboursement/réversal des 4
// routes concernées (pro/cancel-booking, bookings/cancel, pro/refund-gesture,
// admin/freeze-business). Best-effort STRICT comme le reste de ces routes :
// un échec d'écriture ici ne doit jamais faire remonter d'erreur à
// l'appelant, le remboursement/l'annulation est déjà acté avant cet appel.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RefundFailureInput {
  bookingId: string;
  stripeChargeId?: string | null;
  amountCents: number;
  errorCode?: string | null;
  errorMessage: string;
}

// Un seul index unique (booking_id) WHERE status='open' : un rejeu du même
// booking pendant qu'une entrée est déjà ouverte incrémente `attempts` au
// lieu de dupliquer la ligne — reflète fidèlement "on a retenté et ça a
// encore échoué", ce que la page admin (bouton relance) provoquera.
export async function insertRefundFailure(
  supabase: SupabaseClient,
  input: RefundFailureInput
): Promise<void> {
  try {
    const { error } = await supabase.from('refund_failures').insert({
      booking_id: input.bookingId,
      stripe_charge_id: input.stripeChargeId ?? null,
      amount_cents: input.amountCents,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage,
    });

    if (error) {
      // 23505 = violation de l'index unique (booking_id, status='open') :
      // une entrée ouverte existe déjà pour ce booking, on incrémente plutôt
      // que de dupliquer.
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('refund_failures')
          .select('id, attempts')
          .eq('booking_id', input.bookingId)
          .eq('status', 'open')
          .maybeSingle();

        if (existing) {
          await supabase
            .from('refund_failures')
            .update({
              attempts: (existing.attempts ?? 1) + 1,
              stripe_charge_id: input.stripeChargeId ?? null,
              amount_cents: input.amountCents,
              error_code: input.errorCode ?? null,
              error_message: input.errorMessage,
            })
            .eq('id', existing.id);
        }
        return;
      }
      throw error;
    }
  } catch (e: any) {
    console.error('[refund-failures] Écriture échouée:', e?.message ?? e);
  }
}
