import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';
import { getPlanConfig, getPraticiensLimit } from '@/lib/plans-config';

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

// GET /api/pro/staff — liste les collaborateurs actifs (et inactifs) de l'établissement
export const GET = withErrorHandling('[Staff]', async () => {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('staff')
    .select('id, name, role, emoji, is_active, deactivated_at, created_at')
    .eq('biz_id', bizId)
    .order('created_at', { ascending: true });

  if (error) return logAndRespond('[Staff] Erreur liste:', error);
  return NextResponse.json({ staff: data ?? [] });
});

// POST /api/pro/staff — créer un nouveau collaborateur
export const POST = withErrorHandling('[Staff]', async (req: NextRequest) => {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 });

  const admin = createServiceRoleClient();

  // Limite de collaborateurs par plan — s'applique aux AJOUTS uniquement,
  // jamais aux collaborateurs déjà créés (voir doc plans-config.ts : maxStaff
  // exclut le pro lui-même, qui n'a pas de ligne `staff`).
  const { data: settings } = await admin
    .from('business_settings')
    .select('plan_key')
    .eq('biz_id', bizId)
    .maybeSingle();
  const planKey = settings?.plan_key ?? 'starter';
  // ⚠️ Pas `?? 0` : maxStaff peut valoir `null` (Scale, illimité) — un `??`
  // ici ramènerait Scale à 0, plus restrictif que Starter.
  const planConfig = getPlanConfig(planKey);
  const maxStaff = planConfig ? planConfig.maxStaff : 0;
  if (maxStaff !== null) {
    const { count } = await admin
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', bizId)
      .eq('is_active', true);
    if ((count ?? 0) >= maxStaff) {
      const limit = getPraticiensLimit(planKey);
      return NextResponse.json(
        {
          error: `Limite de ${limit} collaborateur${(limit ?? 0) > 1 ? 's' : ''} atteinte pour votre plan ${getPlanConfig(planKey)?.label ?? planKey} (vous y compris). Passez à un plan supérieur pour ajouter des collaborateurs.`,
        },
        { status: 403 }
      );
    }
  }

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

  if (error) return logAndRespond('[Staff] Erreur création:', error);
  return NextResponse.json({ staff: data }, { status: 201 });
});
