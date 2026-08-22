-- supabase/migrations/0063_refund_claimed_at.sql
-- Audit 22/08/2026 (point 3) : les 5 routes qui appellent
-- stripe.refunds.create (bookings/cancel, pro/refund-gesture,
-- pro/cancel-booking, admin/freeze-business, lib/group/expireGroup.ts)
-- lisent le statut du membre, appellent Stripe, PUIS écrivent le statut
-- final — aucune protection atomique entre la lecture et l'appel Stripe.
-- Deux requêtes concurrentes (double-clic, cron + polling lazy sur le même
-- group_ref) peuvent toutes deux lire le même membre remboursable et
-- appeler Stripe deux fois.
--
-- Écrire directement le statut final ('cancelled') comme verrou AVANT
-- l'appel Stripe casserait le mécanisme de retry d'expireGroup.ts, qui
-- re-scanne les membres status='paid' pour retenter un remboursement
-- échoué (son propre commentaire dit explicitement "retenté automatiquement
-- au prochain passage", correctif du 26/07) — un membre déjà passé
-- 'cancelled' avant même de savoir si Stripe a réussi sortirait de ce
-- filtre et ne serait plus jamais retenté.
--
-- Cette colonne est donc un verrou DISTINCT du statut métier, qui ne
-- touche à aucune des sémantiques déjà en place. Contrat, tenu côté
-- application (rien de ceci n'est en base — voir chaque route) :
-- - NULL = pas encore réclamé, l'appelant peut tenter le remboursement.
-- - horodatage RÉCENT (< 2 min) = réclamé par une requête en cours — un
--   `UPDATE ... WHERE id=X AND (refund_claimed_at IS NULL OR
--   refund_claimed_at < now() - interval '2 minutes') RETURNING *` avant
--   tout appel Stripe : 0 ligne retournée = quelqu'un d'autre a déjà
--   réclamé récemment, on n'appelle jamais Stripe une seconde fois.
-- - ⚠️ CORRIGÉ (même jour, avant toute exécution) : la première version de
--   cette migration ne prévoyait AUCUNE libération sur échec — un
--   remboursement Stripe qui échoue (réseau, solde Connect insuffisant...)
--   aurait laissé le verrou posé pour toujours, bloquant à la fois le
--   retry automatique d'expireGroup ET la relance manuelle admin, sans
--   qu'aucune trace n'explique pourquoi. Design correct :
--   1. Sur ÉCHEC Stripe (catch) : l'appelant remet explicitement
--      `refund_claimed_at = NULL` avant de logger/alerter — le prochain
--      passage (cron, ou clic du bouton admin) peut réclamer à nouveau
--      immédiatement, sans attendre l'expiration.
--   2. Le seuil de 2 minutes ci-dessus est le SEUL filet pour le cas où le
--      process meurt entre la réclamation et le traitement de l'échec
--      (crash, timeout serverless) — sans lui, ce cas précis bloquerait le
--      remboursement d'un client indéfiniment, sans trace ni recours
--      automatique. Un verrou orphelin se libère donc tout seul après 2
--      minutes, sans intervention humaine.
-- - Jamais une preuve de remboursement réussi (ça reste `montant_rembourse`
--   et le statut final, posés uniquement après succès Stripe) — seulement
--   un verrou de concurrence à courte durée de vie.
alter table public.booking_members
  add column if not exists refund_claimed_at timestamptz;

comment on column public.booking_members.refund_claimed_at is
  'Verrou anti-double-remboursement (audit 22/08/2026), courte durée de vie (~2 min) — posé juste avant tout appel stripe.refunds.create, explicitement remis à NULL par l''appelant sur échec Stripe, sinon expire seul après ~2 min (process mort). Distinct du statut métier et de montant_rembourse (preuve de succès) — un simple verrou de concurrence.';

-- Vérification : colonne présente, nullable, aucune ligne existante
-- affectée (doit être NULL pour tous les membres déjà en base).
select
  column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'booking_members' and column_name = 'refund_claimed_at';

select count(*) as lignes_non_null_inattendues
from public.booking_members
where refund_claimed_at is not null;
