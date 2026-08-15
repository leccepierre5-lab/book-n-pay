-- supabase/migrations/0055_reschedule_proposals.sql
-- Report de RDV à l'initiative du pro (absence, imprévu) — le client doit
-- ACCEPTER le nouveau créneau, jamais un report imposé (décision actée le
-- 15/08). Ne touche à AUCUNE des 3 fonctions Postgres anti-double-booking
-- (create_solo_booking_with_overlap_check / assign_staff_and_create_booking,
-- migrations 0024/0035) : le créneau proposé est re-vérifié applicativement
-- au moment de l'acceptation (computeStaffAvailabilityForDay /
-- computeSoloAvailabilityForDay, voir src/lib/reschedule.ts), pas sous verrou
-- Postgres. Risque résiduel accepté sciemment : entre cette vérification et
-- l'UPDATE de la réservation, un autre client pourrait prendre le même
-- créneau par le chemin normal (verrouillé, lui) — jugé théorique au volume
-- actuel ; rouvrir ce verrou pour ce cas précis coûterait plus cher que le
-- risque qu'il couvre.
create table if not exists public.reschedule_proposals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,

  -- Photo du créneau au moment de la proposition (pas une FK vivante) : si
  -- la réservation est retouchée entre-temps, l'email déjà envoyé au client
  -- reste cohérent avec ce qu'il a reçu.
  original_date date not null,
  original_time time not null,

  proposed_date date not null,
  proposed_time time not null,
  staff_id uuid references public.staff(id), -- null = business solo

  -- Généré applicativement via crypto.randomBytes (voir generateRescheduleToken,
  -- src/lib/reschedule.ts) — jamais dérivé de booking_id, jamais gen_random_uuid()
  -- côté colonne : ce token est le seul facteur d'authentification d'un lien
  -- public mutable (accepter/refuser), il doit être imprévisible par construction.
  token text not null,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','expired','slot_taken')),

  reason text, -- motif optionnel saisi par le pro, affiché au client
  created_at timestamptz not null default now(),
  -- 48h par défaut, plafonné à la moitié du temps restant avant le RDV
  -- d'origine, calculé par computeRescheduleExpiresAt (src/lib/reschedule.ts)
  -- — jamais laissé au choix libre de l'appelant.
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_by uuid references auth.users(id) -- le pro qui propose
);

create unique index if not exists reschedule_proposals_token_idx
  on public.reschedule_proposals (token);

-- Une seule proposition active à la fois par réservation.
create unique index if not exists reschedule_proposals_booking_pending_idx
  on public.reschedule_proposals (booking_id) where status = 'pending';

alter table public.reschedule_proposals enable row level security;
-- service_role uniquement, aucune policy — même choix que refund_failures
-- (0052) : accès exclusivement via routes API (dashboard pro authentifié +
-- lien public token), jamais de lecture directe côté client Supabase.
