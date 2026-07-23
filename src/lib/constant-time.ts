// src/lib/constant-time.ts
// SECURITY_TODO.md #6 — les comparaisons de secrets bearer (CRON_SECRET,
// INTERNAL_API_SECRET) utilisaient `!==` classique, vulnérable en théorie à
// une timing attack. crypto.timingSafeEqual() existe précisément pour ça.
import { timingSafeEqual } from 'crypto';

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Longueurs différentes = pas égal, mais on ne peut pas juste `return false`
  // avant timingSafeEqual (qui exige des buffers de même taille) sans réintroduire
  // une fuite de timing sur la longueur — comparaison à taille fixe (32) en secours.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Vérifie le header `Authorization: Bearer <secret>` envoyé par Vercel Cron
// ou un appel interne, en temps constant.
export function isValidBearerSecret(authHeader: string | null, secret: string | undefined): boolean {
  if (!authHeader || !secret) return false;
  return constantTimeEqual(authHeader, `Bearer ${secret}`);
}
