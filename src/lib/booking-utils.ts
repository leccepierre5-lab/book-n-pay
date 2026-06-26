// src/lib/booking-utils.ts
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

export function generateGroupRef(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
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
  const todayParis = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const [y, mo, d] = todayParis.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().split('T')[0];
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
// Barème : < 50€ → 1,99€ | 50-79€ → 2,10€ | 80-99€ → 2,30€ | ≥ 100€ → 2,50€
// ⚠️ Garder synchronisé avec app_config (frais_gestion_palier_*) côté serveur —
// cette fonction sert de fallback si l'AppConfig n'est pas accessible.
export function calcFraisGestion(servicePrice: number): number {
  if (servicePrice >= 100) return 2.5;
  if (servicePrice >= 80) return 2.3;
  if (servicePrice >= 50) return 2.1;
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
