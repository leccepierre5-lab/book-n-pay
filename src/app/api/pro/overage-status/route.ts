// src/app/api/pro/overage-status/route.ts
// Statut hors-forfait du pro connecté — consommé par OverageBanner.
// "urgent" (bandeau rouge) dès qu'au moins une charge est passée en 'failed'
// (retry cron épuisé) ; sinon bandeau informatif si en overage (OVERAGE_GRACE=0).
import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getOverageStatus } from '@/lib/booking-utils';
import { getPlanConfig, getNextPlanConfig } from '@/lib/plans-config';
import { withErrorHandling } from '@/lib/api-error';

export const GET = withErrorHandling('[OverageStatus]', async () => {
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

  const { data: settings } = await admin
    .from('business_settings')
    .select('plan_key, monthly_bookings_count, bookings_count_reset_at')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  const planKey = settings?.plan_key ?? 'starter';
  // Epoch en repli théorique seulement (settings absent) — la colonne elle-même
  // est NOT NULL depuis la migration 0029.
  const cycleStart = settings?.bookings_count_reset_at ?? new Date(0).toISOString();

  const [{ data: unpaidCharges }, { data: cycleCharges }] = await Promise.all([
    // Impayés toutes périodes confondues (pas de filtre de cycle) : une dette
    // 'retry_scheduled'/'failed' doit rester visible même après le renouvellement
    // du mois suivant, jusqu'à son regroupement en facture (statut 'invoiced').
    admin
      .from('overage_charges')
      .select('status, amount_ht')
      .eq('biz_id', profile.biz_id)
      .in('status', ['retry_scheduled', 'failed']),
    // Charges du cycle en cours uniquement — même fenêtre que le SUM de
    // increment_booking_count_and_charge (migration 0030), pour rester
    // cohérent avec le plafond réellement appliqué en base.
    admin
      .from('overage_charges')
      .select('status, amount_ht')
      .eq('biz_id', profile.biz_id)
      .gte('created_at', cycleStart),
  ]);

  const overage = getOverageStatus(settings?.monthly_bookings_count ?? 0, planKey);

  const unpaid = unpaidCharges ?? [];
  const unpaidCount = unpaid.length;
  const unpaidTotal = unpaid.reduce((sum, c) => sum + Number(c.amount_ht), 0);
  const urgent = unpaid.some((c) => c.status === 'failed');
  const pending = urgent || overage.status !== 'included';

  // Les lignes 'capped' sont à 0€ par construction (voir 0030) : sommer toutes
  // les charges du cycle, peu importe le statut, donne directement le même
  // cumul que v_already_charged côté SQL, sans avoir à exclure 'capped' à la main.
  const cycle = cycleCharges ?? [];
  const cycleChargedTotal = cycle.reduce((sum, c) => sum + Number(c.amount_ht), 0);
  const cappedCount = cycle.filter((c) => c.status === 'capped').length;

  const currentPlan = getPlanConfig(planKey);
  const nextPlan = getNextPlanConfig(planKey);

  return NextResponse.json({
    pending,
    urgent,
    unpaidCount,
    unpaidTotal: Math.round(unpaidTotal * 100) / 100,
    status: overage.status,
    overageCount: overage.overageCount,
    currentPlanLabel: overage.currentPlanLabel,
    nextPlanLabel: overage.nextPlanLabel,
    capHt: overage.capHt !== null ? Math.round(overage.capHt * 100) / 100 : null,
    cycleChargedTotal: Math.round(cycleChargedTotal * 100) / 100,
    cappedCount,
    currentPlanPriceHT: currentPlan?.priceHT ?? null,
    nextPlanPriceHT: nextPlan?.priceHT ?? null,
    nextPlanQuota: nextPlan?.quota ?? null,
  });
});
