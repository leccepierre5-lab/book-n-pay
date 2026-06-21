// src/app/(admin)/admin/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AdminDashboard from '@/components/admin/AdminDashboard';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/admin');

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') redirect('/');

  const [{ data: configs }, { data: applications }, { data: businesses }] = await Promise.all([
    supabase.from('app_config').select('*').order('key'),
    supabase.from('partner_applications').select('*').order('created_at', { ascending: false }),
    supabase.from('businesses').select('id, name, city, frozen, frozen_reason').order('name'),
  ]);

  return (
    <AdminDashboard
      configs={configs || []}
      applications={applications || []}
      businesses={businesses || []}
    />
  );
}
