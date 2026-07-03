// src/lib/api-error.ts
// Log complet côté serveur — error.hint est souvent plus parlant que
// error.message pour un PostgrestError (voir
// node_modules/@supabase/postgrest-js/src/PostgrestError.ts) — et réponse
// générique côté client. Ne jamais renvoyer error.message brut à l'appelant :
// ça expose des détails internes (noms de contraintes, colonnes, etc.).
import { NextResponse } from 'next/server';

export function logAndRespond(context: string, error: unknown, status = 500) {
  console.error(context, error);
  return NextResponse.json(
    { error: 'Une erreur est survenue. Merci de réessayer.' },
    { status }
  );
}
