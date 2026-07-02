// src/app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion } from '@/lib/booking-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

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
        .select('service_id')
        .eq('id', bookingMeta.bookingId)
        .maybeSingle();

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
    const { data: testModeConfig } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'mode_test_paiement')
      .maybeSingle();
    const isTestMode = testModeConfig?.value === 'true';

    const stripeKey = isTestMode
      ? process.env.STRIPE_TEST_SECRET_KEY!
      : process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(stripeKey);

    // ── Barème frais de gestion ───────────────────────────────────────────────
    let fraisGestion = fraisGestionInput;
    if (!fraisGestion || fraisGestion < 1.99 || fraisGestion > 9.99) {
      const { data: configs } = await supabase
        .from('app_config')
        .select('key, value')
        .like('key', 'frais_gestion_palier_%');

      const cfg: Record<string, number> = {};
      (configs || []).forEach((row) => {
        const n = parseFloat(row.value);
        if (!isNaN(n)) cfg[row.key] = n;
      });

      if (amount > 100) fraisGestion = cfg.frais_gestion_palier_4 ?? 2.5;
      else if (amount > 80) fraisGestion = cfg.frais_gestion_palier_3 ?? 2.3;
      else if (amount > 50) fraisGestion = cfg.frais_gestion_palier_2 ?? 2.1;
      else fraisGestion = cfg.frais_gestion_palier_1 ?? calcFraisGestion(amount);
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
      },
    };

    if (professionalStripeId) {
      sessionParams.payment_intent_data = {
        // Book'nPay garde ses frais de gestion (0 si offert via bonus palier parrainage)
        application_fee_amount: freeManagementFee ? 0 : Math.round(fraisGestion * 100),
        transfer_data: { destination: professionalStripeId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('[Checkout] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
