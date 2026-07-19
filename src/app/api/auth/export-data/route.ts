// src/app/api/auth/export-data/route.ts
// Export RGPD (droit à la portabilité, art. 20) : le client télécharge ses
// propres données au format JSON. ID lu depuis la session serveur, jamais
// depuis un paramètre — sinon n'importe qui pourrait exporter le dossier de
// n'importe qui en changeant un ID dans l'URL.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { allowed } = await checkRateLimit(`export-data:user:${user.id}`, 3, 60 * 60, { failClosed: true });
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de demandes, réessaie plus tard.' }, { status: 429 });
    }

    const admin = createServiceRoleClient();

    const [{ data: profile }, { data: bookings }, { data: favorites }, { data: referralEvents }] =
      await Promise.all([
        admin.from('app_users').select('*').eq('id', user.id).maybeSingle(),
        admin
          .from('bookings')
          .select('*, booking_members(*)')
          .eq('client_id', user.id)
          .order('date', { ascending: false }),
        admin.from('favorites').select('*').eq('user_id', user.id),
        admin
          .from('referral_events')
          .select('*')
          .or(`referrer_id.eq.${user.id},referred_id.eq.${user.id}`),
      ]);

    const payload = {
      export_genere_le: new Date().toISOString(),
      compte: { id: user.id, email: user.email, ...profile },
      reservations: bookings ?? [],
      favoris: favorites ?? [],
      parrainage: referralEvents ?? [],
      note: "Les réservations où vous êtes uniquement invité(e) par un tiers (lien de partage, mode groupe) ne sont pas incluses dans cet export : elles ne sont pas rattachées de façon fiable à votre identifiant de compte.",
    };

    const json = JSON.stringify(payload, null, 2);

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mes-donnees-book-n-pay-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err: any) {
    return logAndRespond('[export-data]', err);
  }
}
