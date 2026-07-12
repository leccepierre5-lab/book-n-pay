import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { getParisDateOffsetStr } from '@/lib/booking-utils';

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

// GET /api/pro/staff/[id]/absences — congés/absences ponctuelles d'un praticien
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
    .from('staff_absences')
    .select('id, start_at, end_at, reason')
    .eq('staff_id', id)
    .eq('biz_id', bizId)
    .order('start_at');

  if (error) return logAndRespond('[StaffAbsences] Erreur liste:', error);
  return NextResponse.json({ absences: data ?? [] });
}

// POST /api/pro/staff/[id]/absences — déclare une nouvelle absence
// Body : { start_at: ISO string, end_at: ISO string, reason?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id: staffId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const { start_at, end_at, reason } = body;

  if (typeof start_at !== 'string' || typeof end_at !== 'string') {
    return NextResponse.json({ error: 'start_at et end_at requis' }, { status: 400 });
  }

  const startDate = new Date(start_at);
  const endDate = new Date(end_at);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'start_at/end_at invalides' }, { status: 400 });
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return NextResponse.json({ error: 'end_at doit être après start_at' }, { status: 400 });
  }

  // Pas de création dans le passé — comparaison au jour calendaire Paris
  // (pas à la minute près : une absence démarrant "aujourd'hui" reste
  // acceptée même si l'heure de début est déjà passée dans la journée).
  const startDateParis = startDate.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const todayParis = getParisDateOffsetStr(0);
  if (startDateParis < todayParis) {
    return NextResponse.json({ error: 'Impossible de créer une absence dans le passé' }, { status: 400 });
  }

  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason doit être une chaîne' }, { status: 400 });
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

  const { data, error } = await admin
    .from('staff_absences')
    .insert({
      staff_id: staffId,
      biz_id: bizId,
      start_at,
      end_at,
      reason: typeof reason === 'string' ? (reason.trim() || null) : null,
    })
    .select('id, start_at, end_at, reason')
    .single();

  if (error) return logAndRespond('[StaffAbsences] Erreur création:', error);
  return NextResponse.json({ absence: data });
}
