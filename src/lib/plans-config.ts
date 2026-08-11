// Source de vérité partagée pour les plans Book'nPay.
// Importée par : tarifs/page.tsx (affichage), routes API (billing setup,
// cron renouvellement). Réservations illimitées sur tous les plans depuis
// le 11/08 (refonte tarifaire) — aucun quota, aucun hors-forfait ; voir
// [[project_bnp_dette_technique]] pour l'historique si un jour un plafond
// de volume doit revenir (ce n'était pas un flag OFF, la logique a été
// supprimée, pas désactivée).

export type PlanKey = 'starter' | 'business' | 'scale';

export interface PlanConfig {
  key: PlanKey;
  label: string;
  priceHT: number;             // €HT/mois
  engagementMonths: number;    // durée d'engagement minimale — 0 = sans engagement (Starter)
  // Clé Stripe Price à renseigner dans les variables d'env — voir STRIPE_PRICE_IDS
  stripePriceEnvKey: string;
}

export const BNP_PLANS: PlanConfig[] = [
  {
    key: 'starter',
    label: 'Starter',
    priceHT: 49,
    engagementMonths: 0,
    stripePriceEnvKey: 'STRIPE_PRICE_STARTER',
  },
  {
    key: 'business',
    label: 'Business',
    priceHT: 89,
    engagementMonths: 6,
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
  },
  {
    key: 'scale',
    label: 'Scale',
    priceHT: 139,
    engagementMonths: 12,
    stripePriceEnvKey: 'STRIPE_PRICE_SCALE',
  },
];

// Renouvellement — délai de notification avant fin d'engagement (loi Chatel : entre J-90 et J-30)
// À valider juridiquement avant mise en prod. Concerne Business/Scale (Starter
// est sans engagement) — cron check-engagement-notice existe mais n'est pas
// enregistré dans vercel.json, voir [[project_bnp_dette_technique]].
export const ENGAGEMENT_NOTICE_DAYS = 30;

export function getPlanConfig(key: string): PlanConfig | undefined {
  return BNP_PLANS.find((p) => p.key === key);
}

// Retourne la date de fin d'engagement à partir de la date d'activation.
// engagementMonths=0 (Starter) : setMonth(+0) renvoie une date identique à
// startDate — vérifié par test (5 cas dont fin de mois, année bissextile,
// veille DST) qu'aucun rollover ne se produit, voir tests/unit/plans-config.test.ts.
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
