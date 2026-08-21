import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';
import { MAX_DEPOSIT_EUROS, minDeposit } from '@/lib/booking-utils';
import { SERVICE_NAME_MAX_LENGTH } from '@/lib/service-name-suggestions';

async function getBizId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!data?.biz_id || (data.role !== 'pro' && data.role !== 'admin')) return null;
  return data.biz_id;
}

export const GET = withErrorHandling('[Services]', async () => {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('biz_id', bizId)
    .order('created_at');

  if (error) return logAndRespond('[Services] Erreur liste:', error);
  return NextResponse.json(data);
});

export const POST = withErrorHandling('[Services]', async (req: NextRequest) => {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { name, genre, allow_group, duration_minutes, price, deposit, max_persons } = body;

  if (!name || !duration_minutes || price == null) {
    return NextResponse.json({ error: 'name, duration_minutes et price requis' }, { status: 400 });
  }

  // Défense en profondeur (client + serveur + CHECK 0049) — jamais confiance
  // dans le seul maxLength du champ côté client, même principe que
  // chat_messages/chat/send/route.ts.
  if (String(name).trim().length > SERVICE_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Le nom de la prestation ne doit pas dépasser ${SERVICE_NAME_MAX_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  // ⚠️ CORRECTIF (LOT 2 #1, audit tarification 27/07) : un dépôt à 0€
  // rendait le service structurellement inréservable en ligne —
  // stripe/checkout/route.ts refuse tout paiement Stripe sous 1€, le client
  // tombait sur une erreur en toute fin de tunnel, après avoir déjà choisi
  // son créneau. `deposit` défaultait silencieusement à 0 (`?? 0`) si omis.
  // DURCI le 21/08 (décision Pierre) : le plancher n'est plus un flat 1€
  // mais minDeposit(price) — 20% du prix, plancher 5€, jamais au-dessus du
  // prix. Impose un vrai minimum anti-no-show, pas seulement un montant
  // techniquement réservable par Stripe.
  if (deposit == null || Number(deposit) < minDeposit(Number(price))) {
    return NextResponse.json(
      { error: `Le dépôt (frais de réservation) doit être d'au moins ${minDeposit(Number(price))}€ pour cette prestation (minimum 20% du prix, plancher 5€).` },
      { status: 400 }
    );
  }

  // Plafond dépôt (Stripe prélève sur le total débité, un dépôt élevé détruit
  // la marge) — voir MAX_DEPOSIT_EUROS. Services déjà en base au-delà : non
  // modifiés, seules les nouvelles créations/éditions sont contraintes.
  if (Number(deposit) > MAX_DEPOSIT_EUROS) {
    return NextResponse.json(
      { error: `Le dépôt (frais de réservation) ne peut pas dépasser ${MAX_DEPOSIT_EUROS}€.` },
      { status: 400 }
    );
  }

  if (Number(deposit) > Number(price)) {
    return NextResponse.json(
      { error: 'Le dépôt (frais de réservation) ne peut pas dépasser le prix de la prestation.' },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('services')
    .insert({
      biz_id: bizId,
      name: name.trim(),
      genre: genre || null,
      allow_group: allow_group !== false,
      duration_minutes: Number(duration_minutes),
      price: Number(price),
      deposit: Number(deposit),
      max_persons: max_persons ? Number(max_persons) : null,
    })
    .select()
    .single();

  if (error) return logAndRespond('[Services] Erreur création:', error);
  return NextResponse.json(data, { status: 201 });
});

export const PATCH = withErrorHandling('[Services]', async (req: NextRequest) => {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { id, name, genre, allow_group, duration_minutes, price, deposit, max_persons } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const supabase = createServiceRoleClient();

  // Vérifie que le service appartient bien à ce biz — price/deposit inclus
  // pour valider le couple final même quand un seul des deux champs change.
  const { data: existing } = await supabase
    .from('services')
    .select('id, price, deposit')
    .eq('id', id)
    .eq('biz_id', bizId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 });

  if (name !== undefined && String(name).trim().length > SERVICE_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Le nom de la prestation ne doit pas dépasser ${SERVICE_NAME_MAX_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  if (deposit !== undefined) {
    // Plafond dépôt — services déjà en base au-delà : non modifiés, seules
    // les éditions qui touchent explicitement le dépôt sont contraintes.
    // (flat, indépendant du prix — reste vérifié uniquement quand deposit
    // est explicitement envoyé, contrairement au minimum ci-dessous.)
    if (Number(deposit) > MAX_DEPOSIT_EUROS) {
      return NextResponse.json(
        { error: `Le dépôt (frais de réservation) ne peut pas dépasser ${MAX_DEPOSIT_EUROS}€.` },
        { status: 400 }
      );
    }
  }

  // ⚠️ Vérifié dès que price OU deposit change (pas seulement deposit) :
  // le minimum dépend du prix — baisser SEULEMENT le prix peut faire passer
  // un dépôt déjà en base sous le nouveau minimum de 20%, sans que le pro
  // n'ait touché au champ dépôt. Même principe que le garde dépôt<=prix
  // juste en dessous, calculé sur les mêmes finalPrice/finalDeposit.
  if (deposit !== undefined || price !== undefined) {
    const finalPrice = price !== undefined ? Number(price) : existing.price;
    const finalDeposit = deposit !== undefined ? Number(deposit) : existing.deposit;
    if (finalDeposit > finalPrice) {
      return NextResponse.json(
        { error: 'Le dépôt (frais de réservation) ne peut pas dépasser le prix de la prestation.' },
        { status: 400 }
      );
    }
    const min = minDeposit(finalPrice);
    if (finalDeposit < min) {
      return NextResponse.json(
        { error: `Le dépôt (frais de réservation) doit être d'au moins ${min}€ pour cette prestation (minimum 20% du prix, plancher 5€).` },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (genre !== undefined) updates.genre = genre || null;
  if (allow_group !== undefined) updates.allow_group = allow_group !== false;
  if (duration_minutes !== undefined) updates.duration_minutes = Number(duration_minutes);
  if (price !== undefined) updates.price = Number(price);
  if (deposit !== undefined) updates.deposit = Number(deposit);
  if (max_persons !== undefined) updates.max_persons = max_persons ? Number(max_persons) : null;

  const { data, error } = await supabase
    .from('services')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return logAndRespond('[Services] Erreur update:', error);
  return NextResponse.json(data);
});

export const DELETE = withErrorHandling('[Services]', async (req: NextRequest) => {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from('services')
    .select('id')
    .eq('id', id)
    .eq('biz_id', bizId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 });

  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) return logAndRespond('[Services] Erreur suppression:', error);
  return NextResponse.json({ ok: true });
});
