// src/lib/booking-utils.ts
import { BNP_PLANS, OVERAGE_GRACE, OVERAGE_CAP_MARGIN, type PlanKey } from './plans-config';
// Port direct de src/lib/bookingUtils.js (Base44) — logique métier pure,
// sans dépendance au client de persistance. Les fonctions Base44.entities.*
// sont remplacées par de vraies requêtes Supabase dans src/lib/queries/*.

import type { BookingMember, Booking } from './database.types';

// ⚠️ AJOUTÉ EN AUDIT — absent de l'original Base44 et de toutes les
// versions précédentes de cette migration. Au moins 13 endroits du code
// comparent des numéros de téléphone avec une égalité stricte (`===` ou
// `.eq('phone', ...)`), y compris plusieurs correctifs de sécurité
// (use-joker, cancel, checkin-by-qr). Sans normalisation, "0612345678",
// "+33612345678" et "06 12 34 56 78" sont trois chaînes différentes pour
// ces comparaisons, même s'il s'agit du même numéro réel — cassant
// silencieusement la fidélité, le matching de membre de groupe, et même
// les vérifications d'autorisation. Cette fonction normalise au format
// E.164 simplifié (présomption France : 0X... → +33X...) au moment de la
// SAISIE (formulaires d'inscription, formulaire de groupe), pas à chaque
// comparaison — plus robuste que de corriger 13 comparaisons une par une,
// et garantit que toute donnée stockée en base suit déjà un format unique.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+33' + digits.slice(1);
  if (digits.startsWith('33')) return '+' + digits;
  return digits;
}

export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
}

// Anciennement 6 caractères Math.random() (~31 bits) — bien trop faible pour
// un identifiant qui finit par circuler comme clé de jointure sur des lignes
// `bookings` d'autrui (voir mémoire pitfall #35). crypto.randomUUID() est
// natif (Node ≥ 19 et Web Crypto, aucune dépendance ajoutée) et cryptographiquement
// fort (~122 bits, largement suffisant). Colonne `bookings.group_ref` vérifiée
// sans contrainte de longueur (testé empiriquement, accepte 40+ caractères).
export function generateGroupRef(): string {
  return crypto.randomUUID();
}

export function generateQrCode(): string {
  let r = '';
  for (let i = 0; i < 6; i++) r += Math.floor(Math.random() * 10);
  return r;
}

// ── Sérénité Score — calculé à partir de l'historique de bookings d'un client ──
// ⚠️ Non appelée aujourd'hui — point d'ancrage, pas du code mort (vérifié
// 23/07 : c'est la SEULE fonction qui produit ce type ; le score affiché
// dans FicheClientIntelligente.tsx / api/pro/client-stats est une forme
// différente et plus simple — {total, noShow, score}, sans level/levelColor/
// levelIcon/honored — donc pas un remplacement). calcTrustScore + TrustScore
// forment une paire avec calcDeposit (plus bas dans ce fichier) : dépôt
// majoré selon l'historique de fiabilité, feature testée (7 cas,
// tests/unit/booking-fees.test.ts) mais jamais branchée dans la création de
// réservation réelle. Ne pas supprimer comme code mort — la brancher ou
// trancher explicitement de l'abandonner, mais pas la retirer par audit.
export interface TrustScore {
  score: number;
  total: number;
  honored: number;
  noShows: number;
  level: 'Nouveau' | 'VIP' | 'Fiable' | 'Correct' | 'Prudence';
  levelColor: string;
  levelIcon: string;
}

