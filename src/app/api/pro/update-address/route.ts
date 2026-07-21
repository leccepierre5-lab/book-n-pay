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

  const { address, postal_code, lat, lng, address_public, service_area_radius_km } = body;

  // L'adresse (privée) est toujours requise, même quand address_public=false —
  // elle sert de base au géocodage, jamais exposée publiquement dans ce cas
  // (voir migration 0037 : RLS sur business_locations, pas une case à cocher
  // côté affichage).
  if (
    typeof address !== 'string' || !address.trim() ||
    typeof postal_code !== 'string' || !postal_code.trim() ||
    typeof lat !== 'number' || typeof lng !== 'number' ||
    typeof address_public !== 'boolean'
  ) {
    return NextResponse.json({ error: 'Adresse invalide' }, { status: 400 });
  }

  let radius: number | null = null;
  if (service_area_radius_km !== null && service_area_radius_km !== undefined) {
    if (typeof service_area_radius_km !== 'number' || service_area_radius_km <= 0) {
      return NextResponse.json({ error: 'Rayon invalide' }, { status: 400 });
    }
    radius = service_area_radius_km;
  }

  const supabaseAdmin = createServiceRoleClient();

  const { error: locationError } = await supabaseAdmin
    .from('business_locations')
    .upsert(
      { biz_id: profile.biz_id, address: address.trim(), postal_code: postal_code.trim(), lat, lng, address_public },
      { onConflict: 'biz_id' }
    );
  if (locationError) return logAndRespond('[UpdateAddress] Erreur location:', locationError);

  const { error: bizError } = await supabaseAdmin
    .from('businesses')
    .update({ service_area_radius_km: radius })
    .eq('id', profile.biz_id);
  if (bizError) return logAndRespond('[UpdateAddress] Erreur rayon:', bizError);

  return NextResponse.json({ ok: true });
}
