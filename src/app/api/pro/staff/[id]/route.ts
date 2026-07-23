import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';

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

// PATCH /api/pro/staff/[id] — renommer ou désactiver un praticien
export const PATCH = withErrorHandling('[Staff]', async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (typeof body.role === 'string') updates.role = body.role.trim() || null;
  if (typeof body.emoji === 'string') updates.emoji = body.emoji.trim() || null;

  // Désactivation (démission) — soft delete, préserve l'historique des réservations
  if (body.deactivate === true) {
    updates.is_active = false;
    updates.deactivated_at = new Date().toISOString();
  }
  // Réactivation possible
  if (body.reactivate === true) {
    updates.is_active = true;
    updates.deactivated_at = null;
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('staff')
    .update(updates)
    .eq('id', id)
    .eq('biz_id', bizId) // sécurité : ne peut modifier que son propre staff
    .select('id, name, role, emoji, is_active, deactivated_at')
    .single();

  if (error) return logAndRespond('[Staff] Erreur update:', error);
  return NextResponse.json({ staff: data });
});

// DELETE /api/pro/staff/[id] — suppression définitive (rare, pour les erreurs de création)
export const DELETE = withErrorHandling('[Staff]', async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const admin = createServiceRoleClient();

  // Vérifie que ce praticien n'a aucune réservation liée
  const { count } = await admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Ce praticien a des réservations associées. Utilisez la désactivation plutôt que la suppression.' },
      { status: 409 }
    );
  }

  const { error } = await admin
    .from('staff')
    .delete()
    .eq('id', id)
    .eq('biz_id', bizId);

  if (error) return logAndRespond('[Staff] Erreur suppression:', error);
  return NextResponse.json({ ok: true });
});