export function calcTrustScore(
  bookings: (Booking & { booking_members: BookingMember[] })[],
  phone: string
): TrustScore {
  const relevant = bookings.filter((b) =>
    b.booking_members?.some((m) => phonesMatch(m.phone, phone) && m.status !== 'cancelled' && m.status !== 'invite')
  );
  const total = relevant.length;

  if (total === 0) {
    return {
      score: 100,
      total: 0,
      honored: 0,
      noShows: 0,
      level: 'Nouveau',
      levelColor: '#3B82F6',
      levelIcon: '🆕',
    };
  }

  let honored = 0;
  let noShows = 0;
  relevant.forEach((b) => {
    b.booking_members.forEach((m) => {
      if (phonesMatch(m.phone, phone)) {
        if (m.status === 'arrived') honored++;
        if (m.status === 'no_show') noShows++;
      }
    });
  });

  const score = Math.max(0, Math.round(100 - (noShows / total) * 60));

  let level: TrustScore['level'];
  let levelColor: string;
  let levelIcon: string;
  if (score >= 95) {
    level = 'VIP';
    levelColor = '#059669';
    levelIcon = '⭐';
  } else if (score >= 80) {
    level = 'Fiable';
    levelColor = '#3B82F6';
    levelIcon = '✅';
  } else if (score >= 60) {
    level = 'Correct';
    levelColor = '#D97706';
    levelIcon = '🟡';
  } else {
    level = 'Prudence';
    levelColor = '#E11D48';
    levelIcon = '⚠️';
  }

  return { score, total, honored, noShows, level, levelColor, levelIcon };
}

// ── Timezone helpers (les dates stockées sont heure de Paris) ──
// Interprète "YYYY-MM-DD" + "HH:MM" comme heure Europe/Paris et renvoie un Date UTC.
//
// ⚠️ Doit rester correct QUEL QUE SOIT le fuseau système du runtime qui
// l'exécute — Vercel tourne en UTC, mais depuis que cette fonction est aussi
// appelée côté navigateur (EquipeManager.tsx, AgendaView.tsx), le fuseau
// d'exécution est celui de l'utilisateur, typiquement Europe/Paris pour un
// pro français. L'ancienne implémentation (`toLocaleString` puis
// `new Date(chaîne)`) supposait implicitement que le fuseau système était
// UTC — `new Date()` sur une chaîne sans offset explicite est interprétée
// dans le fuseau LOCAL du runtime, pas en UTC. Résultat : correcte sur
// Vercel par coïncidence, silencieusement fausse (aucun décalage appliqué)
// dans un navigateur réglé sur Europe/Paris. `Intl.DateTimeFormat` avec un
// `timeZone` explicite ne dépend jamais du fuseau système — c'est la seule
// primitive fiable ici, donc utilisée pour lire l'offset réel plutôt que de
// le déduire d'un re-parsing de chaîne.
export function parseParisDatetime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcGuess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Intl rend parfois l'heure 24 pour minuit selon l'environnement — normalisé à 0.
  const parisHour = get('hour') % 24;
  const parisWallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), parisHour, get('minute'), get('second'));

  // Écart entre l'heure murale Paris de cet instant et l'heure murale UTC
  // devinée au départ = décalage horaire réel à ce moment (+2h CEST été,
  // +1h CET hiver). Appliqué en sens inverse pour obtenir le vrai instant UTC.
  const offsetMs = parisWallClockAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
}

// Renvoie la date de demain au format "YYYY-MM-DD" selon l'heure de Paris.
export function getParisTomorrowStr(): string {
  return getParisDateOffsetStr(1);
}

// Renvoie la date à J+offsetDays (heure de Paris) au format "YYYY-MM-DD".
export function getParisDateOffsetStr(offsetDays: number): string {
  const todayParis = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const [y, mo, d] = todayParis.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + offsetDays)).toISOString().split('T')[0];
}

export interface BizHoraires {
  open_time: string | null;
  close_time: string | null;
  open_days: number[];
}

