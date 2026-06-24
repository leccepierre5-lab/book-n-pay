import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import FlashSlotsManager from '@/components/pro/FlashSlotsManager';

export default async function FlashSlotsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/flash-slots');

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, biz_id, businesses(id, name, services(id, name, deposit, price))')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile || (profile.role !== 'pro' && profile.role !== 'admin') || !profile.biz_id) {
    redirect('/');
  }

  const serviceRole = createServiceRoleClient();
  const today = new Date().toISOString().split('T')[0];
  const { data: slots } = await serviceRole
    .from('flash_slots')
    .select('*')
    .eq('biz_id', profile.biz_id)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  return (
    <FlashSlotsManager
      bizId={profile.biz_id}
      services={(profile.businesses as any)?.services || []}
      initialSlots={slots || []}
    />
  );
}
