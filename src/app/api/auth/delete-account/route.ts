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
    // les bookings/transactions pour les obligations légales de facturation
    // (montant/date conservés, identité effacée). Fait AVANT le deleteUser
    // plus bas — celui-ci met bookings.client_id à NULL via la FK, ce qui
    // ferait perdre la seule façon de retrouver ces lignes.
    // ⚠️ CORRECTIF (trouvé en audit, 18/07) : app_users était bien anonymisé,
    // mais pas les copies dénormalisées bookings.client_name/email/phone ni
    // booking_members.name/phone/email — exactement ce que lisent le dashboard
    // pro et l'export CSV (pro/export-clients), qui ne consultent jamais
    // app_users. Un compte supprimé restait donc entièrement identifiable
    // partout où un pro le consultait, malgré la promesse d'anonymisation
    // affichée au client. Portée volontairement limitée aux bookings dont le
    // client est l'organisateur (bookings.client_id) — les booking_members où
    // il n'est qu'invité chez quelqu'un d'autre n'ont aucun lien d'ID
    // (seul un rapprochement téléphone/email les retrouverait, écarté ici :
    // une opération irréversible ne doit pas reposer sur une heuristique
    // pouvant anonymiser les données d'un tiers par collision). Dette
    // documentée séparément.
    const { data: ownBookings } = await admin
      .from('bookings')
      .select('id')
      .eq('client_id', userId);
    const ownBookingIds = (ownBookings ?? []).map((b) => b.id);

    if (ownBookingIds.length > 0) {
      await admin
        .from('booking_members')
        .update({ name: 'Client supprimé', phone: null, email: null })
        .in('booking_id', ownBookingIds);

      await admin
        .from('bookings')
        .update({ client_name: 'Client supprimé', client_email: null, client_phone: null })
        .eq('client_id', userId);
    }

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