// Grille de créneaux de 30 min entre deux horaires "HH:MM" — même logique que
// generateSlots() dans StepDateTime.tsx, extraite ici pour être réutilisable
// côté serveur (calcul de disponibilité par praticien, staff-availability.ts).
export function generateSlots(open: string | null, close: string | null): string[] {
  if (!open || !close) return [];
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const slots: string[] = [];
  let h = oh, m = om;
  while (h < ch || (h === ch && m < cm)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
}

export function isSlotClosed(biz: BizHoraires, date: string, slot: string): boolean {
  if (!biz.open_time || !biz.close_time) return false;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const dayClosed = !biz.open_days.includes(dayOfWeek);
  const slotH = parseInt(slot.split(':')[0], 10);
  const openH = parseInt(biz.open_time.split(':')[0], 10);
  const closeH = parseInt(biz.close_time.split(':')[0], 10);
  const outsideHours = slotH < openH || slotH >= closeH;
  return dayClosed || outsideHours;
}

// Le RDV a-t-il été RÉSERVÉ (created_at, pas la date du RDV lui-même) alors
// que le pro n'aurait pas pu décrocher le téléphone — hors jour ouvré ou hors
// plage horaire ? Conversion explicite en heure de Paris (jamais le fuseau
// du runtime, cf. commentaire de parseParisDatetime ci-dessus) via les mêmes
// primitives Intl que isSlotPast/getParisDateOffsetStr.
export function isCreatedOffHours(createdAtIso: string, biz: BizHoraires): boolean {
  if (!biz.open_time || !biz.close_time) return false;
  const d = new Date(createdAtIso);
  const parisDateStr = d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const dayOfWeek = new Date(parisDateStr + 'T12:00:00').getDay();
  const parisTimeStr = d.toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const dayClosed = !biz.open_days.includes(dayOfWeek);
  const outsideHours = parisTimeStr < biz.open_time.slice(0, 5) || parisTimeStr >= biz.close_time.slice(0, 5);
  return dayClosed || outsideHours;
}

// Fenêtre de validité d'une invitation 'invite' non payée (booking_members),
// solo ou groupe — 30 min partout : c'est le plancher dur imposé par Stripe
// sur Checkout Session.expires_at (impossible de descendre plus bas), donc
// pas la peine d'avoir une constante différente par flux. Consommée par la
// création du membre (solo: bookings/create, groupe: bookings/group),
// alignée sur stripe/checkout/route.ts (expires_at) et lue par le cron
// cleanup-expired-invites (filet si le webhook checkout.session.expired
// n'arrive pas).
export const INVITE_EXPIRY_MS = 30 * 60 * 1000;

// Source de vérité unique pour "ce créneau est-il déjà passé", partagée
// front (StepDateTime, revalidation avant submit) et back (bookings/create,
// bookings/create-group) — comparaison en Europe/Paris, pas le fuseau du
// serveur/navigateur. Un créneau à l'heure exacte de "maintenant" compte
// comme passé (même règle que l'ancien isSlotPast front, volontairement
// stricte : mieux vaut refuser un edge-case à la seconde près que laisser
// créer un RDV déjà entamé).
export function isSlotPast(date: string, time: string): boolean {
  const todayParis = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  if (date > todayParis) return false;
  if (date < todayParis) return true;
  const nowParis = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });
  return time.slice(0, 5) <= nowParis;
}

// ── Frais de gestion progressifs ─────────────────────────────────────────────
// Barème : ≤ 50€ → 1,99€ | 50,01-80€ → 2,10€ | 80,01-100€ → 2,30€ | > 100€ → 2,50€
// ⚠️ Garder synchronisé avec app_config (frais_gestion_palier_*) côté serveur —
// cette fonction sert de fallback si l'AppConfig n'est pas accessible.
export function calcFraisGestion(servicePrice: number): number {
  if (servicePrice > 100) return 2.5;
  if (servicePrice > 80) return 2.3;
  if (servicePrice > 50) return 2.1;
  return 1.99;
}

// ── Dépôt dynamique selon l'historique de fiabilité ──────────────────────────
// ⚠️ Non appelée aujourd'hui — même statut d'ancrage que calcTrustScore/
// TrustScore ci-dessus (dont calcDeposit consomme le type) : testée
// (tests/unit/booking-fees.test.ts) mais jamais branchée dans la création de
// réservation réelle. Ne pas supprimer comme code mort.
export interface DepositResult {
  amount: number;
  reason: string | null;
}

export function calcDeposit(baseDeposit: number, price: number, trustScore: TrustScore): DepositResult {
  if (trustScore.score < 60 && trustScore.total > 0) {
    return {
      amount: Math.round(Math.max(baseDeposit * 2, price * 0.5)),
      reason: "Frais majorés (historique d'absences)",
    };
  }
  return { amount: baseDeposit, reason: null };
}

// ── Hors-forfait pro ─────────────────────────────────────────────────────────
export type OverageStatus = 'included' | 'grace_period' | 'overage';

export interface OverageResult {
  status: OverageStatus;
  overageCount: number;
  currentPlanLabel: string;
  nextPlanLabel: string | null;
  capHt: number | null; // plafond €HT du cycle en cours — null si non applicable (included)
}

