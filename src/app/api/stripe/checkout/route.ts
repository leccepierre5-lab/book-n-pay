// src/app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion, INVITE_EXPIRY_MS } from '@/lib/booking-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { isNonRealBusiness } from '@/lib/queries/catalog';
import { getStripeClientWithMode } from '@/lib/stripe/client';

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
    } = body;

    if (!successUrl || !cancelUrl) {
      return NextResponse.json({ error: 'successUrl et cancelUrl requis' }, { status: 400 });
    }
    const reqOrigin = req.headers.get('origin');
    const reqHost = req.headers.get('host');
    if (!isAllowedOrigin(successUrl, reqOrigin, reqHost) || !isAllowedOrigin(cancelUrl, reqOrigin, reqHost)) {
      return NextResponse.json({ error: 'URL de redirection non autorisée' }, { status: 400 });
    }

    if (!amount || amount < 1) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
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
    if (bookingMeta?.bookingId) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('service_id, biz_id, is_demo')
        .eq('id', bookingMeta.bookingId)
        .maybeSingle();

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

    // ── Calcul du dépôt effectif ──────────────────────────────────────────────
    // Le ratio s'applique sur le prix total → répercuté sur le dépôt
    const ratio = referralDiscountPct > 0 ? (1 - referralDiscountPct / 100) : 1;
    const effectiveDeposit = Math.round(amount * ratio * 100) / 100;

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

    let fraisGestion: number;
    if (amount > 100) fraisGestion = cfg.frais_gestion_palier_4 ?? 2.5;
    else if (amount > 80) fraisGestion = cfg.frais_gestion_palier_3 ?? 2.3;
    else if (amount > 50) fraisGestion = cfg.frais_gestion_palier_2 ?? 2.1;
    else fraisGestion = cfg.frais_gestion_palier_1 ?? calcFraisGestion(amount);

    if (fraisGestionInput !== undefined && Math.abs(Number(fraisGestionInput) - fraisGestion) > 0.02) {
      console.warn(
        `[Checkout] fraisGestion falsifié ignoré — reçu ${fraisGestionInput}€, palier réel appliqué ${fraisGestion}€ (amount=${amount})`
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

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    return logAndRespond('[Checkout] Erreur:', error);
  }
}
