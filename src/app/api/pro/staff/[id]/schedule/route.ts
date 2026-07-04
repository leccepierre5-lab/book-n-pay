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

// GET /api/pro/staff/[id]/schedule — horaires individuels d'un praticien
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const admin = createServiceRoleClient();

  const { data, error } = await admin
    .from('staff_schedules')
    .select('id, day_of_week, open_time, close_time')
    .eq('staff_id', id)
    .eq('biz_id', bizId)
    .order('day_of_week');

  if (error) return logAndRespond('[StaffSchedule] Erreur liste:', error);
  return NextResponse.json({ schedules: data ?? [] });
}

// PUT /api/pro/staff/[id]/schedule — remplace tous les horaires d'un praticien
// Body : { schedules: [{ day_of_week: 1, open_time: "09:00", close_time: "18:00" }, ...] }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id: staffId } = await params;
  const body = await req.json().catch(() => null);
  const schedules = body?.schedules;

  if (!Array.isArray(schedules)) {
    return NextResponse.json({ error: 'schedules[] requis' }, { status: 400 });
  }

  // Validation des entrées
  for (const s of schedules) {
    if (typeof s.day_of_week !== 'number' || s.day_of_week < 0 || s.day_of_week > 6) {
      return NextResponse.json({ error: 'day_of_week invalide (0-6)' }, { status: 400 });
    }
    if (typeof s.open_time !== 'string' || typeof s.close_time !== 'string') {
      return NextResponse.json({ error: 'open_time et close_time requis' }, { status: 400 });
    }
    if (s.open_time >= s.close_time) {
      return NextResponse.json({ error: 'open_time doit être avant close_time' }, { status: 400 });
    }
  }

  // Vérifie que le praticien appartient bien à ce biz
  const admin = createServiceRoleClient();
  const { data: staffRow } = await admin
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('biz_id', bizId)
    .maybeSingle();

  if (!staffRow) return NextResponse.json({ error: 'Praticien introuvable' }, { status: 404 });

  // Remplacement atomique : supprime puis réinsère
  await admin.from('staff_schedules').delete().eq('staff_id', staffId).eq('biz_id', bizId);

  if (schedules.length > 0) {
    const rows = schedules.map((s) => ({
      staff_id: staffId,
      biz_id: bizId,
      day_of_week: s.day_of_week,
      open_time: s.open_time,
      close_time: s.close_time,
    }));

    const { error } = await admin.from('staff_schedules').insert(rows);
    if (error) return logAndRespond('[StaffSchedule] Erreur update:', error);
  }

  return NextResponse.json({ ok: true });
}
