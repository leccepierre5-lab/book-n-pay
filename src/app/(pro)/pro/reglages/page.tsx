// src/app/(pro)/pro/reglages/page.tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getBusinessSettings } from '@/lib/queries/pro';
import NotificationsConfig from '@/components/pro/NotificationsConfig';

export default async function ProReglagesPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/reglages');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id) redirect('/pro');

  const settings = await getBusinessSettings(profile.biz_id);

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white">
            ←
          </Link>
          <h1 className="text-lg font-semibold text-white">Réglages</h1>
        </div>
        <NotificationsConfig bizId={profile.biz_id} initialPrefs={settings?.notification_prefs || null} />
      </div>
    </div>
  );
}
