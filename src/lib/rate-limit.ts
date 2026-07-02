// src/lib/rate-limit.ts
// Rate limiting léger basé sur une table Supabase dédiée (rate_limits,
// migration 0021) — pas de Redis/Upstash dans ce projet. Voir SECURITY_TODO.md
// #3. Compteur incrémenté atomiquement côté Postgres (check_rate_limit),
// jamais en lecture-puis-écriture côté Node pour éviter la race condition.
import { NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
}

/**
 * Fail-open par design : si la table/fonction n'existe pas encore (migration
 * pas encore exécutée) ou en cas d'erreur réseau, on laisse passer la requête
 * plutôt que de casser l'inscription/connexion/paiement pour tout le monde.
 * Un rate limiter qui plante ne doit jamais devenir un déni de service.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .rpc('check_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
      .single();

    if (error || !data) {
      console.warn('[rate-limit] check_rate_limit indisponible, fail-open:', error?.message);
      return { allowed: true, currentCount: 0 };
    }

    // Client Supabase non typé sur le schéma (database.types.ts est maintenu
    // à la main, sans les Functions) — cast local sur la forme connue de la RPC.
    const row = data as { allowed: boolean; current_count: number };
    return { allowed: row.allowed, currentCount: row.current_count };
  } catch (e: any) {
    console.warn('[rate-limit] erreur inattendue, fail-open:', e.message);
    return { allowed: true, currentCount: 0 };
  }
}

// Vercel transmet l'IP réelle du client via x-forwarded-for (premier maillon
// de la liste). Pas d'équivalent NextRequest.ip fiable en App Router.
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
