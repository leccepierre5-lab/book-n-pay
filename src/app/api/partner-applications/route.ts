// src/app/api/partner-applications/route.ts
// Audit 19/08 — remplace l'insert Supabase direct fait jusqu'ici par
// PartnerApplicationForm.tsx (`supabase.from('partner_applications').insert(...)`
// depuis le client, RLS `partner_applications_insert_public` WITH CHECK(true)).
// Trois raisons : (1) le honeypot n'a de sens que vérifié côté serveur — un
// contrôle côté client se contourne en une ligne ; (2) un insert public direct
// depuis le navigateur sur cette table est précisément ce qui a nécessité les
// correctifs 0034/0043 (policy INSERT trop permissive) ; (3) permet un rate
// limit, absent jusqu'ici sur ce formulaire (contrairement à /api/auth/register).
//
// La policy RLS `partner_applications_insert_public` (WITH CHECK true) reste
// inchangée pour l'instant — décision volontaire de Pierre (19/08) : d'abord
// la route, la policy se resserre séparément si besoin. Cette route utilise
// donc le service role (RLS bypass), pas la clé anon.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { CGU_VERSION } from '@/lib/legal';
import { isValidPhoneFormat, normalizePhone } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`partner-application:${getClientIp(req)}`, 5, 15 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const body = await req.json();

    // Honeypot anti-bot (même mécanisme que /api/auth/register) — `company`
    // est un champ hors-écran distinct de `website` (déjà un vrai champ
    // métier ici, le site web de l'établissement), jamais rempli par un vrai
    // visiteur. Réponse de succès factice IDENTIQUE à un vrai succès pour ne
    // pas révéler la détection à un bot qui s'adapterait sinon.
    if (body.company) {
      console.warn(`[partner-applications] Honeypot déclenché — IP ${getClientIp(req)}, champ rempli: "${body.company}"`);
      return NextResponse.json({ ok: true });
    }

    const {
      etablissement, gerant, email, phone,
      googleMapsUrl, instagram, website,
      category, categoryLabel, bizType, bookingsEstimate, practitionersCount,
      cguAccepted,
    } = body;

    if (!etablissement || !gerant || !email) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: "Sélectionnez votre catégorie d'activité." }, { status: 400 });
    }
    if (category === 'autre' && !(categoryLabel || '').trim()) {
      return NextResponse.json({ error: 'Décrivez votre secteur d\'activité.' }, { status: 400 });
    }
    if (!practitionersCount) {
      return NextResponse.json({ error: 'Sélectionnez le nombre de collaborateurs de votre établissement.' }, { status: 400 });
    }
    if (cguAccepted !== true) {
      return NextResponse.json({ error: 'Vous devez accepter les CGU/CGV pour envoyer votre candidature.' }, { status: 400 });
    }
    // Validé côté serveur depuis que cette route existe (audit 19/08) — avant
    // ça, partner_applications.phone venait d'un insert client direct, jamais
    // vérifié (voir commentaire historique dans admin/applications/route.ts).
    // Un format invalide devenait silencieusement le numéro de contact public
    // affiché sur la fiche pro à l'approbation (audit 15/08). Stocké normalisé
    // — même format que partout ailleurs (booking_members.phone, app_users.phone).
    if (phone && !isValidPhoneFormat(phone)) {
      return NextResponse.json({ error: 'Numéro de téléphone invalide.' }, { status: 400 });
    }
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    const supabase = createServiceRoleClient();
    const { error: insertError } = await supabase.from('partner_applications').insert({
      etablissement,
      gerant,
      email,
      phone: normalizedPhone,
      google_maps_url: googleMapsUrl || null,
      instagram: instagram || null,
      website: website || null,
      category,
      category_label: category === 'autre' ? ((categoryLabel || '').trim() || null) : null,
      type: (bizType || '').trim() || null,
      monthly_bookings_estimate: bookingsEstimate || null,
      practitioners_count: practitionersCount,
      cgu_accepted_at: new Date().toISOString(),
      cgu_version: CGU_VERSION,
    });

    if (insertError) throw insertError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return logAndRespond('[partner-applications]', error);
  }
}
