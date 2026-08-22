// src/lib/refunds.ts
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

// Le paiement initial d'un membre est un seul PaymentIntent Stripe (2 line
// items : frais de réservation + frais de gestion Book'nPay — voir
// stripe/checkout/route.ts). Un stripe.refunds.create() sans `amount`
// explicite rembourse donc la TOTALITÉ du PaymentIntent par défaut, frais de
// gestion inclus. Règle produit : les frais de gestion ne sont JAMAIS
// remboursés au client sur ces chemins (client, expiration de groupe, gel
// d'établissement...). Ce helper centralise le calcul du montant à passer
// explicitement à Stripe pour ne rembourser que le dépôt.
// ⚠️ Exception : l'annulation PAR LE PRO ne passe PAS par ce helper — voir
// proCancellationRefundAmountCents ci-dessous, qui rembourse aussi les frais
// de gestion (refacturés au pro en contrepartie, pro_charges migration 0041).
export function depositRefundAmountCents(deposit: number | null | undefined): number {
  return Math.round((deposit || 0) * 100);
}

// Montant remboursé au client sur une annulation PAR LE PRO (C15,
// pro/cancel-booking/route.ts) — remboursement INTÉGRAL (frais de
// réservation + frais de gestion), CGU Art. 3 modifiée en conséquence : le
// client n'a commis aucune faute et n'a reçu aucune prestation, lui laisser
// les frais de gestion à sa charge exposait à un risque de clause abusive.
// Les frais de gestion ainsi remboursés sont refacturés au pro (pro_charges,
// migration 0041) — voir route.ts. Volontairement isolée de
// depositRefundAmountCents plutôt qu'un appel direct dans la route : cette
// règle ne s'applique QU'aux annulations pro — modifier
// depositRefundAmountCents impacterait à tort les 4 autres routes qui
// l'appellent (client/no-show/expiration de groupe/gel d'établissement,
// où les frais de gestion restent acquis).
export function proCancellationRefundAmountCents(
  deposit: number | null | undefined,
  managementFee: number | null | undefined
): number {
  return depositRefundAmountCents(deposit) + Math.round((managementFee || 0) * 100);
}

// Récupère le montant des frais de gestion réellement facturés à l'origine
// (jamais remboursés, CGV Art. 2), pour l'afficher explicitement dans un
// email de remboursement plutôt qu'un rappel vague — un client qui a payé
// en une seule fois (ex. 11,99€) ne devine pas de lui-même la répartition
// remboursé/conservé. Stocké en metadata sur la SESSION Checkout
// (stripe/checkout/route.ts), pas sur le PaymentIntent — d'où
// checkoutSessionId, pas paymentIntentId. Best-effort : un échec ici ne doit
// jamais bloquer le remboursement/l'annulation appelants (voir chaque site
// d'appel, tous dans un try/catch qui avale l'erreur).
// Introduit pour pro/cancel-booking (C15, `e7cfe60`), puis réutilisé par
// bookings/cancel, refund-gesture et freeze-business (audit email 27/07) —
// pro/cancel-booking garde sa propre copie inline, non retouchée ici.
export async function retrieveManagementFeeAmount(
  stripe: Stripe,
  checkoutSessionId: string | null | undefined,
  logPrefix: string
): Promise<number | null> {
  if (!checkoutSessionId) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const raw = session.metadata?.fraisGestion;
    return raw ? parseFloat(raw) : null;
  } catch (e: any) {
    console.warn(`[${logPrefix}] Impossible de récupérer les frais de gestion pour l'email:`, e.message);
    return null;
  }
}

