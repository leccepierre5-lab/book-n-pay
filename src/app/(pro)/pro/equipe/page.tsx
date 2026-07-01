import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import EquipeManager from '@/components/pro/EquipeManager';

export default async function ProEquipePage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/equipe');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) redirect('/');

  const admin = createServiceRoleClient();
  const { data: staff } = await admin
    .from('staff')
    .select('id, name, role, emoji, is_active, deactivated_at, created_at')
    .eq('biz_id', profile.biz_id)
    .order('created_at', { ascending: true });

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white">←</Link>
          <h1 className="text-lg font-semibold text-white">Mon équipe</h1>
        </div>
        <EquipeManager
          bizId={profile.biz_id}
          initialStaff={(staff ?? []) as {
            id: string; name: string; role: string | null; emoji: string | null;
            is_active: boolean; deactivated_at: string | null; created_at: string;
          }[]}
        />
      </div>
    </div>
  );
}
