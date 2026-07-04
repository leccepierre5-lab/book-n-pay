import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bizId = searchParams.get('biz_id');

  const supabase = createServiceRoleClient();
  let q = supabase
    .from('flash_slots')
    .select('*')
    .eq('active', true)
    .gte('date', new Date().toISOString().split('T')[0])
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (bizId) q = q.eq('biz_id', bizId);

  const { data, error } = await q;
  if (error) return logAndRespond('[FlashSlots] Erreur liste:', error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, biz_id, businesses(name)')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.role !== 'pro' && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Réservé aux professionnels' }, { status: 403 });
  }

  const body = await req.json();
  const { service_id, service_name, date, time, original_deposit, flash_deposit } = body;

  if (!date || !time) {
    return NextResponse.json({ error: 'date et time requis' }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const { data, error } = await serviceRole
    .from('flash_slots')
    .insert({
      biz_id: profile.biz_id,
      biz_name: (profile.businesses as any)?.name || '',
      service_id: service_id || null,
      service_name: service_name || null,
      date,
      time,
      original_deposit: original_deposit ?? null,
      flash_deposit: flash_deposit ?? null,
    })
    .select()
    .single();

  if (error) return logAndRespond('[FlashSlots] Erreur création:', error);
  return NextResponse.json(data, { status: 201 });
}
