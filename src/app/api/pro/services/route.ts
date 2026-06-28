import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

async function getBizId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!data?.biz_id || (data.role !== 'pro' && data.role !== 'admin')) return null;
  return data.biz_id;
}

export async function GET() {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('biz_id', bizId)
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { name, genre, allow_group, duration_minutes, price, deposit, max_persons } = body;

  if (!name || !duration_minutes || price == null) {
    return NextResponse.json({ error: 'name, duration_minutes et price requis' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('services')
    .insert({
      biz_id: bizId,
      name: name.trim(),
      genre: genre || null,
      allow_group: allow_group !== false,
      duration_minutes: Number(duration_minutes),
      price: Number(price),
      deposit: Number(deposit ?? 0),
      max_persons: max_persons ? Number(max_persons) : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { id, name, genre, allow_group, duration_minutes, price, deposit, max_persons } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const supabase = createServiceRoleClient();

  // Vérifie que le service appartient bien à ce biz
  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', id)
    .eq('biz_id', bizId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (genre !== undefined) updates.genre = genre || null;
  if (allow_group !== undefined) updates.allow_group = allow_group !== false;
  if (duration_minutes !== undefined) updates.duration_minutes = Number(duration_minutes);
  if (price !== undefined) updates.price = Number(price);
  if (deposit !== undefined) updates.deposit = Number(deposit);
  if (max_persons !== undefined) updates.max_persons = max_persons ? Number(max_persons) : null;

  const { data, error } = await supabase
    .from('services')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', id)
    .eq('biz_id', bizId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 });

  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
