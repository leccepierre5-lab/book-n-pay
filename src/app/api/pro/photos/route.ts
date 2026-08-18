import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';
import { sniffImageType } from '@/lib/image-sniff';

const MAX_PHOTOS = 5;

// POST: upload nouvelle photo
export const POST = withErrorHandling('[Photos]', async (req: NextRequest) => {
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

  const supabaseAdmin = createServiceRoleClient();

  // Vérifier le nombre existant
  const { count } = await supabaseAdmin
    .from('business_photos')
    .select('id', { count: 'exact', head: true })
    .eq('biz_id', profile.biz_id);

  if ((count ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json({ error: `Maximum ${MAX_PHOTOS} photos autorisées` }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Fichier trop lourd (max 5 Mo)' }, { status: 400 });
  }

  // Ni l'extension du nom de fichier ni file.type (Content-Type déclaré par
  // le client) ne sont dignes de confiance — les deux sont falsifiables sans
  // effort par un appel direct à l'API. Seuls les octets réels décident du
  // format ET du Content-Type stocké (audit sécurité 18/08, voir
  // src/lib/image-sniff.ts). Un fichier dont la signature binaire ne
  // correspond à aucun format supporté est rejeté, quels que soient son nom
  // ou son Content-Type déclaré.
  const bytes = await file.arrayBuffer();
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return NextResponse.json({ error: 'Format non supporté (jpg, png, webp)' }, { status: 400 });
  }

  const path = `${profile.biz_id}/${randomUUID()}.${sniffed.ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('business-photos')
    .upload(path, bytes, { contentType: sniffed.type, upsert: false });

  if (uploadError) return logAndRespond('[Photos] Erreur upload:', uploadError);

  const { data: urlData } = supabaseAdmin.storage.from('business-photos').getPublicUrl(path);
  const url = urlData.publicUrl;

  const { data: maxRow } = await supabaseAdmin
    .from('business_photos')
    .select('sort_order')
    .eq('biz_id', profile.biz_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: photo, error: insertError } = await supabaseAdmin
    .from('business_photos')
    .insert({ biz_id: profile.biz_id, url, sort_order: sortOrder })
    .select()
    .single();

  if (insertError) return logAndRespond('[Photos] Erreur insertion:', insertError);
  return NextResponse.json({ photo });
});

// DELETE: supprimer une photo
export const DELETE = withErrorHandling('[Photos]', async (req: NextRequest) => {
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
  const photoId: string | undefined = body?.photoId;
  if (!photoId) return NextResponse.json({ error: 'photoId requis' }, { status: 400 });

  const supabaseAdmin = createServiceRoleClient();

  const { data: photo } = await supabaseAdmin
    .from('business_photos')
    .select('id, url, biz_id')
    .eq('id', photoId)
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  if (!photo) return NextResponse.json({ error: 'Photo introuvable' }, { status: 404 });

  // Supprimer du Storage
  const storageKey = photo.url.split('/business-photos/')[1];
  if (storageKey) {
    await supabaseAdmin.storage.from('business-photos').remove([storageKey]);
  }

  await supabaseAdmin.from('business_photos').delete().eq('id', photoId);
  return NextResponse.json({ ok: true });
});
