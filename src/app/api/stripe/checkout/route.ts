// src/app/api/stripe/checkout/route.ts
// Port de base44/functions/stripeCheckout/entry.ts
//
// Crée une session Stripe Checkout pour les frais de réservation + frais de
// gestion. Active le transfert Stripe Connect (application_fee_amount) si le
// pro a terminé son onboarding. Accessible sans authentification : les
// invités non connectés doivent pouvoir payer leur place dans une résa de groupe.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion } from '@/lib/booking-utils';

// Origines autorisées pour successUrl / cancelUrl (open redirect mitigation).
// On valide contre l'origine de la requête entrante (header Origin/Host) pour
// supporter n'importe quel domaine sans hardcoder les URLs Vercel preview.
function isAllowedOrigin(url: string, reqOrigin: string | null, reqHost: string | null): boolean {
  try {
    const { origin } = new URL(url);

    // Même origine que l'appelant (frontend → API sur le même domaine)
    if (reqOrigin && origin === reqOrigin) return true;
    if (reqHost) {
      const proto = reqHost.startsWith('localhost') ? 'http' : 'https';
      if (origin === `${proto}://${reqHost}`) return true;
    }

    // Origines statiques (env var optionnelle + localhost dev)
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
    const supabase = createServiceRoleClient();
    const body = await req.json();
    const {
      amount,
      currency = 'eur',
      bookingMeta,
      successUrl,
      cancelUrl,
      fraisGestion: fraisGestionInput,
      groupSize = 1,
    } = body;

    // ── Validation des URLs (open redirect mitigation) ─────────────────────
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

    if (parseInt(groupSize, 10) > 23) {
      return NextResponse.json(
        { error: 'Les groupes sont limités à 23 personnes maximum' },
        { status: 400 }
      );
    }

    // ── Validation du montant contre le prix réel en base (anti-tampering) ─
    // Empêche de forger une requête avec amount=0.01 pour payer presque rien.
    if (bookingMeta?.bookingId) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('service_id')
        .eq('id', bookingMeta.bookingId)
        .maybeSingle();

      if (booking?.service_id) {
        const { data: service } = await supabase
          .from('services')
          .select('deposit')
          .eq('id', booking.service_id)
          .maybeSingle();

        if (service && Math.abs(amount - service.deposit) > 0.01) {
          console.warn(
            `[Checkout] Montant invalide — attendu ${service.deposit}€, reçu ${amount}€ (booking=${bookingMeta.bookingId})`
          );
          return NextResponse.json(
            { error: 'Montant ne correspond pas au service réservé' },
            { status: 400 }
          );
        }
      }

      // Vérifie que le memberId appartient bien au bookingId (IDOR mitigation)
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

    // Mode test/live dynamique — lit app_config (équivalent AppConfig Base44)
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

    // Barème dynamique des frais de gestion (avec fallback local si AppConfig absent)
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

      if (amount >= 100) fraisGestion = cfg.frais_gestion_palier_4 ?? 2.5;
      else if (amount >= 80) fraisGestion = cfg.frais_gestion_palier_3 ?? 2.3;
      else if (amount >= 50) fraisGestion = cfg.frais_gestion_palier_2 ?? 2.1;
      else fraisGestion = cfg.frais_gestion_palier_1 ?? calcFraisGestion(amount);
    }

    // Compte Stripe Connect du pro, si onboarding terminé
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

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Frais de réservation — ${bookingMeta?.serviceName || "Book'nPay"}`,
              description: `${bookingMeta?.bizName || ''} — ${bookingMeta?.date || ''} à ${bookingMeta?.time || ''}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
        {
          price_data: {
            currency,
            product_data: {
              name: "Frais de gestion Book'nPay",
              description: 'Frais de réservation sécurisée',
            },
            unit_amount: Math.round(fraisGestion * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: bookingMeta?.clientEmail || undefined,
      metadata: {
        bookingId: bookingMeta?.bookingId || '',
        memberId: bookingMeta?.memberId || '',
        groupRef: bookingMeta?.groupRef || '',
        bizId: bookingMeta?.bizId || '',
        bizName: bookingMeta?.bizName || '',
        serviceName: bookingMeta?.serviceName || '',
        date: bookingMeta?.date || '',
        time: bookingMeta?.time || '',
        clientName: bookingMeta?.clientName || '',
        clientPhone: bookingMeta?.clientPhone || '',
        clientEmail: bookingMeta?.clientEmail || '',
        depositAmount: String(amount),
      },
    };

    if (professionalStripeId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: Math.round(fraisGestion * 100),
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
