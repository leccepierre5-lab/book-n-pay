// src/lib/feature-flags.ts
// Flag OFF (26/07) : décision produit figée — V1 = réservation solo
// uniquement. Le groupe (invitations, paiement partagé, group_ref) reste
// risqué en code (Stripe + cron + multi-acteurs, voir audit LOT 1) sans
// valeur suffisante pour le lancement. RÈGLE : rien n'est supprimé — code,
// tables, tests, crons restent en place, seulement rendus inaccessibles.
//
// Point de vérité UNIQUE : toute UI ou route serveur qui doit bloquer le
// chemin groupe lit CETTE constante, jamais une condition dupliquée
// localement — sinon un futur correctif isolé peut rouvrir un chemin sans
// que les autres suivent.
export const GROUP_BOOKING_ENABLED = false;
