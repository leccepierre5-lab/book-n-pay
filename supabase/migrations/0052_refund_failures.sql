-- 0052_refund_failures.sql
-- Transforme la promesse "vérification manuelle" (emails d'échec de
-- remboursement) en mécanisme réel : avant cette table, un remboursement en
-- échec ne laissait qu'une ligne booking_logs interrogeable seulement en
-- connaissant déjà le booking_id, et un email admin optionnel. Un client
-- pouvait attendre son argent sans que personne ne le sache structurellement
-- (voir diagnostic 14/08, booking 59a81eb2 : reverse_transfer sur une charge
-- sans transfert associé).
create table if not exists public.refund_failures (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  stripe_charge_id text,
  amount_cents integer not null,
  error_code text,
  error_message text not null,
  attempts integer not null default 1,
  status text not null default 'open'
    check (status in ('open','resolved','manual')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text
);

create index if not exists refund_failures_open_idx
  on public.refund_failures (created_at desc) where status = 'open';

create unique index if not exists refund_failures_booking_open_idx
  on public.refund_failures (booking_id) where status = 'open';

alter table public.refund_failures enable row level security;
-- service_role uniquement, aucune policy client (RLS activée sans policy =
-- fermé à anon/authenticated, même schéma que le reste des tables
-- opérationnelles internes de ce repo).
