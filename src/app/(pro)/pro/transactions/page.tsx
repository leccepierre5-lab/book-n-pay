// src/app/(pro)/pro/transactions/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TransactionsList from '@/components/pro/TransactionsList';

export default async function ProTransactionsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/transactions');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id) redirect('/pro');

  return <TransactionsList bizId={profile.biz_id} />;
}
