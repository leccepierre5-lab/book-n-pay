// src/app/api/admin/applications/route.ts
// Valide ou rejette une candidature partenaire. RLS exige déjà le rôle
// admin pour la lecture/écriture de partner_applications, mais on revérifie
// explicitement ici pour un message d'erreur clair.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role')
      .eq('id', authData.user.id)
      .single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Accès réservé aux admins' }, { status: 403 });
    }

    const { applicationId, status, adminNote } = await req.json();
    if (!applicationId || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
    }

    const { error } = await supabase
      .from('partner_applications')
      .update({ status, admin_note: adminNote || null })
      .eq('id', applicationId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[AdminApplications] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
