// src/app/(pro)/pro/page.tsx
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getProBookings, getProStats, getRecentNoShows } from '@/lib/queries/pro';
import ProDashboard from '@/components/pro/ProDashboard';
import type { Business } from '@/lib/database.types';
import { getParisDateOffsetStr } from '@/lib/booking-utils';
import { getStaffQuotaStatus } from '@/lib/plans-config';

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

  // Billing non configuré → setup.
  // ⚠️ CORRECTIF (audit — effet de bord du fix #5) : subscription_status
  // reste 'pending' jusqu'à ce que le webhook invoice.payment_succeeded
  // confirme le paiement (asynchrone). Sans stripe_subscription_id, on sait
  // que le pro n'a même pas encore soumis de moyen de paiement — sinon on le
  // laisse passer pour éviter un aller-retour vers setup-billing (et un
  // risque de double Subscription Stripe créée) pendant la brève fenêtre
  // où le webhook n'est pas encore arrivé.
  // Requête unique — réutilisée plus bas pour stripeConnected (avant : 2
  // requêtes séparées sur la même table pour le même biz_id).
  const admin = createServiceRoleClient();
  const { data: settings } = await admin
    .from('business_settings')
    .select('*')
    .eq('biz_id', profile.biz_id!)
    .maybeSingle();
  if (settings?.subscription_status === 'pending' && !settings.stripe_subscription_id) {
    redirect('/pro/setup-billing');
  }

  // Redirige vers l'onboarding si l'établissement n'est pas encore publié
  const biz = profile.businesses as Business | null;
  if (biz && biz.is_published === false) {
    redirect('/pro/onboarding');
  }

  const today = getParisDateOffsetStr(0);
  const [todayBookings, stats, { count: activeStaffCount }, recentNoShows] = await Promise.all([
    getProBookings(profile.biz_id, { from: today, to: today }),
    getProStats(profile.biz_id, {
      open_time: biz?.open_time ?? null,
      close_time: biz?.close_time ?? null,
      open_days: biz?.open_days ?? [],
    }),
    // Bandeau "quota dépassé" (14/08) — atteignable seulement par downgrade
    // (voir plans-config.ts:getStaffQuotaStatus), jamais par une création ou
    // réactivation normale (déjà gardées côté API).
    admin.from('staff').select('id', { count: 'exact', head: true })
      .eq('biz_id', profile.biz_id).eq('is_active', true),
    // Bandeau "no-show en attente" (20/08) — voir getRecentNoShows.
    getRecentNoShows(profile.biz_id, getParisDateOffsetStr(-7)),
  ]);
  const staffQuota = getStaffQuotaStatus(settings?.plan_key ?? 'starter', activeStaffCount ?? 0);

  return (
    <Suspense>
      <ProDashboard
        business={profile.businesses}
        todayBookings={todayBookings}
        stats={stats}
        stripeConnected={!!settings?.stripe_onboarding_complete}
        stripeRequirements={settings ? {
          payoutsEnabled: settings.stripe_payouts_enabled ?? null,
          pastDue: settings.stripe_past_due ?? null,
          currentDeadline: settings.stripe_current_deadline ?? null,
          futureDeadline: settings.stripe_future_deadline ?? null,
        } : null}
        notificationPrefs={settings?.notification_prefs ?? null}
        staffQuota={staffQuota}
        recentNoShows={recentNoShows}
      />
    </Suspense>
  );
}
