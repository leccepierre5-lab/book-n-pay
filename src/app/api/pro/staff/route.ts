import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

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

// GET /api/pro/staff — liste les praticiens actifs (et inactifs) de l'établissement
export async function GET() {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('staff')
    .select('id, name, role, emoji, is_active, deactivated_at, created_at')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data ?? [] });
}

// POST /api/pro/staff — créer un nouveau praticien
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('staff')
    .insert({
      biz_id: bizId,
      name,
      role: typeof body?.role === 'string' ? body.role.trim() || null : null,
      emoji: typeof body?.emoji === 'string' ? body.emoji.trim() || null : null,
      is_active: true,
    })
    .select('id, name, role, emoji, is_active, deactivated_at, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data }, { status: 201 });
}
