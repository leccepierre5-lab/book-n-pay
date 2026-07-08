// src/app/api/search/business-suggestions/route.ts
// Suggestions de noms d'établissements pour l'autocomplétion du champ de
// recherche (/recherche) — recherche par PRÉFIXE (plus sélective que la
// recherche libre %q% de searchBusinesses, qu'on ne touche pas ici).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  // Échappe les caractères spéciaux ILIKE (% et _) présents dans la saisie
  // utilisateur avant de les injecter dans le pattern — sinon un "%" tapé par
  // l'utilisateur élargirait le pattern au lieu d'être cherché littéralement.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('businesses')
    .select('name, slug')
    .eq('is_published', true)
    .eq('frozen', false)
    .ilike('name', `${escaped}%`)
    .order('name', { ascending: true })
    .limit(8);

  if (error) {
    console.error('[business-suggestions]', error.message);
    return NextResponse.json([]);
  }

  return NextResponse.json(data ?? []);
}
