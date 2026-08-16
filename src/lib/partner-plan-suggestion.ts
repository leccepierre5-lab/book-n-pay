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

// Un bucket par plan. Deux dérivations distinctes de BNP_PLANS, à ne pas
// confondre :
// - `value` (clé stockée en base) : bornée par l'EFFECTIF TOTAL du plan
//   (getPraticiensLimit, pro inclus) — c'est la forme figée par la
//   contrainte CHECK chk_pa_practitioners_count (migration 0042,
//   valeurs '1'/'2-3'/'4+'). Si les seuils changent au point de modifier la
//   FORME des buckets, il faudra une migration dédiée pour élargir la
//   contrainte et gérer les valeurs déjà stockées — limite inhérente à un
//   enum bucketisé en base, pas un piège caché.
// - `label` (texte affiché) : bornée par maxStaff SEUL (collaborateurs hors
//   pro), même convention que /tarifs (`teamSizeLabel`, "Vous + N
//   collaborateurs"). Bug trouvé le 16/08/2026 : la version précédente
//   dérivait aussi le libellé de l'effectif total, ce qui affichait
//   "2 à 3 collaborateurs" pour Business (maxStaff=2) — en contradiction
//   avec /tarifs qui promet "Vous + 2 collaborateurs" pour ce même plan.
//   Un pro avec 3 collaborateurs (hors lui-même) aurait alors coché ce
//   bucket en pensant tenir dans Business, alors que ça dépasse maxStaff=2.
export const PRACTITIONERS_COUNT_OPTIONS: PractitionersCountOption[] = BNP_PLANS.map((plan, i) => {
  const prevLimit = i === 0 ? 0 : (getPraticiensLimit(BNP_PLANS[i - 1].key) ?? 0);
  const limit = getPraticiensLimit(plan.key);
  const min = prevLimit + 1;
  const value = limit === null ? `${min}+` : min === limit ? `${min}` : `${min}-${limit}`;

  const prevMaxStaff = i === 0 ? -1 : (BNP_PLANS[i - 1].maxStaff ?? -1);
  const staffMin = prevMaxStaff + 1;
  const staffMax = plan.maxStaff;
  const label =
    staffMax === 0 ? 'Solo (aucun collaborateur)'
    : staffMax === null ? `${staffMin} collaborateurs ou plus`
    : staffMin === staffMax ? `${staffMin} collaborateur`
    : `${staffMin} à ${staffMax} collaborateurs`;

  return { value, label, plan: plan.key };
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
