// src/app/api/pro/delete-account/route.ts
// Suppression de compte pro en libre-service (RGPD art. 17). Suite à l'audit
// LOT 7 : seul admin/freeze-business existait (suspension, jamais effacement).
// Réservé au rôle 'pro' — l'admin a déjà freeze-business comme outil, une
// suppression définitive déclenchée par un tiers pour le compte d'un autre
// serait une mauvaise idée (décision actée avec Pierre, 13/08).
//
// Ordre des opérations — chaque étape doit laisser un état "rattrapable à la
// main" si l'étape suivante échoue, jamais un établissement en ligne sans
// moyen d'encaisser :
//   1. Garde-fous (réservations à venir, charges dues, solde Connect) — rien
//      n'est encore touché.
//   2. Dépublication immédiate (is_published=false, frozen=true) — AVANT
//      Stripe. Si tout le reste échoue ensuite, l'établissement est déjà
//      hors ligne, jamais l'inverse (abonnement annulé + Connect supprimé
//      mais fiche encore visible et réservable).
//   3. Stripe (annulation abonnement, suppression Connect) — un échec ici
//      arrête tout, alerte admin, ne touche pas la suite.
//   4. Mutations DB (anonymisation + suppressions réelles).
//   5. Trace de la demande (business_deletion_log).
//   6. Suppression du compte auth (cascade confirmée par requête FK du
//      13/08/2026 — voir migration 0048 pour le détail).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';
import { getParisDateOffsetStr } from '@/lib/booking-utils';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password) return NextResponse.json({ error: 'Mot de passe requis' }, { status: 400 });

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.email) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Réauthentification — valide l'identité avant de supprimer (même
    // garde-fou que côté client, auth/delete-account/route.ts).
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: auth.user.email,
      password,
    });
    if (signInError) {
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 400 });
    }

    const userId = auth.user.id;
    const admin = createServiceRoleClient();

    const { data: profile } = await admin
      .from('app_users')
      .select('biz_id, role')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.biz_id || profile.role !== 'pro') {
      return NextResponse.json({ error: 'Réservé aux comptes professionnels.' }, { status: 403 });
    }
    const bizId = profile.biz_id;

    const { data: business } = await admin
      .from('businesses')
      .select('id, name')
      .eq('id', bizId)
      .maybeSingle();
    if (!business) return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 });

    const { data: settings } = await admin
      .from('business_settings')
      .select('stripe_customer_id, stripe_subscription_id, stripe_account_id')
      .eq('biz_id', bizId)
      .maybeSingle();

    // ── Garde-fous — rien n'est encore touché en base ──────────────────────

    const today = getParisDateOffsetStr(0);
    const { data: upcoming } = await admin
      .from('bookings')
      .select('id')
      .eq('biz_id', bizId)
      .neq('status', 'cancelled')
      .gte('date', today);
    if ((upcoming?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: 'upcoming_bookings', count: upcoming!.length },
        { status: 409 }
      );
    }

    // Filtre déjà strictement sur 'pending' — une charge 'waived' (remise
    // décidée par un admin ou seuil défensif automatique, voir
    // pro-charge-billing.ts) ou 'invoiced' ne bloque jamais la suppression,
    // vérifié explicitement le 13/08 suite à la demande de Pierre sur ce
    // point précis (facturation effective des pro_charges).
    const { count: pendingChargesCount } = await admin
      .from('pro_charges')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', bizId)
      .eq('status', 'pending');
    if ((pendingChargesCount ?? 0) > 0) {
      return NextResponse.json({ error: 'pending_charges', count: pendingChargesCount }, { status: 409 });
    }

    // Même risque financier que pro_charges — un dépassement de forfait pas
    // encore facturé (trouvé en audit, pas dans la demande initiale de Pierre).
    const { count: pendingOverageCount } = await admin
      .from('overage_charges')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', bizId)
      .in('status', ['pending', 'retry_scheduled', 'failed']);
    if ((pendingOverageCount ?? 0) > 0) {
      return NextResponse.json({ error: 'pending_overage', count: pendingOverageCount }, { status: 409 });
    }

    const needsStripe = !!settings?.stripe_subscription_id || !!settings?.stripe_account_id;
    const stripe = needsStripe ? await getStripeClient(admin) : null;

    // On ne supprime pas un compte Connect qui détient encore de l'argent dû
    // au pro — solde disponible OU en attente, les deux comptent.
    if (settings?.stripe_account_id) {
      try {
        const balance = await stripe!.balance.retrieve({ stripeAccount: settings.stripe_account_id });
        const totalCents = [...balance.available, ...balance.pending].reduce((sum, b) => sum + b.amount, 0);
        if (totalCents > 0) {
          return NextResponse.json({ error: 'stripe_balance', amountCents: totalCents }, { status: 409 });
        }
      } catch (e: any) {
        return logAndRespond('[pro/delete-account] balance check:', e);
      }
    }

    // ── Dépublication immédiate — AVANT Stripe, voir commentaire en tête ────

    const { error: depublishError } = await admin
      .from('businesses')
      .update({ is_published: false, frozen: true, frozen_reason: 'Compte supprimé par le professionnel' })
      .eq('id', bizId);
    if (depublishError) return logAndRespond('[pro/delete-account] dépublication:', depublishError);

    // ── Stripe — abonnement annulé SANS remboursement (décision actée avec
    // Pierre, cohérent avec le reste du modèle : frais de gestion jamais
    // remboursés). L'écran de confirmation doit prévenir AVANT validation,
    // pas ici. Un échec ici arrête tout : l'établissement reste dépublié
    // (état sûr et rattrapable), on ne touche à rien d'autre. ─────────────

    if (settings?.stripe_subscription_id) {
      try {
        await stripe!.subscriptions.cancel(settings.stripe_subscription_id);
      } catch (e: any) {
        // Idempotence : un retry après un échec partiel précédent ne doit
        // pas re-échouer sur "déjà annulé".
        // Regex volontairement large ("already ... cancel") — Stripe formule
        // ce message de plusieurs façons ("already canceled", "already been
        // canceled"...), jamais documenté comme stable mot pour mot.
        const alreadyCancelled =
          e?.code === 'resource_missing' || /already.*cancel/i.test(e?.message || '');
        if (!alreadyCancelled) {
          await notifyAdminOnFailure('pro/delete-account:subscription-cancel', {
            processed: 0,
            failed: 1,
            failedItems: [bizId],
            failedDescriptions: [
              `business ${bizId} (${business.name}) — abonnement ${settings.stripe_subscription_id} — ${e.message}`,
            ],
          });
          return NextResponse.json(
            { error: "L'annulation de l'abonnement a échoué. Réessayez, ou contactez le support si ça persiste." },
            { status: 500 }
          );
        }
      }
    }

    if (settings?.stripe_account_id) {
      try {
        await stripe!.accounts.del(settings.stripe_account_id);
      } catch (e: any) {
        // Idempotence : compte déjà supprimé sur un retry précédent.
        const alreadyDeleted = e?.code === 'resource_missing';
        if (!alreadyDeleted) {
          await notifyAdminOnFailure('pro/delete-account:connect-delete', {
            processed: 0,
            failed: 1,
            failedItems: [bizId],
            failedDescriptions: [
              `business ${bizId} (${business.name}) — compte Connect ${settings.stripe_account_id} — ${e.message}`,
            ],
          });
          return NextResponse.json(
            { error: 'La suppression du compte Stripe a échoué. Réessayez, ou contactez le support si ça persiste.' },
            { status: 500 }
          );
        }
      }
    }

    // ── Mutations DB — séquence VÉRIFIÉE, pas une suite d'`await` optimistes.
    // Supabase-js ne permet aucune transaction multi-tables depuis ce client
    // (pas de vraie atomicité possible ici) — la garantie vient donc d'une
    // vérification explicite à CHAQUE étape : la première erreur arrête tout
    // immédiatement, avant `business_deletion_log` et avant `deleteUser()`.
    // À ce stade, Stripe est déjà traité (abonnement annulé, Connect
    // supprimé — non rejouable en sens inverse) et l'établissement déjà
    // dépublié/gelé plus haut : un échec ici laisse donc un compte hors
    // ligne et sans moyen d'encaisser, jamais un compte en ligne actif —
    // c'est l'état "rattrapable à la main" demandé par Pierre. Un retry
    // complet de la route reste sûr : chaque étape ci-dessous est
    // idempotente (delete sur des lignes déjà supprimées = no-op, update
    // avec les mêmes valeurs = no-op).
    let orphanServiceIds: string[] = [];
    try {
      // Copies dénormalisées à anonymiser AVANT de toucher staff/services —
      // staff_name identifie un TIERS (le praticien) qui n'a jamais consenti
      // séparément à cette suppression (trouvaille d'audit, validée par Pierre).
      const bizNameUpdate = await admin
        .from('bookings')
        .update({ biz_name: 'Établissement fermé', staff_name: 'Praticien' })
        .eq('biz_id', bizId);
      if (bizNameUpdate.error) throw new Error(`anonymisation bookings — ${bizNameUpdate.error.message}`);

      // services : bookings_service_id est RESTRICT — impossible de supprimer
      // un service référencé par une réservation passée. Seuls les orphelins
      // (jamais réservés) sont supprimés ; les autres restent tels quels (un
      // nom de prestation n'est pas une donnée personnelle, pas d'anonymisation
      // nécessaire).
      const { data: allServices, error: servicesErr } = await admin.from('services').select('id').eq('biz_id', bizId);
      if (servicesErr) throw new Error(`lecture services — ${servicesErr.message}`);
      const { data: usedRows, error: usedErr } = await admin.from('bookings').select('service_id').eq('biz_id', bizId);
      if (usedErr) throw new Error(`lecture service_id réservés — ${usedErr.message}`);
      const usedServiceIds = new Set((usedRows ?? []).map((r) => r.service_id).filter(Boolean));
      orphanServiceIds = (allServices ?? []).map((s) => s.id).filter((id) => !usedServiceIds.has(id));
      if (orphanServiceIds.length > 0) {
        const del = await admin.from('services').delete().in('id', orphanServiceIds);
        if (del.error) throw new Error(`suppression services orphelins — ${del.error.message}`);
      }

      // Suppression réelle — rien de valeur légale/tierce à conserver.
      // `staff` cascade sur staff_schedules + staff_absences (ON DELETE
      // CASCADE, migrations 0014/0031/0032).
      for (const [table] of [
        ['business_locations'], ['business_photos'], ['staff'],
        ['flash_slots'], ['business_reviews'], ['favorites'],
      ] as const) {
        const del = await admin.from(table).delete().eq('biz_id', bizId);
        if (del.error) throw new Error(`suppression ${table} — ${del.error.message}`);
      }

      // businesses : jamais supprimée (bookings_biz_id est RESTRICT de toute
      // façon) — anonymisée en place. is_published/frozen déjà posés plus haut.
      const bizUpdate = await admin
        .from('businesses')
        .update({
          name: 'Établissement fermé',
          phone: null,
          instagram: null,
          facebook_url: null,
          website: null,
          google_place_url: null,
        })
        .eq('id', bizId);
      if (bizUpdate.error) throw new Error(`anonymisation businesses — ${bizUpdate.error.message}`);

      // stripe_customer_id/stripe_subscription_id CONSERVÉS (décision Pierre,
      // 13/08) : identifiants techniques, pas des données personnelles au sens
      // RGPD — ils pointent vers Stripe, qui a ses propres obligations de
      // conservation comptable. stripe_account_id nullé : le compte Connect
      // n'existe plus côté Stripe, le garder serait une référence morte.
      const settingsUpdate = await admin
        .from('business_settings')
        .update({
          subscription_status: 'cancelled',
          stripe_payment_method_id: null,
          stripe_account_id: null,
          stripe_onboarding_complete: false,
          stripe_onboarding_url: null,
        })
        .eq('biz_id', bizId);
      if (settingsUpdate.error) throw new Error(`mise à jour business_settings — ${settingsUpdate.error.message}`);

      // Trace de la demande — en cas de contestation, prouver qu'elle venait
      // bien du pro authentifié. business_deletion_log.requested_by n'a pas
      // de FK vers app_users(id) : cette ligne est écrite juste avant que ce
      // compte disparaisse par cascade (voir migration 0048). Fait partie de
      // la séquence vérifiée : on ne veut pas atteindre `deleteUser()` sans
      // trace écrite.
      const logInsert = await admin.from('business_deletion_log').insert({
        biz_id: bizId,
        biz_name: business.name,
        requested_by: userId,
        deleted_summary: {
          orphan_services_deleted: orphanServiceIds.length,
          stripe_subscription_cancelled: !!settings?.stripe_subscription_id,
          stripe_connect_deleted: !!settings?.stripe_account_id,
        },
      });
      if (logInsert.error) throw new Error(`trace business_deletion_log — ${logInsert.error.message}`);
    } catch (e: any) {
      await notifyAdminOnFailure('pro/delete-account:db-mutation', {
        processed: 0,
        failed: 1,
        failedItems: [bizId],
        failedDescriptions: [
          `business ${bizId} (${business.name}) — ${e.message} — Stripe déjà traité (abonnement annulé${settings?.stripe_account_id ? '/Connect supprimé' : ''}), établissement déjà dépublié, à rattraper manuellement (compte auth PAS supprimé)`,
        ],
      });
      return NextResponse.json(
        {
          error:
            'La suppression a partiellement échoué. Votre établissement est déjà hors ligne et votre abonnement déjà résilié ; contactez le support pour finaliser.',
        },
        { status: 500 }
      );
    }

    // Suppression du compte auth — CASCADE confirmée (pg_constraint,
    // 13/08/2026) : app_users est supprimée, businesses.owner_id passe à
    // NULL, bookings.client_id (si ce pro avait aussi réservé en tant que
    // client) passe à NULL. is_published/frozen déjà posés explicitement
    // plus haut — on ne compte pas sur cet effet de bord pour dépublier.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return logAndRespond('[pro/delete-account] deleteUser:', deleteError);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return logAndRespond('[pro/delete-account]', err);
  }
}
