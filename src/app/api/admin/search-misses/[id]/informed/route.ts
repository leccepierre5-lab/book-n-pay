// src/app/api/admin/search-misses/[id]/informed/route.ts
// Article 14 RGPD : coche/décoche la preuve que le pro invité (donnée d'un
// tiers non consentant) a été informé de la source au premier contact.
// Rempli à la main, jamais automatiquement — voir migration 0054.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { withErrorHandling } from '@/lib/api-error';

export const POST = withErrorHandling('[SearchMissInformed]', async (
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
  const { informed } = await req.json().catch(() => ({ informed: null }));
  if (typeof informed !== 'boolean') {
    return NextResponse.json({ error: 'Paramètre informed manquant' }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();
  const { data: miss } = await serviceSupabase
    .from('search_misses')
    .select('id, action')
    .eq('id', id)
    .maybeSingle();
  if (!miss || miss.action !== 'invite') {
    return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 });
  }

  const informed_at = informed ? new Date().toISOString() : null;
  const { error } = await serviceSupabase.from('search_misses').update({ informed_at }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });

  return NextResponse.json({ informed_at });
});
