import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
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

  const [{ data: biz }, { count: servicesCount }, { data: settings }] = await Promise.all([
    admin.from('businesses').select('open_time, close_time, open_days, is_published').eq('id', profile.biz_id).maybeSingle(),
    admin.from('services').select('id', { count: 'exact', head: true }).eq('biz_id', profile.biz_id),
    admin.from('business_settings').select('stripe_onboarding_complete').eq('biz_id', profile.biz_id).maybeSingle(),
  ]);

  const step1Done = !!(biz?.open_time && biz?.close_time && biz?.open_days && biz.open_days.length > 0);
  const step2Done = (servicesCount ?? 0) > 0;
  const step3Done = !!settings?.stripe_onboarding_complete;

  return NextResponse.json({
    step1Done,
    step2Done,
    step3Done,
    isPublished: biz?.is_published ?? false,
  });
}
