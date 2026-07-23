// src/app/page.tsx
// Server Component — lit la session AVANT le premier rendu (comme /pro et
// /mon-compte, même pattern createClient()+getUser()) : plus de flash "état
// null" ni de round-trip client pour décider connecté vs déconnecté, le h1 et
// le contenu du slide de départ sont dans le HTML SSR. La state machine des
// slides (interactive) est isolée dans HomeClient.
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
      .select('role, name')
      .eq('id', authData.user.id)
      .maybeSingle();
    const role = appUser?.role;
    connectedSpace = role === 'admin' ? '/admin' : role === 'pro' ? '/pro' : '/recherche';
    // app_users.name retombe sur l'email si aucun nom n'a été fourni à
    // l'inscription (trigger handle_new_user) — ne jamais afficher
    // "Bonjour pierre@gmail.com".
    const rawName = appUser?.name?.trim();
    firstName = rawName && !rawName.includes('@') ? rawName.split(' ')[0] : null;
  }

  return <HomeClient connectedSpace={connectedSpace} firstName={firstName} />;
}
