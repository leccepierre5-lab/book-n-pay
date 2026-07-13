import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, biz_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.role !== 'pro' && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux professionnels' }, { status: 403 });
  }

  const body = await req.json();
  const allowed = ['active', 'flash_deposit', 'date', 'time'];
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));

  const serviceRole = createServiceRoleClient();
  const { data, error } = await serviceRole
    .from('flash_slots')
    .update(updates)
    .eq('id', id)
    .eq('biz_id', profile.biz_id!)
    .select()
    .single();

  if (error) return logAndRespond('[FlashSlots] Erreur update:', error);
  revalidateTag('flash-slots', { expire: 0 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, biz_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.role !== 'pro' && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux professionnels' }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();
  const { error } = await serviceRole
    .from('flash_slots')
    .delete()
    .eq('id', id)
    .eq('biz_id', profile.biz_id!);

  if (error) return logAndRespond('[FlashSlots] Erreur suppression:', error);
  revalidateTag('flash-slots', { expire: 0 });
  return NextResponse.json({ success: true });
}
