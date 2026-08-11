// src/lib/refunds.ts
import type Stripe from 'stripe';

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
