// src/app/api/cron/relance-onboarding-pro/route.ts
// Rappel quotidien (0 8 * * *) pour les pros dont l'établissement n'est pas
// encore publié — onboarding abandonné en cours de route.
// Cible : businesses.is_published = false, créés depuis 24 à 48h.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { isValidBearerSecret } from '@/lib/constant-time';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const now = new Date();
  const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  // Pros dont l'établissement a été créé entre 24h et 48h, pas encore publié
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, name, owner_id, open_time, close_time, open_days')
    .eq('is_published', false)
    .eq('frozen', false)
    .gte('created_at', h48ago)
    .lte('created_at', h24ago);

  if (!businesses || businesses.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  }

  const bizIds = businesses.map((b) => b.id);

  // Récupère en parallèle : emails des owners, comptes de services, statuts Stripe
  const [{ data: owners }, { data: serviceCounts }, { data: stripeSettings }] = await Promise.all([
    supabase.from('app_users').select('id, name').in('id', businesses.map((b) => b.owner_id).filter(Boolean) as string[]),
    supabase.from('services').select('biz_id').in('biz_id', bizIds),
    supabase.from('business_settings').select('biz_id, stripe_onboarding_complete').in('biz_id', bizIds),
  ]);

  // Récupère les emails des owners via auth.users (service role nécessaire)
  const ownerIds = businesses.map((b) => b.owner_id).filter(Boolean) as string[];
  const emailMap: Record<string, string> = {};
  for (const uid of ownerIds) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(uid);
      if (user?.email) emailMap[uid] = user.email;
    } catch { /* ignore */ }
  }

  const servicesPerBiz = new Set((serviceCounts ?? []).map((s) => s.biz_id));
  const stripePerBiz: Record<string, boolean> = {};
  for (const s of stripeSettings ?? []) {
    stripePerBiz[s.biz_id] = !!s.stripe_onboarding_complete;
  }
  const ownerNameMap: Record<string, string> = {};
  for (const o of owners ?? []) {
    ownerNameMap[o.id] = o.name;
  }

  const results = { sent: 0, skipped: 0, errors: 0 };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app';

  for (const biz of businesses) {
    const email = biz.owner_id ? emailMap[biz.owner_id] : null;
    if (!email) { results.skipped++; continue; }

    const step1Done = !!(biz.open_time && biz.close_time && biz.open_days?.length > 0);
    const step2Done = servicesPerBiz.has(biz.id);
    const step3Done = stripePerBiz[biz.id] ?? false;

    const missing: string[] = [];
    if (!step1Done) missing.push('• Vos horaires d\'ouverture');
    if (!step2Done) missing.push('• Au moins une prestation (prix, durée)');
    if (!step3Done) missing.push('• Connexion Stripe pour recevoir les paiements');

    const ownerName = biz.owner_id ? (ownerNameMap[biz.owner_id] ?? 'Partenaire') : 'Partenaire';

    const text = missing.length > 0
      ? `Bonjour ${ownerName},\n\nVous avez commencé votre inscription sur Book'nPay pour "${biz.name}" mais il vous reste ${missing.length} étape(s) à finaliser :\n\n${missing.join('\n')}\n\nReprenez là où vous vous étiez arrêté :\n👉 ${siteUrl}/pro/onboarding\n\nDès que c'est fait, votre établissement sera visible et réservable par vos clients.\n\nÀ bientôt,\nL'équipe Book'nPay`
      : `Bonjour ${ownerName},\n\nToutes vos étapes sont complètes ! Connectez-vous pour publier "${biz.name}" :\n👉 ${siteUrl}/pro/onboarding\n\nÀ bientôt,\nL'équipe Book'nPay`;

    const subject = missing.length > 0
      ? `⏳ "${biz.name}" — encore ${missing.length} étape(s) pour publier sur Book'nPay`
      : `✅ "${biz.name}" — prêt à publier sur Book'nPay !`;

    try {
      await sendEmail({ to: email, subject, text });
      results.sent++;
    } catch (e: any) {
      console.error(`[cron/relance-onboarding-pro] Erreur email ${email}:`, e.message);
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, processed: businesses.length, ...results });
}
