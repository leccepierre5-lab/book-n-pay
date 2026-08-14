// src/app/api/admin/search-misses/[id]/route.ts
// Suppression manuelle — répond au point de rétention soulevé le 14/08 : pas
// de purge automatique des emails de notification, mais un email conservé
// indéfiniment "en attendant qu'un pro ouvre" devient difficile à justifier.
// Restreint aux lignes action='notify' : ce n'est pas un outil générique de
// purge de la table (le journal silencieux et les invitations ne passent pas
// par cette route).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { withErrorHandling } from '@/lib/api-error';

export const DELETE = withErrorHandling('[SearchMissDelete]', async (
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
  const serviceSupabase = createServiceRoleClient();

  const { data: miss } = await serviceSupabase
    .from('search_misses')
    .select('id, action')
    .eq('id', id)
    .maybeSingle();
  if (!miss || miss.action !== 'notify') {
    return NextResponse.json({ error: 'Email introuvable' }, { status: 404 });
  }

  const { error } = await serviceSupabase.from('search_misses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });

  return NextResponse.json({ success: true });
});
