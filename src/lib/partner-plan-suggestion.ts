// Signaux demandés à la candidature (/devenir-partenaire) et utilisés par
// l'admin à l'approbation (AdminDashboard.tsx) — deux champs distincts, PAS
// un remplacement l'un de l'autre (décision explicite, 12/08/2026) :
//
// - practitioners_count : nombre de collaborateurs déclaré par le pro. C'est
//   LUI qui suggère un plan (Starter/Business/Scale se distinguent par le
//   nombre de collaborateurs autorisés, voir BNP_PLANS.maxStaff et
//   [[project_bnp_staff_limit_by_plan]]). Nullable en base (candidatures
//   antérieures à ce champ) — dans ce cas, AUCUNE suggestion de plan n'est
//   faite (on ne retombe pas sur le volume, qui n'a plus de rapport avec le
//   plan depuis la refonte tarifaire : réservations illimitées sur tous les
//   plans).
// - monthly_bookings_estimate : volume de réservations estimé. Reste demandé
//   et affiché à l'admin comme indicateur de revenu réel (frais de gestion),
//   mais ne détermine plus jamais de suggestion de plan.
import { BNP_PLANS, getPraticiensLimit, type PlanKey } from './plans-config';

export interface PractitionersCountOption {
  // Valeur stockée en base (contrainte CHECK, supabase/migrations/0042_practitioners_count.sql).
  value: string;
  label: string;
  plan: PlanKey;
}

// Un bucket par plan, borné par son nombre total de collaborateurs
// (getPraticiensLimit — LA MÊME source que la limite serveur posée en
// 6be5bc8, voir plans-config.ts) : si BNP_PLANS.maxStaff change, les
// libellés ET la logique de suggestion (PRACTITIONERS_COUNT_OPTIONS[i].plan)
// suivent automatiquement.
// ⚠️ Ce qui NE suit PAS automatiquement : la contrainte CHECK SQL de la
// migration, statique par nature. Si les seuils changent au point de
// modifier la FORME des buckets (ex. Business passe à 3 collaborateurs,
// donc "2 à 4" au lieu de "2 à 3"), il faudra une migration dédiée pour
// élargir la contrainte — et gérer les valeurs déjà stockées avec l'ancienne
// forme. Ce n'est pas un piège caché : c'est une limite inhérente à un enum
// bucketisé en base, documentée ici pour qu'elle ne surprenne personne.
export const PRACTITIONERS_COUNT_OPTIONS: PractitionersCountOption[] = BNP_PLANS.map((plan, i) => {
  const prevLimit = i === 0 ? 0 : (getPraticiensLimit(BNP_PLANS[i - 1].key) ?? 0);
  const limit = getPraticiensLimit(plan.key);
  const min = prevLimit + 1;
  if (limit === null) {
    return { value: `${min}+`, label: `${min} collaborateurs ou plus`, plan: plan.key };
  }
  if (min === limit) {
    return { value: `${min}`, label: `${min} collaborateur (solo)`, plan: plan.key };
  }
  return { value: `${min}-${limit}`, label: `${min} à ${limit} collaborateurs`, plan: plan.key };
});

// undefined = pas de suggestion (valeur absente/inconnue — ancienne
// candidature ou valeur invalide). Ne jamais retomber sur monthly_bookings_estimate.
export function getSuggestedPlanFromPractitionersCount(value: string | null | undefined): PlanKey | undefined {
  return PRACTITIONERS_COUNT_OPTIONS.find((o) => o.value === value)?.plan;
}

export function getPractitionersCountLabel(value: string | null | undefined): string {
  return PRACTITIONERS_COUNT_OPTIONS.find((o) => o.value === value)?.label ?? 'effectif non renseigné';
}

// Volume de réservations estimé — factorisé ici (dupliqué auparavant entre
// PartnerApplicationForm.tsx et un mapping local à AdminDashboard.tsx qui
// servait, à tort, à suggérer un plan). N'a plus aucun rapport avec le plan.
// Libellés alignés le 12/08/2026 sur les valeurs réellement stockées en base
// (CHECK chk_pa_bookings_estimate, migration 0016) — un décalage précédent
// ("Moins de 120"/"121 à 300" pour '0-80'/'81-300') faisait écrire au pro
// une réponse qui ne correspondait pas au libellé qu'il lisait.
export const BOOKINGS_ESTIMATE_OPTIONS = [
  { value: '0-80', label: 'Jusqu\'à 80 / mois' },
  { value: '81-300', label: '81 à 300 / mois' },
  { value: '300+', label: 'Plus de 300 / mois' },
] as const;
export type BookingsEstimate = (typeof BOOKINGS_ESTIMATE_OPTIONS)[number]['value'];

// Facultatif depuis la migration 0044 — NULL = non renseigné, jamais une
// valeur par défaut silencieuse (voir la migration pour le raisonnement).
export function getBookingsEstimateLabel(value: string | null | undefined): string {
  return BOOKINGS_ESTIMATE_OPTIONS.find((o) => o.value === value)?.label ?? 'non renseigné';
}
