import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getPlanConfig } from '@/lib/plans-config';
import BillingSetupForm from './_components/BillingSetupForm';

export default async function SetupBillingPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/setup-billing');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role, name')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) redirect('/');

  const admin = createServiceRoleClient();
  const { data: settings } = await admin
    .from('business_settings')
    .select('subscription_status, plan_key')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  // Déjà configuré → renvoie vers la prochaine étape
  if (settings?.subscription_status && settings.subscription_status !== 'pending') {
    redirect('/pro/onboarding');
  }

  const planConfig = getPlanConfig(settings?.plan_key ?? 'starter')!;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl font-bold text-white">book</span>
            <span className="text-xl font-bold text-mint-400">n</span>
            <span className="text-xl font-bold text-white">pay</span>
          </div>
          <h1 className="text-sm text-slate-400">Configurez votre facturation</h1>
        </div>

        <BillingSetupForm
          planConfig={planConfig}
          proName={profile.name ?? ''}
          proEmail={authData.user.email ?? ''}
        />
      </div>
    </div>
  );
}
