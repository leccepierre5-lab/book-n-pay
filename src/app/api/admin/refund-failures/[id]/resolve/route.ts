// src/app/api/admin/refund-failures/[id]/resolve/route.ts
// Migration 0052 — bouton "résolution manuelle" : l'admin déclare avoir
// traité le remboursement autrement (virement manuel, décision de ne pas
// rembourser, etc.), sans repasser par Stripe via cette route. La note est
// obligatoire — un statut 'manual' sans justification serait aussi creux
// que l'ancienne promesse "vérification manuelle" que cette table remplace.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { withErrorHandling } from '@/lib/api-error';

export const POST = withErrorHandling('[RefundFailureResolve]', async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux admins' }, { status: 403 });
  }

  const { id } = await params;
  const { note } = await req.json().catch(() => ({ note: null }));
  if (!note || typeof note !== 'string' || !note.trim()) {
    return NextResponse.json({ error: 'Une note de résolution est requise.' }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();

  const { data: failure } = await serviceSupabase
    .from('refund_failures')
    .select('id, booking_id')
    .eq('id', id)
    .eq('status', 'open')
    .maybeSingle();
  if (!failure) return NextResponse.json({ error: 'Échec introuvable ou déjà traité' }, { status: 404 });

  await serviceSupabase
    .from('refund_failures')
    .update({
      status: 'manual',
      resolved_at: new Date().toISOString(),
      resolved_by: authData.user.id,
      resolution_note: note.trim(),
    })
    .eq('id', id);

  await serviceSupabase.from('booking_logs').insert({
    booking_id: failure.booking_id,
    message: `REFUND_FAILURE_RESOLVED_MANUALLY | refund_failure_id=${id} | admin=${authData.user.email ?? authData.user.id} | note=${note.trim()}`,
  });

  return NextResponse.json({ success: true });
});
