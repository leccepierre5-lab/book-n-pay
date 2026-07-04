import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password) return NextResponse.json({ error: 'Mot de passe requis' }, { status: 400 });

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.email) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Réauthentification — valide l'identité avant de supprimer
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: auth.user.email,
      password,
    });
    if (signInError) {
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 400 });
    }

    const userId = auth.user.id;
    const admin = createServiceRoleClient();

    // Anonymisation : on efface les données personnelles mais on garde
    // les bookings/transactions pour les obligations légales de facturation.
    await admin
      .from('app_users')
      .update({
        name: 'Utilisateur supprimé',
        phone: null,
      })
      .eq('id', userId);

    // Suppression du compte auth → impossible de se reconnecter
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return logAndRespond('[delete-account] deleteUser error:', deleteError);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return logAndRespond('[delete-account]', err);
  }
}
