// src/lib/refunds.ts
// Le paiement initial d'un membre est un seul PaymentIntent Stripe (2 line
// items : frais de réservation + frais de gestion Book'nPay — voir
// stripe/checkout/route.ts). Un stripe.refunds.create() sans `amount`
// explicite rembourse donc la TOTALITÉ du PaymentIntent par défaut, frais de
// gestion inclus. Règle produit : les frais de gestion ne sont JAMAIS
// remboursés, quel que soit le motif d'annulation (client, pro, expiration de
// groupe, gel d'établissement...). Ce helper centralise le calcul du montant
// à passer explicitement à Stripe pour ne rembourser que le dépôt.
export function depositRefundAmountCents(deposit: number | null | undefined): number {
  return Math.round((deposit || 0) * 100);
}

// Montant remboursé au client sur une annulation PAR LE PRO (C15,
// pro/cancel-booking/route.ts) — actuellement identique à
// depositRefundAmountCents (CGU Art. 3 : remboursement intégral des frais de
// réservation, frais de gestion jamais remboursés). Volontairement isolée de
// depositRefundAmountCents plutôt qu'un appel direct dans la route : si le
// RDV CCI du 30/07 change la règle spécifiquement pour les annulations pro
// (sans toucher client/no-show/expiration de groupe/gel d'établissement),
// seul CE point change — modifier depositRefundAmountCents impacterait à
// tort les 4 autres routes qui l'appellent.
export function proCancellationRefundAmountCents(deposit: number | null | undefined): number {
  return depositRefundAmountCents(deposit);
}
