import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import AgendaView from '@/components/pro/AgendaView';

export default async function ProPlanningPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/planning');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) redirect('/');

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white">←</Link>
          <h1 className="text-lg font-semibold text-white">Planning</h1>
        </div>
        <AgendaView />
      </div>
    </div>
  );
}
