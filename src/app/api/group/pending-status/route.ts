// src/app/api/group/pending-status/route.ts
// Retourne le groupe en attente le plus urgent pour l'utilisateur connecté.
// Déclenche aussi l'expiration lazy si le deadline est dépassé.
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { expireGroupByRef } from '@/lib/group/expireGroup';

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.email) {
    return NextResponse.json({ pending: false });
  }

  const normalizedEmail = authData.user.email.trim().toLowerCase();
  const supabaseAdmin = createServiceRoleClient();
  const now = new Date().toISOString();

  // Chercher les booking_members de cet email dans un groupe actif
  const { data: memberRows } = await supabaseAdmin
    .from('booking_members')
    .select('id, status, booking_id, bookings!inner(id, status, group_ref, payment_deadline, biz_name, service_name)')
    .ilike('email', normalizedEmail)     // ilike = insensible à la casse
    .in('status', ['invite', 'paid'])
    .eq('bookings.status', 'active')
    .not('bookings.group_ref', 'is', null);

  if (!memberRows || memberRows.length === 0) {
    return NextResponse.json({ pending: false });
  }

  // Filtrer ceux dont le deadline est dans le futur
  const pendingRows = memberRows.filter((r) => {
    const bk = (r as any).bookings;
    return bk?.payment_deadline && bk.payment_deadline > now;
  });

  // Expiration lazy : traiter les groupes dont le deadline est dépassé
  const expiredRows = memberRows.filter((r) => {
    const bk = (r as any).bookings;
    return bk?.payment_deadline && bk.payment_deadline <= now;
  });
  if (expiredRows.length > 0) {
    // ⚠️ CORRECTIF SÉCURITÉ (audit) : utilisait toujours la clé live, même
    // en mode_test_paiement. Même bascule que stripe/checkout/route.ts.
    const { data: testModeConfig } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'mode_test_paiement')
      .maybeSingle();
    const isTestMode = testModeConfig?.value === 'true';
    const stripe = new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);
    const expiredRefs = [...new Set(expiredRows.map((r) => (r as any).bookings?.group_ref as string).filter(Boolean))];
    for (const ref of expiredRefs) {
      await expireGroupByRef(ref, supabaseAdmin, stripe).catch((e) =>
        console.error('[pending-status] expireGroup error:', e.message)
      );
    }
  }

  if (pendingRows.length === 0) {
    return NextResponse.json({ pending: false });
  }

  // Prendre le groupe avec le deadline le plus proche
  pendingRows.sort((a, b) => {
    const da = (a as any).bookings?.payment_deadline ?? '';
    const db = (b as any).bookings?.payment_deadline ?? '';
    return da.localeCompare(db);
  });

  const myRow = pendingRows[0];
  const myMember = myRow as any;
  const booking = myMember.bookings;
  const groupRef = booking.group_ref;
  const deadline = booking.payment_deadline;

  // Compter les membres payés / total du groupe
  const { data: allMembers } = await supabaseAdmin
    .from('booking_members')
    .select('id, status')
    .eq('booking_id', myRow.booking_id)
    .neq('status', 'cancelled');

  const total = (allMembers ?? []).length;
  const paid = (allMembers ?? []).filter((m) => m.status === 'paid' || m.status === 'arrived').length;

  return NextResponse.json({
    pending: true,
    groupRef,
    deadline,
    paidCount: paid,
    totalCount: total,
    selfStatus: myRow.status,
    payLink: myRow.status === 'invite' ? `/pay/${myRow.id}` : null,
    bizName: booking.biz_name,
    serviceName: booking.service_name,
  });
}
