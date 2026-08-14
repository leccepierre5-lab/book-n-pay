// src/lib/search-misses.ts
// Journal silencieux des recherches sans résultat (migration 0054, Bloc B
// 14/08) — écrit à chaque recherche vide, sans consentement puisqu'aucun
// identifiant ne relie deux lignes entre elles. Ne jamais ajouter ici de
// paramètre (session_id, IP...) qui permettrait de relier plusieurs
// recherches à une même personne : ça changerait la nature de la donnée.
import { createServiceRoleClient } from '@/lib/supabase/server';

export interface SearchMissContext {
  query: string | null;
  category: string | null;
  city: string | null;
}

export async function logSearchMiss(context: SearchMissContext): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('search_misses').insert({
      query: context.query,
      category: context.category,
      city: context.city,
      action: 'none',
    });
  } catch (err) {
    // Non bloquant — un journal qui échoue ne doit jamais casser /recherche.
    console.error('[search-misses] log échoué:', err);
  }
}
