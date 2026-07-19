// src/lib/booking-solo-overlap.ts
// Appel de la fonction Postgres atomique create_solo_booking_with_overlap_check
// (voir supabase/migrations/0035_solo_overlap_check_booking.sql) — verrou
// (biz_id, date) + re-vérification du chevauchement par durée + insertion,
// dans une seule transaction. Réservée aux services individuels
// (allow_group=false) d'un business SANS staff actif : le trou que
// create_booking_with_capacity_check (0026) ne couvrait pas — deux services
// différents qui se chevauchent chez le même pro solo, jamais confrontés
// l'un à l'autre (trouvé en audit du 19/07/2026). Les services collectifs
// restent sur create_booking_with_capacity_check, modèle correct pour eux
// (capacité par tête à l'heure exacte, pas un chevauchement à bloquer).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking } from './database.types';

export interface CreateSoloBookingWithOverlapCheckParams {
  bizId: string;
  bizName: string;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  clientId: string | null;
  clientPhone: string | null;
  clientName: string | null;
  clientEmail: string | null;
  groupRef?: string | null;
  paymentDeadline?: string | null;
}

// Renvoie null si le créneau chevauche une autre prestation individuelle du
// même business ce jour-là (message 'slot_overlap' remonté par la fonction
// SQL) — l'appelant traduit ça en 409/conflit de groupe, même contrat que
// createBookingWithCapacityCheck ('capacity_full') et
// assignStaffAndCreateBooking (0 ligne = aucun candidat libre).
export async function createSoloBookingWithOverlapCheck(
  supabase: SupabaseClient,
  params: CreateSoloBookingWithOverlapCheckParams
): Promise<Booking | null> {
  const { data, error } = await supabase.rpc('create_solo_booking_with_overlap_check', {
    p_biz_id: params.bizId,
    p_biz_name: params.bizName,
    p_service_id: params.serviceId,
    p_service_name: params.serviceName,
    p_date: params.date,
    p_time: params.time,
    p_client_id: params.clientId,
    p_client_phone: params.clientPhone,
    p_client_name: params.clientName,
    p_client_email: params.clientEmail,
    p_group_ref: params.groupRef ?? null,
    p_payment_deadline: params.paymentDeadline ?? null,
  });

  if (error) {
    if (error.code === 'P0001' && error.message === 'slot_overlap') {
      return null;
    }
    throw error;
  }

  const rows = (data ?? []) as Booking[];
  return rows[0] ?? null;
}
