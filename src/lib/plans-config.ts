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
  // Nombre de COLLABORATEURS (lignes table `staff`) au-delà du pro lui-même,
  // qui n'a jamais de ligne `staff` (il n'est que owner_id sur `businesses` +
  // biz_id sur app_users — vérifié dans le flux de création de business,
  // aucun insert `staff` n'y est fait). Le total de praticiens affiché au
  // pro (voir /tarifs, EquipeManager) est donc TOUJOURS maxStaff+1.
  // null = illimité.
  maxStaff: number | null;
  // Clé Stripe Price à renseigner dans les variables d'env — voir STRIPE_PRICE_IDS
  stripePriceEnvKey: string;
}

export const BNP_PLANS: PlanConfig[] = [
  {
    key: 'starter',
    label: 'Starter',
    priceHT: 49,
    engagementMonths: 0,
    maxStaff: 0, // solo : le pro seul, aucun collaborateur
    stripePriceEnvKey: 'STRIPE_PRICE_STARTER',
  },
  {
    key: 'business',
    label: 'Business',
    priceHT: 89,
    engagementMonths: 6,
    maxStaff: 2, // + le pro lui-même = 3 praticiens au total
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
  },
  {
    key: 'scale',
    label: 'Scale',
    priceHT: 139,
    engagementMonths: 12,
    maxStaff: null, // illimité
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

// Nombre total de praticiens (le pro + ses collaborateurs) autorisé par un
// plan — null = illimité. C'est ce nombre-là qui doit être montré au pro
// (jamais maxStaff seul, qui exclut le pro et l'induirait en erreur).
// ⚠️ Ne PAS écrire `plan?.maxStaff ?? 0` : maxStaff peut légitimement valoir
// `null` (Scale, illimité) et `??` traiterait ce null comme une valeur
// absente, ramenant Scale à une limite de 0 — plus restrictif que Starter.
export function getPraticiensLimit(planKey: string): number | null {
  const plan = getPlanConfig(planKey);
  const maxStaff = plan ? plan.maxStaff : 0;
  return maxStaff === null ? null : maxStaff + 1;
}

// Retourne la date de fin d'engagement à partir de la date d'activation.
//
// ⚠️ Bug réel trouvé le 12/08/2026 (test rouge depuis sa création, bc648e9,
// 11/08 — pas un flake d'environnement) : setMonth()/getMonth() (variante
// locale) lisent/écrivent les champs de date dans le fuseau LOCAL du
// runtime qui exécute le code, pas en UTC. Le 25/10 (veille du bascule
// hiver FR), l'heure murale locale "02h00–02h59" existe DEUX FOIS en
// Europe/Paris (une fois en CEST avant le bascule, une fois en CET après).
// Sur une machine dont le fuseau local résout à Europe/Paris (poste dev,
// CI), reconstruire cette heure murale ambiguë via setMonth(sameMonth)
// la réinterprète du mauvais côté du bascule — décalage réel d'1h alors
// que engagementMonths=0 devrait être un no-op exact. Sur Vercel (fuseau
// UTC, sans DST — voir booking-utils.ts:parseParisDatetime), le bug ne se
// voyait jamais, d'où le passage inaperçu. Corrigé en passant en
// arithmétique UTC pure (setUTCMonth/getUTCMonth), qui n'a par définition
// aucune heure ambiguë — comportement identique quel que soit le fuseau du
// runtime qui exécute le test ou le code.
// engagementMonths=0 (Starter) : end reste identique à startDate — vérifié
// par test (5 cas dont fin de mois, année bissextile, veille DST), voir
// tests/unit/plans-config.test.ts.
export function getEngagementEndDate(startDate: Date, planKey: string): Date {
  const plan = getPlanConfig(planKey);
  const months = plan?.engagementMonths ?? 3;
  const end = new Date(startDate);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

// Non appelée aujourd'hui — point d'ancrage prévu pour l'annulation par le
// pro (question C15 du dossier CCI). Ne pas supprimer comme code mort.
// Retourne true si l'abonnement est encore dans sa période d'engagement.
export function isInEngagementPeriod(startDate: Date, planKey: string): boolean {
  return new Date() < getEngagementEndDate(startDate, planKey);
}
