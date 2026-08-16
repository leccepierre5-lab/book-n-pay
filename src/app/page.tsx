// src/app/page.tsx
// Server Component — lit la session AVANT le premier rendu (comme /pro et
// /mon-compte, même pattern createClient()+getUser()) : plus de flash "état
// null" ni de round-trip client pour décider connecté vs déconnecté, le h1 et
// le contenu du slide de départ sont dans le HTML SSR. La state machine des
// slides (interactive) est isolée dans HomeClient.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HomeClient from '@/components/home/HomeClient';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  let connectedSpace: string | null = null;
  let firstName: string | null = null;

  if (authData.user) {
    const { data: appUser } = await supabase
      .from('app_users')
      .select('role, name, biz_id')
      .eq('id', authData.user.id)
      .maybeSingle();
    const role = appUser?.role;
    connectedSpace = role === 'admin' ? '/admin' : role === 'pro' ? '/pro' : '/recherche';
    // app_users.name retombe sur l'email si aucun nom n'a été fourni à
    // l'inscription (trigger handle_new_user) — ne jamais afficher
    // "Bonjour pierre@gmail.com".
    const rawName = appUser?.name?.trim();
    firstName = rawName && !rawName.includes('@') ? rawName.split(' ')[0] : null;

    // Redirection connecté → son espace (16/08/2026), accueil UNIQUEMENT —
    // /tarifs, /recherche, les fiches établissement et /devenir-partenaire
    // restent accessibles à tous sans redirection, ce n'est pas un guard
    // global. `role` est un champ unique par compte, jamais cumulé pro+client
    // (même modèle que getBookingBlockedRole, qui bloque déjà un compte
    // pro/admin de réserver comme client) — pas d'ambiguïté à trancher ici.
    // ⚠️ PAS de redirect('/pro') si role==='pro' sans biz_id : /pro/page.tsx
    // redirige LUI-MÊME vers '/' dans ce cas précis (compte pro créé mais
    // établissement pas encore lié) — rediriger sans vérifier biz_id
    // créerait une boucle infinie / ↔ /pro. Ce cas reste donc sur l'accueil
    // normal (comportement inchangé), connectedSpace continue de pointer
    // vers /pro pour le bandeau existant même si non atteignable pour
    // l'instant — c'est le pro lui-même qui doit finir son inscription.
    if (role === 'admin') {
      redirect('/admin');
    }
    if (role === 'pro' && appUser?.biz_id) {
      redirect('/pro');
    }
    if (role !== 'pro') {
      // Client (role='client' ou role absent — compte tout juste créé par le
      // trigger handle_new_user, toujours 'client' par défaut) → ses
      // réservations. /mes-reservations n'a aucun guard qui renvoie vers
      // '/', pas de risque de boucle.
      redirect('/mes-reservations');
    }
  }

  return <HomeClient connectedSpace={connectedSpace} firstName={firstName} />;
}
