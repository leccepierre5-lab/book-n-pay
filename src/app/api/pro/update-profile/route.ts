import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

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
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const updates: Record<string, unknown> = {};

  // Champs texte simples
  for (const key of ['instagram', 'facebook_url', 'website']) {
    if (key in body) {
      updates[key] = typeof body[key] === 'string' ? body[key].trim() || null : null;
    }
  }

  // Horaires
  if ('open_time' in body) {
    updates.open_time = typeof body.open_time === 'string' && body.open_time ? body.open_time : null;
  }
  if ('close_time' in body) {
    updates.close_time = typeof body.close_time === 'string' && body.close_time ? body.close_time : null;
  }
  if ('open_days' in body) {
    const days = body.open_days;
    updates.open_days = Array.isArray(days) ? days.filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6) : [];
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });

  const supabaseAdmin = createServiceRoleClient();
  const { error } = await supabaseAdmin
    .from('businesses')
    .update(updates)
    .eq('id', profile.biz_id);

  if (error) return logAndRespond('[UpdateProfile] Erreur:', error);
  return NextResponse.json({ ok: true });
}
