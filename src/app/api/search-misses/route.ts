// src/app/api/search-misses/route.ts
// Les deux actions consenties de l'écran zéro résultat (migration 0054) —
// jamais le journal silencieux, qui est écrit directement côté serveur dans
// /recherche/page.tsx (voir src/lib/search-misses.ts).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { withErrorHandling } from '@/lib/api-error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = withErrorHandling('[SearchMisses]', async (req: NextRequest) => {
  const { allowed } = await checkRateLimit(`search-misses:${getClientIp(req)}`, 10, 10 * 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const { action, query, category, city, email, consent, businessName, businessContact } =
    body as Record<string, unknown>;

  const context = {
    query: typeof query === 'string' ? query.trim().slice(0, 200) || null : null,
    category: typeof category === 'string' ? category.trim().slice(0, 60) || null : null,
    city: typeof city === 'string' ? city.trim().slice(0, 120) || null : null,
  };

  const supabase = createServiceRoleClient();

  if (action === 'notify') {
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 });
    }
    if (consent !== true) {
      return NextResponse.json({ error: 'Consentement requis' }, { status: 400 });
    }
    const { error } = await supabase.from('search_misses').insert({
      ...context,
      action: 'notify',
      user_email: email.trim().toLowerCase(),
    });
    if (error) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === 'invite') {
    if (typeof businessName !== 'string' || !businessName.trim()) {
      return NextResponse.json({ error: 'Nom du professionnel requis' }, { status: 400 });
    }
    if (typeof businessContact !== 'string' || !businessContact.trim()) {
      return NextResponse.json({ error: 'Contact du professionnel requis' }, { status: 400 });
    }
    const { error } = await supabase.from('search_misses').insert({
      ...context,
      action: 'invite',
      invited_business_name: businessName.trim().slice(0, 200),
      invited_business_contact: businessContact.trim().slice(0, 200),
    });
    if (error) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
});
