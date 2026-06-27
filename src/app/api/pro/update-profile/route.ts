import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Accès interdit' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const allowed = ['instagram', 'facebook_url', 'website'];
  const updates: Record<string, string | null> = {};

  for (const key of allowed) {
    if (key in body) {
      const val = typeof body[key] === 'string' ? body[key].trim() || null : null;
      updates[key] = val;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabaseAdmin = createServiceRoleClient();
  const { error } = await supabaseAdmin
    .from('businesses')
    .update(updates)
    .eq('id', profile.biz_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
