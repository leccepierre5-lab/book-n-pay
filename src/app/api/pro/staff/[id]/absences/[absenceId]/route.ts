import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

async function getProBizId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;
  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) return null;
  return profile.biz_id as string;
}

// DELETE /api/pro/staff/[id]/absences/[absenceId] — supprime une absence
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; absenceId: string }> }
) {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id: staffId, absenceId } = await params;
  const admin = createServiceRoleClient();

  const { error } = await admin
    .from('staff_absences')
    .delete()
    .eq('id', absenceId)
    .eq('staff_id', staffId)
    .eq('biz_id', bizId);

  if (error) return logAndRespond('[StaffAbsences] Erreur suppression:', error);
  return NextResponse.json({ ok: true });
}
