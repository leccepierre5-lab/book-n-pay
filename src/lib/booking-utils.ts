// src/lib/booking-utils.ts
import { BNP_PLANS, OVERAGE_GRACE, type PlanKey } from './plans-config';
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

// ── Timezone helpers (Vercel tourne en UTC, les dates stockées sont heure de Paris) ──
// Interprète "YYYY-MM-DD" + "HH:MM" comme heure Europe/Paris et renvoie un Date UTC.
export function parseParisDatetime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parisCandidate = new Date(
    utcCandidate.toLocaleString('en-US', { timeZone: 'Europe/Paris' })
  );
  return new Date(utcCandidate.getTime() + (utcCandidate.getTime() - parisCandidate.getTime()));
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

// ── Disponibilité ────────────────────────────────────────────────────────────
export function guestsAtSlot(
  bizId: string,
  date: string,
  time: string,
  bookings: (Booking & { booking_members: BookingMember[] })[]
): number {
  let count = 0;
  bookings.forEach((b) => {
    if (b.biz_id === bizId && b.date === date && b.time === time && b.status !== 'cancelled') {
      b.booking_members?.forEach((m) => {
        if (m.status !== 'cancelled') count++;
      });
    }
  });
  return count;
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
}

export function getOverageStatus(bookingCountThisMonth: number, planKey: PlanKey | string): OverageResult {
  const plan = BNP_PLANS.find((p) => p.key === planKey);
  const currentPlanLabel = plan?.label ?? planKey;

  if (!plan || plan.quota === null) {
    return { status: 'included', overageCount: 0, currentPlanLabel, nextPlanLabel: null };
  }

  const nextPlan = plan.nextPlan ? BNP_PLANS.find((p) => p.key === plan.nextPlan) : null;
  const nextPlanLabel = nextPlan?.label ?? null;
  const overage = bookingCountThisMonth - plan.quota;

  if (overage <= 0) return { status: 'included', overageCount: 0, currentPlanLabel, nextPlanLabel };
  // Avec OVERAGE_GRACE=0, cette branche est inatteignable : on est ici parce
  // que overage>0, et overage<=OVERAGE_GRACE(0) ne peut alors jamais être vrai.
  // Conservée volontairement (risque de régression minimal si la grâce est un
  // jour réintroduite) plutôt que supprimée avec le statut 'grace_period'.
  if (overage <= OVERAGE_GRACE) return { status: 'grace_period', overageCount: overage, currentPlanLabel, nextPlanLabel };
  return { status: 'overage', overageCount: overage, currentPlanLabel, nextPlanLabel };
}

// ── Fidélité "Sérénité" — paliers et jokers ──────────────────────────────────
// Port de calculerStatutFidelite (Base44 Edge Function)
export const JOKERS_LIMITES: Record<string, number> = {
  Standard: 1,
  Bronze: 1,
  Argent: 2,
  Gold: 3,
};

export const JOKERS_PCT: Record<string, number> = {
  Standard: 0.5,
  Bronze: 1.0,
  Argent: 1.0,
  Gold: 1.0,
};

export function computeStatut(rdvHonores: number): { statut: string; jokers: number } {
  if (rdvHonores >= 51) return { statut: 'Gold', jokers: 3 };
  if (rdvHonores >= 31) return { statut: 'Argent', jokers: 2 };
  if (rdvHonores >= 16) return { statut: 'Bronze', jokers: 1 };
  return { statut: 'Standard', jokers: 1 };
}
