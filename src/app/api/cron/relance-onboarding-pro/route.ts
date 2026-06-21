// src/app/api/cron/relance-onboarding-pro/route.ts
// Port de base44/functions/relanceOnboardingPro/entry.ts
// Relance les candidatures pro en attente depuis 24-48h, avec une checklist
// de ce qui manque pour finaliser (Stripe, Google Maps, créneaux).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: applications } = await supabase
    .from('partner_applications')
    .select('*')
    .eq('status', 'pending');

  const now = Date.now();
  const H24 = 24 * 60 * 60 * 1000;

  const toRemind = (applications || []).filter((app) => {
    const updatedAt = new Date(app.created_at).getTime();
    const age = now - updatedAt;
    return age >= H24 && age < H24 * 2;
  });

  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const app of toRemind) {
    if (!app.email) {
      results.skipped++;
      continue;
    }

    const missingItems: string[] = [];
    if (!app.stripe_connected) missingItems.push('• Connexion Stripe (obligatoire pour encaisser)');
    if (!app.google_maps_url) missingItems.push('• Lien Google Maps');
    if (!app.creneaux || (app.creneaux as any[]).length === 0) missingItems.push('• Vos disponibilités');

    const text =
      missingItems.length > 0
        ? `Bonjour ${app.gerant || 'Partenaire'},\n\nVous avez commencé votre inscription sur Book'nPay pour "${app.etablissement}" mais il vous reste quelques étapes à finaliser :\n\n${missingItems.join('\n')}\n\nReprenez votre inscription en 2 minutes :\n👉 ${process.env.NEXT_PUBLIC_SITE_URL}/devenir-partenaire\n\nÀ bientôt,\nL'équipe Book'nPay`
        : `Bonjour ${app.gerant || 'Partenaire'},\n\nVotre dossier pour "${app.etablissement}" est en cours de validation par notre équipe.\n\nNous vous contacterons dans les 48h ouvrées à cette adresse.\n\nÀ bientôt,\nL'équipe Book'nPay`;

    try {
      await sendEmail({
        to: app.email,
        subject:
          missingItems.length > 0
            ? `⏳ Finalisez votre inscription Book'nPay — il vous reste ${missingItems.length} étape(s)`
            : '✅ Votre dossier est en cours de traitement',
        text,
      });
      results.sent++;
    } catch (e: any) {
      console.error(`Erreur email pour ${app.email}:`, e.message);
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, processed: toRemind.length, ...results });
}
