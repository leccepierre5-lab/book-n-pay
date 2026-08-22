// src/app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion, INVITE_EXPIRY_MS } from '@/lib/booking-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { isNonRealBusiness } from '@/lib/queries/catalog';
import { getStripeClientWithMode } from '@/lib/stripe/client';
import { RETRACTION_CONSENT_VERSION } from '@/lib/legal';

function isAllowedOrigin(url: string, reqOrigin: string | null, reqHost: string | null): boolean {
  try {
    const { origin } = new URL(url);
    if (reqOrigin && origin === reqOrigin) return true;
    if (reqHost) {
      const proto = reqHost.startsWith('localhost') ? 'http' : 'https';
      if (origin === `${proto}://${reqHost}`) return true;
    }
    const staticAllowed = [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.NEXT_PUBLIC_SITE_URL,
    ].filter(Boolean) as string[];
    return staticAllowed.some((o) => origin === new URL(o).origin);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // SECURITY_TODO.md #3 — limite la création de sessions Stripe par IP.
    // Généreux car un même réseau (salon, événement de groupe) peut légitimement
    // créer plusieurs paiements en peu de temps.
    const { allowed } = await checkRateLimit(`stripe-checkout:${getClientIp(req)}`, 30, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const supabase = createServiceRoleClient();

    // ⚠️ CORRECTIF SÉCURITÉ (audit) : clientUserId était auparavant lu tel
    // quel depuis le body — n'importe qui connaissant l'UUID app_users d'un
    // tiers pouvait se faire passer pour lui et consommer son stock de
    // réduction de parrainage. On dérive maintenant l'identité depuis la
    // session authentifiée côté serveur ; un appel sans session (paiement
    // invité via /pay/[memberId]) reste volontairement sans réduction.
    const userClient = await createClient();
    const { data: authData } = await userClient.auth.getUser();
    const clientUserId = authData.user?.id || '';

    const body = await req.json();
    const {
      amount,
      currency = 'eur',
      bookingMeta,
      successUrl,
      cancelUrl,
      fraisGestion: fraisGestionInput,
      quantity = 1,
      groupSize = 1,
      retractionConsent,
    } = body;

    if (!successUrl || !cancelUrl) {
      return NextResponse.json({ error: 'successUrl et cancelUrl requis' }, { status: 400 });
    }

    // ── Consentement rétractation (art. L221-28 1° C. conso, mécanisme —
    // texte définitif en attente CCI, voir lib/legal.ts) — jamais fait
    // confiance à l'état React, un appel direct à l'API doit être rejeté
    // sans la case cochée. Ne s'applique qu'aux vraies réservations
    // (bookingMeta.bookingId non vide) : le parcours démo testeur
    // (bookings/create, bookingId='') n'a pas de booking_members où écrire
    // la preuve, et n'exécute aucune vraie prestation.
    if (bookingMeta?.bookingId && retractionConsent !== true) {
      return NextResponse.json(
        { error: 'La confirmation de démarrage anticipé de la prestation est requise pour continuer.' },
        { status: 400 }
      );
    }
    const reqOrigin = req.headers.get('origin');
    const reqHost = req.headers.get('host');
    if (!isAllowedOrigin(successUrl, reqOrigin, reqHost) || !isAllowedOrigin(cancelUrl, reqOrigin, reqHost)) {
      return NextResponse.json({ error: 'URL de redirection non autorisée' }, { status: 400 });
    }

    const resolvedQty = Math.max(1, parseInt(String(quantity), 10) || 1);
    if (resolvedQty > 23 || parseInt(groupSize, 10) > 23) {
      return NextResponse.json(
        { error: 'Les groupes sont limités à 23 personnes maximum' },
        { status: 400 }
      );
    }

    // ── Réduction de parrainage — lue côté serveur, jamais depuis le client ──
    let referralDiscountPct = 0;
    let freeManagementFee = false;
    if (clientUserId) {
      const { data: userProfile } = await supabase
        .from('app_users')
        .select('referral_discounts_available, pending_referral_discount_pct, free_management_fees_available')
        .eq('id', clientUserId)
        .maybeSingle();
      // Priorité : stock parrain -20% > filleul -10% (jamais les deux simultanément)
      referralDiscountPct = (userProfile?.referral_discounts_available || 0) > 0
        ? 20
        : (userProfile?.pending_referral_discount_pct || 0);
      freeManagementFee = (userProfile?.free_management_fees_available || 0) > 0;
    }

    // ── Validation du montant contre le prix réel en base (anti-tampering) ──
    let serviceDeposit: number | null = null;
    // Prix de la prestation — nécessaire plus bas pour le barème des frais de
    // gestion (CGU Art. 2 / page /tarifs : le palier dépend du PRIX, pas du
    // dépôt). Hors du if(service) pour rester lisible au niveau du calcul du
    // palier, sans dupliquer la requête.
    let servicePrice: number | null = null;
    if (bookingMeta?.bookingId) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('service_id, biz_id, is_demo, status, payment_deadline')
        .eq('id', bookingMeta.bookingId)
        .maybeSingle();

      // ⚠️ CORRECTIF (audit 26/07) : cette route (partagée solo + groupe, voir
      // le scope de sessionParams.expires_at plus bas) ne vérifiait jamais
      // payment_deadline ni bookings.status avant de créer une session Stripe
      // — contrairement à group/pay-for-member/route.ts qui, lui, le fait.
      // Un invité pouvait donc obtenir une session de paiement valide pour un
      // groupe déjà expiré/dissous côté base (le seul filet réel dépendait de
      // l'expiration effective — cron 1x/jour ou polling lazy — pas d'un
      // blocage à la source). `payment_deadline` n'est jamais posé sur une
      // réservation solo (voir bookings/create/route.ts) : ce check ne
      // s'applique donc naturellement qu'aux réservations de groupe.
      if (booking?.status === 'cancelled') {
        return NextResponse.json({ error: 'Cette réservation a été annulée.' }, { status: 410 });
      }
      if (booking?.payment_deadline && booking.payment_deadline <= new Date().toISOString()) {
        return NextResponse.json({ error: 'Le délai de paiement pour cette réservation est expiré.' }, { status: 410 });
      }

      // Défense en profondeur — bookings/create[-group] bloque déjà la
      // création sur une fiche démo (isNonRealBusiness), mais ce point-ci
      // est celui où l'argent change réellement de main (Stripe) : le
      // revérifier ici coûte une requête et évite qu'un futur chemin de
      // création oublie le même garde-fou (pattern déjà vu 3x cette
      // session — cancel/refund-gesture/use-joker, puis connect-onboarding/
      // connect-status, avaient chacun le même bug dupliqué séparément).
      // Même helper que le noindex SEO / bookings/create — source unique.
      // `booking.is_demo` (migration 0040) contourne ce garde-fou pour les
      // groupes démo mode B : l'appelant ici peut être un invité anonyme qui
      // a suivi le lien, pas forcément le testeur whitelisté qui a créé le
      // groupe — le vetting a déjà eu lieu à la création (bookings/create-
      // group), inutile et impossible de revérifier l'email de l'appelant ici.
      if (booking?.biz_id) {
        const { data: bizOwner } = await supabase
          .from('businesses')
          .select('owner_id, slug')
          .eq('id', booking.biz_id)
          .maybeSingle();
        if (!bizOwner || (isNonRealBusiness(bizOwner) && !booking.is_demo)) {
          console.error(`[Checkout] Tentative de paiement sur une fiche non réelle — booking=${bookingMeta.bookingId} biz=${booking.biz_id}`);
          return NextResponse.json({ error: "Cet établissement n'est pas disponible à la réservation." }, { status: 423 });
        }
      }

      if (booking?.service_id) {
        const { data: service } = await supabase
          .from('services')
          .select('deposit, price')
          .eq('id', booking.service_id)
          .maybeSingle();

        if (service) {
          serviceDeposit = service.deposit;
          servicePrice = service.price;

          // ⚠️ CORRECTIF (LOT 2 #1, audit tarification 27/07) : pro/services
          // bloque désormais la création/édition d'un service avec un dépôt
          // sous 1€ (plancher Stripe de facto, voir le check générique
          // `amount < 1` plus bas) — mais un service créé AVANT ce correctif
          // peut encore porter un dépôt à 0€ en base. Sans ce check, le
          // client allait jusqu'au bout du tunnel (fiche→prestation→créneau)
          // avant de tomber sur l'erreur générique "Montant invalide", sans
          // comprendre que c'est le SERVICE qui est mal configuré, pas sa
          // saisie. Message dédié, plus clair, avant le check générique.
          if (service.deposit < 1) {
            console.error(`[Checkout] Service avec dépôt < 1€ (mal configuré) — service=${booking.service_id} deposit=${service.deposit}`);
            return NextResponse.json(
              { error: "Ce service n'est pas disponible à la réservation en ligne pour le moment. Merci de contacter directement l'établissement." },
              { status: 422 }
            );
          }

          // Calcul du dépôt effectif après réduction (fait côté serveur)
          const expectedDeposit = referralDiscountPct > 0
            ? Math.round(service.deposit * (1 - referralDiscountPct / 100) * 100) / 100
            : service.deposit;

          if (Math.abs(amount - expectedDeposit) > 0.02) {
            console.warn(
              `[Checkout] Montant invalide — attendu ${expectedDeposit}€, reçu ${amount}€ (booking=${bookingMeta.bookingId})`
            );
            return NextResponse.json(
              { error: 'Montant ne correspond pas au service réservé' },
              { status: 400 }
            );
          }
        }
      }

      if (bookingMeta?.memberId) {
        const { data: member } = await supabase
          .from('booking_members')
          .select('id')
          .eq('id', bookingMeta.memberId)
          .eq('booking_id', bookingMeta.bookingId)
          .maybeSingle();

        if (!member) {
          return NextResponse.json({ error: 'Membre introuvable pour cette réservation' }, { status: 404 });
        }
      }
    }

    // Filet générique final — couvre les cas sans service identifiable
    // (bookingId absent, service_id absent) où le check dédié ci-dessus n'a
    // pas pu s'appliquer. Volontairement placé APRÈS le check dédié : un
    // service mal configuré doit renvoyer le message clair ci-dessus, pas
    // celui-ci.
    if (!amount || amount < 1) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
    }

    // ── Dépôt effectif = amount, la réduction est déjà appliquée ─────────────
    // ⚠️ CORRECTIF (audit 22/08) : `amount` reçu du client EST déjà le dépôt
    // réduit — StepPayment.tsx calcule `service.deposit * (1 - discountPct/100)`
    // et envoie ce résultat (jamais le dépôt brut). Quand un service est
    // identifiable, `amount` vient même d'être validé ligne 198-200 comme égal
    // à `service.deposit * (1 - referralDiscountPct/100)` — donc déjà réduit.
    // Réappliquer le ratio ici (ancien code : `amount * ratio`) réduisait donc
    // le dépôt UNE SECONDE FOIS : un client à -20% était en réalité facturé
    // -36% (10€ → 6,40€ au lieu de 8€), perte silencieuse sur chaque
    // réservation avec parrainage actif. Voir
    // tests/unit/checkout-referral-discount-double-application.test.ts.
    const effectiveDeposit = amount;

    // ── Mode test/live ────────────────────────────────────────────────────────
    const { stripe, isTestMode } = await getStripeClientWithMode(supabase);

    // ── Barème frais de gestion — TOUJOURS recalculé côté serveur ─────────────
    // ⚠️ CORRECTIF SÉCURITÉ (audit architecture, 20/07) : `fraisGestionInput`
    // n'était revalidé que s'il sortait d'une fourchette large [1.99, 9.99] —
    // un appelant pouvait donc envoyer n'importe quelle valeur À L'INTÉRIEUR
    // de cette fourchette et manipuler directement la commission Book'nPay
    // (le montant sert à la fois au prix facturé et à `application_fee_amount`
    // plus bas). Même invariant que le reste de cette route (montant/dépôt
    // déjà relu en base) : ne jamais faire confiance à un paramètre client.
    // `fraisGestionInput` n'est plus utilisé pour le calcul, uniquement pour
    // détecter une tentative de falsification (log, pas de blocage — la
    // valeur envoyée est simplement ignorée).
    const { data: configs } = await supabase
      .from('app_config')
      .select('key, value')
      .like('key', 'frais_gestion_palier_%');

    const cfg: Record<string, number> = {};
    (configs || []).forEach((row) => {
      const n = parseFloat(row.value);
      if (!isNaN(n)) cfg[row.key] = n;
    });

    // ⚠️ CORRECTIF (audit tarification 27/07) : ce bloc appliquait le barème
    // sur `amount` — qui est le DÉPÔT (voir la validation anti-tampering plus
    // haut, `amount` == `service.deposit`), pas le PRIX. Or le barème CGU
    // Art. 2 et la page /tarifs sont explicites : "le montant des frais
    // varie selon le PRIX de la prestation réservée". Le dépôt étant
    // généralement bien inférieur au prix, le palier facturé tombait
    // systématiquement en-dessous de celui affiché au client par
    // StepPayment.tsx (qui, lui, appelle déjà correctement
    // `calcFraisGestion(service.price)`) — écart entre prix annoncé avant
    // paiement et prix réellement débité, sur chaque réservation.
    // Seuils lus UNE SEULE fois, via `calcFraisGestion` (booking-utils.ts,
    // même helper que le front) — volontairement pas réimplémentés ici en
    // `amount > 100 / > 80 / > 50` : c'est cette duplication qui a permis à
    // l'écart prix/dépôt de passer inaperçu. `servicePrice` peut être `null`
    // si la prestation n'a pas pu être relue en base (edge case) : on retombe
    // alors sur `amount` plutôt que de faire échouer le paiement.
    // ⚠️ Vérifié (28/07, question posée en revue) : ce fallback réintroduit
    // le bug corrigé ci-dessus, mais UNIQUEMENT sur le parcours démo testeur
    // whitelisté (bookings/create/route.ts — fiche sans propriétaire réel +
    // email dans DEMO_TESTER_EMAILS, bookingId renvoyé vide donc jamais de
    // service à relire ici) — jamais atteignable par un client réel. Même
    // atteint : en mode live, le garde Connect obligatoire plus bas (pas de
    // stripe_account_id sur une fiche sans propriétaire) renvoie 423 avant
    // toute création de session Stripe ; en mode test, c'est de l'argent
    // Stripe TEST dans le bac à sable du testeur. Verrouillé par un test
    // dédié (checkout-frais-gestion-price.test.ts) plutôt que laissé
    // silencieux.
    const baseFraisGestion = calcFraisGestion(servicePrice ?? amount);
    // Override admin (AdminDashboard → app_config.frais_gestion_palier_*) :
    // ajuste la VALEUR d'un palier déjà identifié par calcFraisGestion, ne
    // redéfinit jamais ses seuils.
    const configKeyByDefaultFee: Record<number, string> = {
      2.5: 'frais_gestion_palier_4',
      2.3: 'frais_gestion_palier_3',
      2.1: 'frais_gestion_palier_2',
      1.99: 'frais_gestion_palier_1',
    };
    const overrideKey = configKeyByDefaultFee[baseFraisGestion];
    let fraisGestion: number = (overrideKey && cfg[overrideKey] != null) ? cfg[overrideKey] : baseFraisGestion;

    if (fraisGestionInput !== undefined && Math.abs(Number(fraisGestionInput) - fraisGestion) > 0.02) {
      console.warn(
        `[Checkout] fraisGestion falsifié ignoré — reçu ${fraisGestionInput}€, palier réel appliqué ${fraisGestion}€ (price=${servicePrice ?? 'inconnu'}, amount=${amount})`
      );
    }

    // Frais de gestion offerts (bonus palier parrainage) — s'applique indépendamment du %
    if (freeManagementFee) fraisGestion = 0;

    // ── Compte Stripe Connect du pro ──────────────────────────────────────────
    let professionalStripeId: string | null = null;
    if (bookingMeta?.bizId) {
      const { data: settings } = await supabase
        .from('business_settings')
        .select('stripe_account_id, stripe_onboarding_complete')
        .eq('biz_id', bookingMeta.bizId)
        .maybeSingle();

      if (settings?.stripe_account_id && settings.stripe_onboarding_complete) {
        professionalStripeId = settings.stripe_account_id;
      }
    }

    // ── Garde-fou Connect obligatoire hors mode test ──────────────────────────
    // ⚠️ CORRECTIF (audit, 18/07) : jusqu'ici, l'absence de compte Connect
    // finalisé n'empêchait jamais de payer — le paiement partait simplement
    // sans transfer_data.destination, donc intégralement chez Book'nPay, sans
    // personne à qui le reverser. mode_test_paiement=true reste volontairement
    // permissif (fixtures/audit, aucun argent réel en jeu — c'est ce qui a
    // permis tous les tests de cette session sur fixture-pro-audit, qui n'a
    // pas de compte Connect). Mais en mode live, un business sans Connect
    // finalisé (stripe_onboarding_complete garanti aligné sur charges_enabled
    // réel, voir connect-status/route.ts) ne doit structurellement jamais
    // pouvoir encaisser — même trou que d39f340, cette fois indépendant de
    // isNonRealBusiness (viserait aussi un vrai pro dont l'onboarding Stripe
    // ne serait pas terminé).
    if (!isTestMode && !professionalStripeId) {
      console.error(
        `[Checkout] Paiement live refusé — compte Connect non finalisé — biz=${bookingMeta?.bizId || 'inconnu'}`
      );
      return NextResponse.json(
        { error: "Cet établissement n'est pas encore prêt à recevoir des paiements." },
        { status: 423 }
      );
    }

    // ── Construction de la session Stripe ────────────────────────────────────
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency,
          product_data: {
            name: referralDiscountPct > 0
              ? `Frais de réservation — ${bookingMeta?.serviceName || "Book'nPay"} (-${referralDiscountPct}% parrainage)`
              : `Frais de réservation — ${bookingMeta?.serviceName || "Book'nPay"}`,
            description: `${bookingMeta?.bizName || ''} — ${bookingMeta?.date || ''} à ${bookingMeta?.time || ''}`,
          },
          unit_amount: Math.round(effectiveDeposit * 100),
        },
        quantity: resolvedQty,
      },
      {
        price_data: {
          currency,
          product_data: {
            name: freeManagementFee ? "Frais de gestion Book'nPay — Offerts" : "Frais de gestion Book'nPay",
            description: freeManagementFee ? 'Bonus palier parrainage — frais offerts' : 'Frais de réservation sécurisée',
          },
          unit_amount: Math.round(fraisGestion * 100),
        },
        quantity: 1,
      },
    ];

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: bookingMeta?.clientEmail || undefined,
      metadata: {
        bookingId: bookingMeta?.bookingId || '',
        memberId: bookingMeta?.memberId || '',
        groupRef: bookingMeta?.groupRef || '',
        // Mode A: tous les membres à marquer payés (séparés par virgule)
        allMemberIds: bookingMeta?.allMemberIds || '',
        // Mode B: membres invités (pour affichage liens sur confirmation)
        guestMemberIds: bookingMeta?.guestMemberIds || '',
        bizId: bookingMeta?.bizId || '',
        bizName: bookingMeta?.bizName || '',
        serviceName: bookingMeta?.serviceName || '',
        date: bookingMeta?.date || '',
        time: bookingMeta?.time || '',
        clientName: bookingMeta?.clientName || '',
        clientPhone: bookingMeta?.clientPhone || '',
        clientEmail: bookingMeta?.clientEmail || '',
        depositAmount: String(effectiveDeposit),
        fraisGestion: String(Math.round(fraisGestion * 100) / 100),
        groupQuantity: String(resolvedQty),
        clientUserId: clientUserId || '',
        referralDiscountPct: String(referralDiscountPct),
        hasFreeManagementFee: freeManagementFee ? 'true' : 'false',
        // Traçabilité dashboard Stripe uniquement — bookingId/memberId vides
        // pour une session démo font déjà que le webhook no-op proprement
        // (voir stripe/webhook/route.ts), ce flag ne change aucun comportement.
        isDemo: bookingMeta?.isDemo ? 'true' : 'false',
      },
    };

    if (professionalStripeId) {
      sessionParams.payment_intent_data = {
        // Book'nPay garde ses frais de gestion (0 si offert via bonus palier parrainage)
        application_fee_amount: freeManagementFee ? 0 : Math.round(fraisGestion * 100),
        transfer_data: { destination: professionalStripeId },
      };
    }

    // Scope volontairement restreint aux réservations SOLO (pas de groupRef
    // dans bookingMeta) : c'est le flux concerné par le bug "invite bloqué à
    // vie" (voir diagnostic 17/07). Les groupes ont déjà leur propre filet
    // (payment_deadline 20min + cron expire-groups), qu'on ne touche pas ici.
    // 30 min = plancher dur Stripe pour expires_at (rien en dessous n'est
    // accepté), aligné sur INVITE_EXPIRY_MS posé côté booking_members.
    if (!bookingMeta?.groupRef) {
      sessionParams.expires_at = Math.floor(Date.now() / 1000) + Math.floor(INVITE_EXPIRY_MS / 1000);
    }

    // Timestamp posé côté serveur, jamais transmis par le client — même
    // pattern que cgu_accepted_at (auth/register/route.ts). Écrit UNIQUEMENT
    // sur bookingMeta.memberId — celui qui paie et coche cette case précise
    // (l'organisateur en Mode A : bookingMeta.memberId == primaryMemberId,
    // voir StepPayment.tsx/ModeAPayment). Ne JAMAIS propager aux autres
    // membres d'un groupe (allMemberIds) : eux n'ont rien coché, une
    // écriture sur leur ligne fabriquerait une preuve de consentement
    // personnelle inexacte — pire qu'une absence de preuve en cas de litige.
    if (bookingMeta?.bookingId && retractionConsent === true && bookingMeta.memberId) {
      await supabase
        .from('booking_members')
        .update({
          retraction_consent_at: new Date().toISOString(),
          retraction_consent_version: RETRACTION_CONSENT_VERSION,
        })
        .eq('id', bookingMeta.memberId);
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    return logAndRespond('[Checkout] Erreur:', error);
  }
}
