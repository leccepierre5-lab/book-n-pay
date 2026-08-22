-- supabase/migrations/0064_refund_failures_type.sql
-- Bug trouvé le 22/08/2026 en préparant le point 3 de l'audit (verrou
-- anti-double-remboursement, migration 0063) : refund_failures ne distingue
-- pas deux échecs de nature très différente qui appellent tous les deux
-- insertRefundFailure() :
--   - stripe.refunds.create() a échoué : rien n'a été remboursé au client.
--   - stripe.refunds.create() a RÉUSSI, seule la récupération du dépôt
--     auprès du pro (reverseConnectedAccountTransfer, transfers.createReversal)
--     a échoué ensuite : le client est déjà remboursé.
-- /admin/refund-failures/[id]/retry rejoue aujourd'hui stripe.refunds.create
-- sans distinction sur TOUTE ligne 'open' — un admin qui clique "relancer"
-- sur une ligne du second type déclenche un DEUXIÈME remboursement réel sur
-- un payment_intent déjà remboursé.
--
-- Diagnostic en lecture seule (22/08/2026, script jetable, jamais commité) :
-- 2 lignes en base, les deux 'resolved', les deux refund-failed (aucune
-- reversal-failed) — le bug n'a pas encore produit de doublon connu, mais
-- rien ne l'empêchait avant ce correctif.
alter table public.refund_failures
  add column if not exists failure_type text not null default 'refund'
  check (failure_type in ('refund', 'reverse_transfer'));

comment on column public.refund_failures.failure_type is
  'refund = stripe.refunds.create() a echoue, rien n''a ete rembourse au client, le retry admin doit rejouer le refund. reverse_transfer = le refund Stripe a reussi, seule la recuperation du depot aupres du pro a echoue ensuite, le retry admin ne doit JAMAIS rappeler stripe.refunds.create sur cette ligne (double remboursement reel), uniquement reverseConnectedAccountTransfer.';

-- Vérification : colonne présente, NOT NULL, contrainte check active, les
-- 2 lignes existantes valent bien 'refund' (comportement par défaut correct
-- confirmé par le diagnostic ci-dessus).
select
  column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'refund_failures' and column_name = 'failure_type';

select failure_type, count(*) as nb
from public.refund_failures
group by failure_type;
