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
    quota: 80,
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
export const OVERAGE_GRACE = 5;       // réservations gratuites au-delà du quota
export const OVERAGE_FEE_HT = 3.99;  // €HT par réservation en dépassement réel

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

// Retourne true si l'abonnement est encore dans sa période d'engagement.
export function isInEngagementPeriod(startDate: Date, planKey: string): boolean {
  return new Date() < getEngagementEndDate(startDate, planKey);
}