// Récupère auprès du pro le dépôt déjà transféré automatiquement à la
// réservation (transfer_data.destination, stripe/checkout/route.ts) — sur un
// remboursement PARTIEL (dépôt seul, frais de gestion conservés), le flag
// `reverse_transfer` de stripe.refunds.create ne suffit PAS : Stripe annule le
// transfert proportionnellement au ratio (montant remboursé / montant total de
// la charge), pas au montant du dépôt lui-même — la charge incluant aussi les
// frais de gestion, ce ratio est toujours < 100%, donc `reverse_transfer` seul
// sous-récupère (ex. dépôt 10€/frais 2€/charge 12€ → 83% du dépôt récupéré,
// pas 100%). Vérifié dans la doc Stripe (Connect > Destination charges >
// Émettre des remboursements). D'où un appel SÉPARÉ à l'API Transfer
// Reversals, qui accepte un montant exact indépendant de cette proportionnalité
// (docs.stripe.com/api/transfer_reversals/create). Seule EXCEPTION : C15
// (pro/cancel-booking) rembourse 100% de la charge (dépôt + frais de gestion)
// — dans ce cas `reverse_transfer: true` sur le refund suffit et ce helper
// n'est pas utilisé (voir proCancellationRefundAmountCents ci-dessus).
//
// Best-effort STRICT : le remboursement client (déjà acquis avant d'appeler
// ce helper, voir chaque site d'appel) ne doit JAMAIS être remis en cause par
// un échec ici — un échec de récupération est une alerte admin, jamais un
// blocage. `refund_application_fee` n'est volontairement jamais posé : il
// enverrait les frais de gestion déjà perçus par la plateforme VERS le pro
// (l'inverse de pro_charges, qui les lui refacture) — les deux combinés
// créeraient une incohérence comptable directe.
export async function reverseConnectedAccountTransfer(
  stripe: Stripe,
  paymentIntentId: string | null | undefined,
  amountCents: number,
  logPrefix: string,
  idempotencyKey?: string
): Promise<{ done: boolean; error?: string }> {
  if (!paymentIntentId || amountCents <= 0) return { done: false };
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const charge = pi.latest_charge;
    // string si non-expandé nulle part, mais on n'a expandé QUE latest_charge
    // ici — charge.transfer reste donc un simple ID de Transfer, pas un objet.
    const transferId = charge && typeof charge !== 'string' ? (charge.transfer as string | null) : null;
    if (!transferId) {
      // Pas de transfert à l'origine (ex. fixture sans compte Connect en mode
      // test, stripe_account_id absent au moment du checkout) — rien à
      // récupérer, ce n'est pas un échec.
      return { done: false };
    }
    if (idempotencyKey) {
      await stripe.transfers.createReversal(transferId, { amount: amountCents }, { idempotencyKey });
    } else {
      await stripe.transfers.createReversal(transferId, { amount: amountCents });
    }
    return { done: true };
  } catch (e: any) {
    console.warn(`[${logPrefix}] Récupération du dépôt auprès du pro échouée:`, e.message);
    return { done: false, error: e.message };
  }
}

// ⚠️ Verrou anti-double-remboursement (audit 22/08, migration 0063,
// booking_members.refund_claimed_at) — UNE SEULE implémentation du contrat,
// utilisée identiquement par les 5 routes qui appellent stripe.refunds.create
// (bookings/cancel, pro/refund-gesture, pro/cancel-booking,
// admin/freeze-business, lib/group/expireGroup.ts). Motif direct : le
// correctif reverse_transfer (d77eaa1) n'avait fermé qu'un des sites
// concernés, laissant 4 fuites d'argent identiques ailleurs (voir §22/08 de
// project_bnp_pitfalls) — cinq copies indépendantes du même try/catch de
// verrouillage seraient exactement le même risque de divergence.
//
// Contrat (voir le commentaire de la migration 0063 pour le détail complet) :
// - Réclame le membre AVANT tout appel Stripe (NULL, ou horodatage vieux de
//   plus de REFUND_CLAIM_STALE_MS = un process précédent est mort en cours).
// - Si la réclamation échoue (verrou déjà posé récemment par une requête
//   concurrente) : lève RefundAlreadyClaimedError SANS jamais appeler
//   `attempt` — c'est la protection réelle contre le double remboursement.
// - Si `attempt` (l'appel Stripe réel) échoue : libère le verrou
//   explicitement (refund_claimed_at = null) AVANT de relancer l'erreur —
//   le prochain passage (cron, ou clic admin sur /admin/remboursements) peut
//   réclamer immédiatement, sans attendre les 2 minutes. Sans ce release,
//   une route qui oublierait de le faire resterait bloquée en silence
//   jusqu'à expiration — exactement le risque que factoriser ceci évite.
// - Si `attempt` réussit : le verrou reste posé (horodatage passé), sans
//   conséquence — le membre passe à un statut terminal ('cancelled') juste
//   après par l'appelant, qui ne repassera plus jamais par ce verrou pour
//   ce membre.
export const REFUND_CLAIM_STALE_MS = 2 * 60 * 1000;

export class RefundAlreadyClaimedError extends Error {
  constructor(memberId: string) {
    super(`Un remboursement est déjà en cours pour le membre ${memberId}.`);
    this.name = 'RefundAlreadyClaimedError';
  }
}

export async function withRefundClaim<T>(
  supabase: SupabaseClient,
  memberId: string,
  attempt: () => Promise<T>
): Promise<T> {
  const staleThreshold = new Date(Date.now() - REFUND_CLAIM_STALE_MS).toISOString();

  const { data: claimed } = await supabase
    .from('booking_members')
    .update({ refund_claimed_at: new Date().toISOString() })
    .eq('id', memberId)
    .or(`refund_claimed_at.is.null,refund_claimed_at.lt.${staleThreshold}`)
    .select('id')
    .maybeSingle();

  if (!claimed) {
    throw new RefundAlreadyClaimedError(memberId);
  }

  try {
    return await attempt();
  } catch (err) {
    // Libération explicite — voir le contrat ci-dessus. Best-effort : si
    // CETTE écriture échoue aussi, le verrou expirera de lui-même après
    // REFUND_CLAIM_STALE_MS (filet, pas un blocage permanent) — ne jamais
    // laisser un échec de libération masquer l'erreur d'origine.
    try {
      await supabase.from('booking_members').update({ refund_claimed_at: null }).eq('id', memberId);
    } catch {
      // best-effort, voir commentaire ci-dessus.
    }
    throw err;
  }
}
