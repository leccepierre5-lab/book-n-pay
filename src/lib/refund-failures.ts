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
  // Pas de valeur par défaut volontairement — voir migration 0064. 'refund'
  // = stripe.refunds.create() a échoué, rien n'a été remboursé au client.
  // 'reverse_transfer' = le refund a réussi, seule la récupération du dépôt
  // auprès du pro a échoué : le retry admin ne doit JAMAIS rejouer
  // refunds.create sur cette ligne.
  failureType: 'refund' | 'reverse_transfer';
}

// Un seul index unique (booking_id) WHERE status='open' (migration 0052) :
// un rejeu du même booking pendant qu'une entrée est déjà ouverte incrémente
// `attempts` au lieu de dupliquer la ligne — reflète fidèlement "on a
// retenté et ça a encore échoué", ce que la page admin (bouton relance)
// provoquera.
//
// ⚠️ Bug distinct trouvé le 22/08 : cet index ne porte QUE sur booking_id,
// pas sur le membre — sur un booking de groupe, deux membres différents en
// échec (deux payment_intent distincts) percutent la même ligne. Corriger
// la racine (élargir l'index à (booking_id, stripe_charge_id)) est une
// migration schéma séparée, pas faite ici. En attendant, cette fonction ne
// doit JAMAIS écraser silencieusement l'échec d'un autre payment_intent —
// voir la comparaison stripe_charge_id ci-dessous.
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
      failure_type: input.failureType,
    });

    if (error) {
      // 23505 = violation de l'index unique (booking_id, status='open') :
      // une entrée ouverte existe déjà pour ce booking.
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('refund_failures')
          .select('id, attempts, stripe_charge_id, failure_type, error_message')
          .eq('booking_id', input.bookingId)
          .eq('status', 'open')
          .maybeSingle();

        if (existing) {
          const samePaymentIntent = existing.stripe_charge_id === (input.stripeChargeId ?? null);
          // Le refund a déjà réussi pour ce payment_intent (ligne existante
          // reverse_transfer) — un nouvel échec 'refund' sur le MÊME PI est
          // structurellement impossible aujourd'hui (member.status passe à
          // 'cancelled' juste après tout refund réussi ou échoué, et le
          // retry admin sur une ligne reverse_transfer ne rappelle jamais
          // refunds.create) — mais on ne le fait jamais silencieusement
          // dans tous les cas.
          const wouldRegressType =
            existing.failure_type === 'reverse_transfer' && input.failureType === 'refund';

          if (samePaymentIntent && !wouldRegressType) {
            // Même échec rejoué sur le même payment_intent — comportement
            // inchangé, on rafraîchit la ligne.
            await supabase
              .from('refund_failures')
              .update({
                attempts: (existing.attempts ?? 1) + 1,
                stripe_charge_id: input.stripeChargeId ?? null,
                amount_cents: input.amountCents,
                error_code: input.errorCode ?? null,
                error_message: input.errorMessage,
                failure_type: input.failureType,
              })
              .eq('id', existing.id);
          } else {
            // Collision avec l'échec d'un AUTRE payment_intent sur le même
            // booking (bug d'index ci-dessus), OU tentative de repasser une
            // ligne reverse_transfer à refund (ne devrait jamais arriver,
            // garde quand même) — ne jamais écraser stripe_charge_id,
            // amount_cents ni failure_type existants. On trace l'anomalie
            // au lieu de l'absorber en silence.
            await supabase
              .from('refund_failures')
              .update({
                attempts: (existing.attempts ?? 1) + 1,
                error_message: `${existing.error_message}\n---\n[COLLISION booking ${input.bookingId}, payment_intent=${input.stripeChargeId ?? 'null'}, failure_type=${input.failureType}] ${input.errorMessage}`,
              })
              .eq('id', existing.id);
            console.error(
              `[insertRefundFailure] Collision sur booking ${input.bookingId} — échec masqué pour payment_intent ${input.stripeChargeId ?? 'null'} (type ${input.failureType}), ligne existante id=${existing.id} inchangée. Voir commentaire de insertRefundFailure().`
            );
          }
        }
        return;
      }
      throw error;
    }
  } catch (e: any) {
    console.error('[refund-failures] Écriture échouée:', e?.message ?? e);
  }
}
