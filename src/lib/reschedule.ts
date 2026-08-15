// src/lib/reschedule.ts
// Logique du report de RDV (migration 0055) — génération du token, calcul de
// la fenêtre de validité, recherche du prochain créneau libre pour pré-remplir
// le formulaire du pro. La RE-vérification de disponibilité au moment de
// l'acceptation vit dans la route elle-même (bookings/reschedule/accept),
// pas ici, pour rester testable sans mocker tout ce fichier.
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeStaffAvailabilityForDay, computeSoloAvailabilityForDay } from '@/lib/staff-assignment';
import { formatTime } from '@/lib/booking-utils';

// Décision actée 15/08 : durée par défaut 48h, plafonnée à la moitié du temps
// restant avant le RDV d'origine, plancher de 2h de marge (en dessous, le
// report n'est plus proposé du tout — annulation directe à la place).
export const RESCHEDULE_DEFAULT_WINDOW_HOURS = 48;
export const RESCHEDULE_MIN_MARGIN_HOURS = 2;
// Bornes de recherche pour findNextAvailableSlot — au-delà, pas de
// proposition automatique, le pro choisit manuellement (décision 15/08).
export const RESCHEDULE_SEARCH_HORIZON_DAYS = 14;

// Jamais gen_random_uuid()/randomUUID() ici : ce token est le seul facteur
// d'authentification d'un lien public MUTABLE (accepter/refuser un RDV, pas
// juste le consulter) — 32 octets de crypto.randomBytes (256 bits) plutôt que
// les ~122 bits d'un UUID, et surtout jamais dérivé de booking_id (un id de
// réservation n'est pas un secret, il circule déjà dans des URLs/logs).
export function generateRescheduleToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Calcule expires_at pour une proposition de report.
 * Retourne null si le RDV est à moins de RESCHEDULE_MIN_MARGIN_HOURS —
 * dans ce cas le report ne doit pas être proposé (annulation directe).
 */
export function computeRescheduleExpiresAt(rdvDateTime: Date, now: Date = new Date()): Date | null {
  const hoursUntilRdv = (rdvDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilRdv < RESCHEDULE_MIN_MARGIN_HOURS) return null;

  const windowHours = Math.min(RESCHEDULE_DEFAULT_WINDOW_HOURS, hoursUntilRdv / 2);
  return new Date(now.getTime() + windowHours * 60 * 60 * 1000);
}

export interface AvailableSlot {
  date: string;
  time: string; // "HH:MM"
  staffId: string | null;
}

// Un jour = une date "YYYY-MM-DD" en heure Paris, avancée par simple +1 jour
// calendaire (pas de fuseau à gérer ici : la date est une string opaque
// passée telle quelle à computeStaffAvailabilityForDay/computeSoloAvailability,
// qui interprètent déjà tout en heure Paris via parseParisDatetime).
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Boucle jour par jour depuis `fromDate` (exclue — on cherche APRÈS le
 * créneau d'origine) sur RESCHEDULE_SEARCH_HORIZON_DAYS jours, et renvoie le
 * premier créneau libre trouvé. Sert uniquement à pré-remplir le formulaire
 * du pro (StepReschedule côté UI) — il peut le modifier avant envoi ; la
 * vérification qui compte est celle faite à l'acceptation, pas celle-ci.
 * `preferredStaffId`, si fourni, fait préférer un créneau où CE praticien est
 * libre ; à défaut le premier créneau libre tout praticien confondu est
 * renvoyé.
 */
export async function findNextAvailableSlot(
  supabase: SupabaseClient,
  bizId: string,
  fromDate: string,
  durationMinutes: number,
  preferredStaffId?: string | null
): Promise<AvailableSlot | null> {
  for (let i = 1; i <= RESCHEDULE_SEARCH_HORIZON_DAYS; i++) {
    const date = addDays(fromDate, i);

    const staffAvailability = await computeStaffAvailabilityForDay(supabase, bizId, date, durationMinutes);
    if (staffAvailability) {
      const times = Object.keys(staffAvailability.availability).sort();
      for (const time of times) {
        const slot = staffAvailability.availability[time];
        if (slot.freeCount <= 0) continue;
        if (preferredStaffId && slot.freeStaffIds.includes(preferredStaffId)) {
          return { date, time, staffId: preferredStaffId };
        }
      }
      // Pas de créneau avec le praticien préféré ce jour-là — deuxième passe,
      // premier créneau libre tout praticien confondu.
      for (const time of times) {
        const slot = staffAvailability.availability[time];
        if (slot.freeCount > 0 && slot.freeStaffIds[0]) {
          return { date, time, staffId: slot.freeStaffIds[0] };
        }
      }
      continue;
    }

    const soloAvailability = await computeSoloAvailabilityForDay(supabase, bizId, date, durationMinutes);
    if (soloAvailability) {
      const times = Object.keys(soloAvailability).sort();
      for (const time of times) {
        if (soloAvailability[time].freeCount > 0) {
          return { date, time, staffId: null };
        }
      }
    }
  }
  return null;
}

/**
 * Re-vérifie qu'un créneau proposé est encore libre, au moment de
 * l'acceptation — même branchement staff/solo que availability/route.ts.
 * `proposedTime` peut être "HH:MM" ou "HH:MM:SS" (colonne Postgres `time`).
 */
export async function isProposedSlotStillFree(
  supabase: SupabaseClient,
  bizId: string,
  proposedDate: string,
  proposedTime: string,
  durationMinutes: number,
  staffId: string | null
): Promise<boolean> {
  const timeKey = formatTime(proposedTime);

  const staffAvailability = await computeStaffAvailabilityForDay(supabase, bizId, proposedDate, durationMinutes);
  if (staffAvailability) {
    const slot = staffAvailability.availability[timeKey];
    if (!slot || slot.freeCount <= 0) return false;
    return staffId ? slot.freeStaffIds.includes(staffId) : slot.freeStaffIds.length > 0;
  }

  const soloAvailability = await computeSoloAvailabilityForDay(supabase, bizId, proposedDate, durationMinutes);
  const slot = soloAvailability?.[timeKey];
  return !!slot && slot.freeCount > 0;
}
