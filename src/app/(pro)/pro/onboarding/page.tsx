import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import OnboardingWizard from './_components/OnboardingWizard';

export default async function ProOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe_return?: string; stripe_refresh?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/onboarding');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) redirect('/');

  const admin = createServiceRoleClient();

  // Bloque l'accès au wizard si le billing n'est pas encore configuré.
  // ⚠️ CORRECTIF (audit — effet de bord du fix #5) : voir pro/page.tsx pour
  // le détail — on ne renvoie vers setup-billing que si aucune Subscription
  // Stripe n'a même été tentée, pas juste parce que la confirmation webhook
  // n'est pas encore arrivée.
  const { data: billingCheck } = await admin
    .from('business_settings')
    .select('subscription_status, stripe_subscription_id')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();
  if (billingCheck?.subscription_status === 'pending' && !billingCheck.stripe_subscription_id) {
    redirect('/pro/setup-billing');
  }

  const [{ data: biz }, { data: photos }, { count: servicesCount }, { data: settings }] =
    await Promise.all([
      admin
        .from('businesses')
        .select('id, name, city, type, category, open_time, close_time, open_days, instagram, facebook_url, website, is_published')
        .eq('id', profile.biz_id)
        .maybeSingle(),
      admin
        .from('business_photos')
        .select('id, url, sort_order')
        .eq('biz_id', profile.biz_id)
        .order('sort_order', { ascending: true }),
      admin
        .from('services')
        .select('id', { count: 'exact', head: true })
        .eq('biz_id', profile.biz_id),
      admin
        .from('business_settings')
        .select('stripe_onboarding_complete')
        .eq('biz_id', profile.biz_id)
        .maybeSingle(),
    ]);

  if (!biz) redirect('/pro');

  // Si déjà publié, retour au dashboard
  if (biz.is_published) redirect('/pro');

  const step1Done = !!(biz.open_time && biz.close_time && biz.open_days?.length > 0);
  const step2Done = (servicesCount ?? 0) > 0;
  const step3Done = !!settings?.stripe_onboarding_complete;

  return (
    <OnboardingWizard
      bizId={biz.id}
      bizName={biz.name}
      initialStep={!step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 4}
      step1Done={step1Done}
      step2Done={step2Done}
      step3Done={step3Done}
      stripeReturn={params.stripe_return === '1'}
      stripeRefresh={params.stripe_refresh === '1'}
      business={{
        open_time: biz.open_time,
        close_time: biz.close_time,
        open_days: biz.open_days ?? [],
        instagram: biz.instagram,
        facebook_url: biz.facebook_url,
        website: biz.website,
      }}
      photos={(photos ?? []) as { id: string; url: string; sort_order: number }[]}
    />
  );
}
