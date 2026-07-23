// Source de vérité partagée pour les plans Book'nPay.
// Importée par : tarifs/page.tsx (affichage), booking-utils.ts (getOverageStatus),
// routes API (vérification quota, billing setup, cron renouvellement).

export type PlanKey = 'starter' | 'business' | 'scale';

export interface PlanConfig {
  key: PlanKey;
  label: string;
  priceHT: number;             // €HT/mois
  engagementMonths: number;    // durée d'engagement minimale (3 / 6 / 12)
  quota: number | null;        // réservations/mois incluses — null = illimité (Scale)
  nextPlan: PlanKey | null;    // plan supérieur pour la proposition d'upgrade
  // Clé Stripe Price à renseigner dans les variables d'env — voir STRIPE_PRICE_IDS
  stripePriceEnvKey: string;
}

export const BNP_PLANS: PlanConfig[] = [
  {
    key: 'starter',
    label: 'Starter',
    priceHT: 79,
    engagementMonths: 3,
    quota: 120,
    nextPlan: 'business',
    stripePriceEnvKey: 'STRIPE_PRICE_STARTER',
  },
  {
    key: 'business',
    label: 'Business',
    priceHT: 139,
    engagementMonths: 6,
    quota: 300,
    nextPlan: 'scale',
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
  },
  {
    key: 'scale',
    label: 'Scale',
    priceHT: 299,
    engagementMonths: 12,
    quota: null,   // illimité — aucun surcoût, aucune modale d'upgrade
    nextPlan: null,
    stripePriceEnvKey: 'STRIPE_PRICE_SCALE',
  },
];

// Hors-forfait — ne s'applique qu'aux plans avec quota (starter, business)
// OVERAGE_GRACE=0 : aucune marge de grâce, facturé dès la 1ère réservation
// au-delà du quota. Le statut 'grace_period' de getOverageStatus() devient
// alors inatteignable (overage>0 implique toujours overage>OVERAGE_GRACE) —
// laissé en place volontairement plutôt que retiré, voir booking-utils.ts.
export const OVERAGE_GRACE = 0;       // réservations gratuites au-delà du quota
export const OVERAGE_FEE_HT = 3.99;  // €HT par réservation en dépassement réel

// Montant minimum facturable par Stripe (0,50€) — voir migration 0030 et
// increment_booking_count_and_charge : si le reste sous le plafond tombe
// en-dessous, la réservation est tracée à 0€ (statut 'capped') plutôt que
// de tenter une charge Stripe vouée à l'échec.
export const STRIPE_MIN_CHARGE_HT = 0.5;

// Plafond des frais de dépassement mensuels — protège contre un montant punitif
// (ex. Starter à 200 résa/mois = 79€ + 319,20€ sans plafond, pire que Scale).
// Formule (voir getOverageStatus) : plafond = prix du palier correspondant au
// VOLUME RÉEL du mois + OVERAGE_CAP_MARGIN, moins l'abonnement actuel. Le palier
// de base est le plus petit plan de BNP_PLANS dont le quota couvre le volume
// réel (business si volume≤300, scale au-delà) — jamais de palier au-dessus de
// Scale, donc jamais de plafond au-dessus de Scale+OVERAGE_CAP_MARGIN.
export const OVERAGE_CAP_MARGIN = 20; // €HT au-dessus du palier de base

// Renouvellement — délai de notification avant fin d'engagement (loi Chatel : entre J-90 et J-30)
// À valider juridiquement avant mise en prod.
export const ENGAGEMENT_NOTICE_DAYS = 30;

export function getPlanConfig(key: string): PlanConfig | undefined {
  return BNP_PLANS.find((p) => p.key === key);
}

export function getNextPlanConfig(key: string): PlanConfig | null {
  const plan = getPlanConfig(key);
  if (!plan?.nextPlan) return null;
  return getPlanConfig(plan.nextPlan) ?? null;
}

// Retourne la date de fin d'engagement à partir de la date d'activation.
export function getEngagementEndDate(startDate: Date, planKey: string): Date {
  const plan = getPlanConfig(planKey);
  const months = plan?.engagementMonths ?? 3;
  const end = new Date(startDate);
  end.setMonth(end.getMonth() + months);
  return end;
}

// Non appelée aujourd'hui — point d'ancrage prévu pour l'annulation par le
// pro (question C15 du dossier CCI). Ne pas supprimer comme code mort.
// Retourne true si l'abonnement est encore dans sa période d'engagement.
export function isInEngagementPeriod(startDate: Date, planKey: string): boolean {
  return new Date() < getEngagementEndDate(startDate, planKey);
}
