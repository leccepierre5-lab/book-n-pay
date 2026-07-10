// src/app/api/pro/overage-status/route.ts
// Statut hors-forfait du pro connecté — consommé par OverageBanner.
// "urgent" (bandeau rouge) dès qu'au moins une charge est passée en 'failed'
// (retry cron épuisé) ; sinon bandeau informatif si en overage (OVERAGE_GRACE=0).
import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getOverageStatus } from '@/lib/booking-utils';

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

  const [{ data: settings }, { data: unpaidCharges }] = await Promise.all([
    admin
      .from('business_settings')
      .select('plan_key, monthly_bookings_count')
      .eq('biz_id', profile.biz_id)
      .maybeSingle(),
    admin
      .from('overage_charges')
      .select('status, amount_ht')
      .eq('biz_id', profile.biz_id)
      .in('status', ['retry_scheduled', 'failed']),
  ]);

  const planKey = settings?.plan_key ?? 'starter';
  const overage = getOverageStatus(settings?.monthly_bookings_count ?? 0, planKey);

  const unpaid = unpaidCharges ?? [];
  const unpaidCount = unpaid.length;
  const unpaidTotal = unpaid.reduce((sum, c) => sum + Number(c.amount_ht), 0);
  const urgent = unpaid.some((c) => c.status === 'failed');
  const pending = urgent || overage.status !== 'included';

  return NextResponse.json({
    pending,
    urgent,
    unpaidCount,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100,
    status: overage.status,
    overageCount: overage.overageCount,
    currentPlanLabel: overage.currentPlanLabel,
    nextPlanLabel: overage.nextPlanLabel,
  });
}
