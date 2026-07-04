import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await supabase
    .from('favorites')
    .select('*, businesses(id, slug, name, city, category, type, frozen, business_reviews(rating))')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  if (error) return logAndRespond('[Favorites] Erreur liste:', error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { biz_id } = await req.json();
  if (!biz_id) return NextResponse.json({ error: 'biz_id requis' }, { status: 400 });

  const serviceRole = createServiceRoleClient();

  const { data: existing } = await serviceRole
    .from('favorites')
    .select('id')
    .eq('user_id', authData.user.id)
    .eq('biz_id', biz_id)
    .maybeSingle();

  if (existing) {
    await serviceRole.from('favorites').delete().eq('id', existing.id);
    return NextResponse.json({ favorited: false });
  } else {
    await serviceRole.from('favorites').insert({ user_id: authData.user.id, biz_id });
    return NextResponse.json({ favorited: true });
  }
}
