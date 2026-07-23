import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import MonCompteClient from '@/components/client/MonCompteClient';
import { getUpcomingActiveBookingIds } from '@/lib/queries/client';
import type { EnrichedReferralEvent } from '@/lib/database.types';

export default async function MonComptePage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) redirect('/connexion?redirect=/mon-compte');

  const admin = createServiceRoleClient();

  const [{ data: profile }, { data: referralEvents }] = await Promise.all([
    admin
      .from('app_users')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle(),
    admin
      .from('referral_events')
      .select('*, referred:app_users!referred_id(id, name, rdv_honores, referral_reward_granted)')
      .eq('referrer_id', authData.user.id)
      .order('created_at', { ascending: false }),
  ]);

  if (!profile) redirect('/connexion');

  const params = await searchParams;
  const initialReset = params.reset === '1';

  const upcomingBookingIds = await getUpcomingActiveBookingIds(admin, authData.user.id, profile.phone);

  return (
    <div>
      <MonCompteClient
        profile={profile}
        email={authData.user.email ?? ''}
        referralEvents={(referralEvents || []) as EnrichedReferralEvent[]}
        initialReset={initialReset}
        upcomingBookingsCount={upcomingBookingIds.length}
      />
    </div>
  );
}
