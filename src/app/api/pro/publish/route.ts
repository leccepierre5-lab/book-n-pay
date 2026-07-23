import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';

export const POST = withErrorHandling('[Publish]', async () => {
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

  const admin = createServiceRoleClient();

  // Vérifie que les 3 étapes obligatoires sont bien complètes
  const [{ data: biz }, { count: servicesCount }, { data: settings }] = await Promise.all([
    admin.from('businesses').select('open_time, close_time, open_days').eq('id', profile.biz_id).maybeSingle(),
    admin.from('services').select('id', { count: 'exact', head: true }).eq('biz_id', profile.biz_id),
    admin.from('business_settings').select('stripe_onboarding_complete').eq('biz_id', profile.biz_id).maybeSingle(),
  ]);

  const step1Done = !!(biz?.open_time && biz?.close_time && biz?.open_days && biz.open_days.length > 0);
  const step2Done = (servicesCount ?? 0) > 0;
  const step3Done = !!settings?.stripe_onboarding_complete;

  if (!step1Done || !step2Done || !step3Done) {
    return NextResponse.json({ error: 'Toutes les étapes obligatoires doivent être complétées' }, { status: 400 });
  }

  const { error } = await admin
    .from('businesses')
    .update({ is_published: true })
    .eq('id', profile.biz_id);

  if (error) return logAndRespond('[Publish] Erreur:', error);
  return NextResponse.json({ ok: true });
});
