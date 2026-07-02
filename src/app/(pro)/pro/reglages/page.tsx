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

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-navy-900 p-4">
          <p className="text-[13px] font-semibold text-white">Confidentialité & RGPD</p>
          <p className="text-xs text-white/50">
            Téléchargez la liste de vos clients (nom, téléphone, email, historique de RDV) au format CSV.
          </p>
          <a
            href="/api/pro/export-clients"
            className="inline-flex items-center gap-2 rounded-lg bg-navy-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-navy-700"
          >
            ⬇️ Exporter mes clients (CSV)
          </a>
        </div>
      </div>
    </div>
  );
}
