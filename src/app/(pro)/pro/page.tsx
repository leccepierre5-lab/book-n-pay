// src/app/(pro)/pro/page.tsx
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProBookings, getProStats, getBusinessSettings } from '@/lib/queries/pro';
import ProDashboard from '@/components/pro/ProDashboard';

export default async function ProPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro');

  const { data: profile } = await supabase
    .from('app_users')
    .select('*, businesses!fk_app_users_biz(*)')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile || (profile.role !== 'pro' && profile.role !== 'admin') || !profile.biz_id) {
    redirect('/');
  }

  const today = new Date().toISOString().split('T')[0];
  const [todayBookings, stats, settings] = await Promise.all([
    getProBookings(profile.biz_id, { from: today, to: today }),
    getProStats(profile.biz_id),
    getBusinessSettings(profile.biz_id),
  ]);

  return (
    <Suspense>
      <ProDashboard
        business={profile.businesses}
        todayBookings={todayBookings}
        stats={stats}
        stripeConnected={!!settings?.stripe_onboarding_complete}
      />
    </Suspense>
  );
}
