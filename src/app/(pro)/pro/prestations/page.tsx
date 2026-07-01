import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import PrestationsManager from '@/components/pro/PrestationsManager';

export default async function ProPrestationsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/prestations');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || (profile.role !== 'pro' && profile.role !== 'admin')) {
    redirect('/pro');
  }

  const serviceClient = createServiceRoleClient();
  const { data: services } = await serviceClient
    .from('services')
    .select('*')
    .eq('biz_id', profile.biz_id)
    .order('created_at');

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white transition-colors">
            ←
          </Link>
        </div>
        <PrestationsManager initial={services ?? []} />
      </div>
    </div>
  );
}
