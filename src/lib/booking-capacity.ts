// src/lib/booking-capacity.ts
// Appel de la fonction Postgres atomique create_booking_with_capacity_check
// (voir supabase/migrations/0026_capacity_check_booking.sql +
// 0027_capacity_check_group_meta.sql) — verrou + re-vérification de
// services.max_persons + insertion (group_ref/payment_deadline inclus),
// dans une seule transaction Postgres. Utilisé par create/route.ts (service
// collectif ou business sans staff actif, groupRef/paymentDeadline omis =
// NULL) et create-group/route.ts (boucle par créneau, valeurs réelles),
// c'est-à-dire tous les chemins qui ne passent pas déjà par
// assignStaffAndCreateBooking (staff-assignment.ts, migration 0024 — depuis
// 0028, celle-ci pose aussi group_ref/payment_deadline atomiquement, dans son
// propre INSERT). Les deux RPC posent donc désormais ces colonnes de façon
// atomique, chacune par son propre chemin.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking } from './database.types';

export interface CreateBookingWithCapacityCheckParams {
  bizId: string;
  bizName: string;
  serviceId: string;
  serviceName: string;
  staffId: string | null;
  staffName: string | null;
  date: string;
  time: string;
  clientId: string | null;
  clientPhone: string | null;
  clientName: string | null;
  clientEmail: string | null;
  groupRef?: string | null;
  paymentDeadline?: string | null;
}

// Renvoie null si la capacité est atteinte (message 'capacity_full' remonté
// par la fonction SQL, voir migration 0026) — l'appelant traduit ça en 409,
// même contrat que assignStaffAndCreateBooking pour "aucun candidat libre".
// Toute autre erreur (ex. 23505 sur bookings_staff_slot_unique) est relancée
// telle quelle, code inclus, pour que l'appelant garde sa propre logique de
// distinction par error.code.
export async function createBookingWithCapacityCheck(
  supabase: SupabaseClient,
  params: CreateBookingWithCapacityCheckParams
): Promise<Booking | null> {
  const { data, error } = await supabase.rpc('create_booking_with_capacity_check', {
    p_biz_id: params.bizId,
    p_biz_name: params.bizName,
    p_service_id: params.serviceId,
    p_service_name: params.serviceName,
    p_staff_id: params.staffId,
    p_staff_name: params.staffName,
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
    if (error.code === 'P0001' && error.message === 'capacity_full') {
      return null;
    }
    throw error;
  }

  const rows = (data ?? []) as Booking[];
  return rows[0] ?? null;
}
