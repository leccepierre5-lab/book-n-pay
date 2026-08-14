// src/app/(admin)/admin/remboursements/page.tsx
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import RefundFailuresAdmin from '@/components/admin/RefundFailuresAdmin';

export default async function AdminRefundFailuresPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/admin/remboursements');

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') redirect('/');

  // RLS de refund_failures est fermée à authenticated/anon (service_role
  // uniquement, migration 0052) — la lecture doit passer par le client
  // service_role, même si l'appelant est déjà vérifié admin ci-dessus.
  const serviceSupabase = createServiceRoleClient();
  const { data: failures } = await serviceSupabase
    .from('refund_failures')
    .select('*, bookings(biz_name, service_name, client_email, date, time)')
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  return <RefundFailuresAdmin failures={failures || []} />;
}