export interface CapTier {
  quota: number | null; // null = toujours couvrant (dernier palier, ex. Scale)
  price: number;
}

// Paliers strictement au-dessus de planKey, ordre croissant, construits
// depuis BNP_PLANS (source de vérité unique des prix/quotas) — passés tels
// quels en p_cap_tiers à la RPC increment_booking_count_and_charge (voir
// migration 0030). Aucune duplication des prix en dur côté SQL, donc aucune
// migration nécessaire si les tarifs changent.
export function buildCapTiers(planKey: PlanKey | string): CapTier[] {
  const idx = BNP_PLANS.findIndex((p) => p.key === planKey);
  if (idx === -1) return [];
  return BNP_PLANS.slice(idx + 1).map((p) => ({ quota: p.quota, price: p.priceHT }));
}

// Meme logique d'escalade que la boucle FOR de increment_booking_count_and_charge
// (migration 0030) : premier palier (ordre croissant) dont le quota couvre le
// volume reel du mois, quota null = toujours couvrant.
function calcCapHt(volumeThisMonth: number, tiers: CapTier[], currentPrice: number): number | null {
  const tier = tiers.find((t) => t.quota === null || t.quota >= volumeThisMonth);
  if (!tier) return null;
  return tier.price + OVERAGE_CAP_MARGIN - currentPrice;
}

export function getOverageStatus(bookingCountThisMonth: number, planKey: PlanKey | string): OverageResult {
  const plan = BNP_PLANS.find((p) => p.key === planKey);
  const currentPlanLabel = plan?.label ?? planKey;

  if (!plan || plan.quota === null) {
    return { status: 'included', overageCount: 0, currentPlanLabel, nextPlanLabel: null, capHt: null };
  }

  const nextPlan = plan.nextPlan ? BNP_PLANS.find((p) => p.key === plan.nextPlan) : null;
  const nextPlanLabel = nextPlan?.label ?? null;
  const overage = bookingCountThisMonth - plan.quota;

  if (overage <= 0) return { status: 'included', overageCount: 0, currentPlanLabel, nextPlanLabel, capHt: null };

  const capHt = calcCapHt(bookingCountThisMonth, buildCapTiers(plan.key), plan.priceHT);

  // Avec OVERAGE_GRACE=0, cette branche est inatteignable : on est ici parce
  // que overage>0, et overage<=OVERAGE_GRACE(0) ne peut alors jamais être vrai.
  // Conservée volontairement (risque de régression minimal si la grâce est un
  // jour réintroduite) plutôt que supprimée avec le statut 'grace_period'.
  if (overage <= OVERAGE_GRACE) return { status: 'grace_period', overageCount: overage, currentPlanLabel, nextPlanLabel, capHt };
  return { status: 'overage', overageCount: overage, currentPlanLabel, nextPlanLabel, capHt };
}

// ── Fidélité "Sérénité" — paliers et jokers ──────────────────────────────────
// Port de calculerStatutFidelite (Base44 Edge Function)
// Source unique des paliers — JOKERS_LIMITES, JOKERS_PCT et computeStatut en
// sont dérivés ci-dessous plutôt que redéfinis, pour ne jamais diverger entre
// le calcul serveur et l'affichage (LoyaltyCard importe ce même tableau).
export const TIERS = [
  { key: 'Standard', rdv: 0, jokers: 1, pct: 100 },
  { key: 'Bronze', rdv: 16, jokers: 2, pct: 100 },
  { key: 'Argent', rdv: 31, jokers: 3, pct: 100 },
  { key: 'Gold', rdv: 51, jokers: 4, pct: 100 },
] as const;

export const JOKERS_LIMITES: Record<string, number> = Object.fromEntries(
  TIERS.map((tier) => [tier.key, tier.jokers])
);

export const JOKERS_PCT: Record<string, number> = Object.fromEntries(
  TIERS.map((tier) => [tier.key, tier.pct / 100])
);

export function computeStatut(rdvHonores: number): { statut: string; jokers: number } {
  const tier = [...TIERS].reverse().find((t) => rdvHonores >= t.rdv) ?? TIERS[0];
  return { statut: tier.key, jokers: tier.jokers };
}
