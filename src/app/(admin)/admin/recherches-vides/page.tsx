// src/app/(admin)/admin/recherches-vides/page.tsx
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import RecherchesVidesAdmin from '@/components/admin/RecherchesVidesAdmin';
import type { SearchMiss } from '@/lib/database.types';

export default async function AdminSearchMissesPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/admin/recherches-vides');

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') redirect('/');

  // RLS de search_misses est fermée à authenticated/anon (service_role
  // uniquement, migration 0054) — même schéma que refund_failures.
  const serviceSupabase = createServiceRoleClient();
  const { data: misses } = await serviceSupabase
    .from('search_misses')
    .select('*')
    .order('created_at', { ascending: false });

  return <RecherchesVidesAdmin misses={(misses || []) as SearchMiss[]} />;
}
