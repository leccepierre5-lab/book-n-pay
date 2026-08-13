// src/app/api/chat/send/route.ts
// Combine l'insertion du message et la notification email — port de
// base44/functions/notifyNewChatMessage/entry.ts, mais appelé explicitement
// après l'insert plutôt que via une automation DB.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { formatTime } from '@/lib/booking-utils';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/chat';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bookingId, text } = await req.json();
    if (!bookingId || !text) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    // Revalidation serveur de la longueur — jamais confiance dans le seul
    // `maxLength` du champ côté client (même principe que partout ailleurs
    // dans ce repo, ex. stripe/checkout/route.ts qui revalide tout côté
    // serveur). Minimisation de données, pas une mesure de conformité HDS :
    // voir le commentaire de CHAT_MESSAGE_MAX_LENGTH (src/lib/chat.ts).
    if (typeof text !== 'string' || text.length > CHAT_MESSAGE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Le message ne doit pas dépasser ${CHAT_MESSAGE_MAX_LENGTH} caractères.` },
        { status: 400 }
      );
    }

    // senderRole/senderName ne sont jamais pris depuis le body (auto-déclarables
    // par le client) : dérivés côté serveur de la relation réelle entre l'user
    // authentifié et la réservation, pour empêcher toute usurpation (ex: un
    // client qui s'attribuerait senderRole:'pro' pour se faire passer pour
    // l'établissement).
    const { data: booking } = await supabase
      .from('bookings')
      .select('biz_id, client_id, client_name, biz_name')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

    let senderRole: 'client' | 'pro';
    let senderName: string;

    if (booking.client_id === authData.user.id) {
      senderRole = 'client';
      senderName = booking.client_name || 'Client';
    } else {
      const { data: proProfile } = await supabase
        .from('app_users')
        .select('name, role, biz_id')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (!proProfile || proProfile.biz_id !== booking.biz_id || !['pro', 'admin'].includes(proProfile.role)) {
        return NextResponse.json({ error: 'Accès interdit' }, { status: 403 });
      }
      senderRole = 'pro';
      senderName = proProfile.name || booking.biz_name || 'Professionnel';
    }

    const { data: message, error } = await supabase
      .from('chat_messages')
      .insert({ booking_id: bookingId, sender_role: senderRole, sender_name: senderName, text })
      .select()
      .single();

    if (error) throw error;

    // ⚠️ MINIMISATION DE DONNÉES (audit, pas une mesure de conformité HDS) :
    // notifyRecipient ne reçoit plus `text` ni `senderName` — l'email de
    // notification ne doit plus jamais contenir d'extrait du message, ni le
    // nom de la prestation, ni qui a écrit quoi, voir son corps ci-dessous.
    notifyRecipient(bookingId, senderRole).catch((e) =>
      console.warn('[Chat] Notification échouée:', e.message)
    );

    return NextResponse.json({ message });
  } catch (error: any) {
    return logAndRespond('[Chat] Erreur envoi:', error);
  }
}

async function notifyRecipient(bookingId: string, senderRole: 'client' | 'pro') {
  const supabase = createServiceRoleClient();
  const { data: booking } = await supabase
    .from('bookings')
    .select('biz_id, biz_name, date, time, client_name, client_email')
    .eq('id', bookingId)
    .single();

  if (!booking) return;

  let recipientEmail: string | null = null;
  let recipientName: string | null = null;
  let subjectPrefix = '';

  if (senderRole === 'client') {
    const { data: proUser } = await supabase
      .from('app_users')
      .select('id, name')
      .eq('biz_id', booking.biz_id)
      .eq('role', 'pro')
      .maybeSingle();

    // ⚠️ TODO: app_users n'a pas de colonne email (elle vit dans auth.users).
    // Pour un vrai envoi, récupérer l'email via :
    //   const { data } = await supabase.auth.admin.getUserById(proUser.id)
    //   recipientEmail = data.user?.email
    // Laissé explicite plutôt que deviné, pour ne pas introduire un faux email.
    if (proUser) {
      const { data: authUser } = await supabase.auth.admin.getUserById(proUser.id);
      recipientEmail = authUser.user?.email || null;
    }
    recipientName = proUser?.name || booking.biz_name || 'Professionnel';
    subjectPrefix = '💬 Nouveau message client';
  } else {
    recipientEmail = booking.client_email;
    recipientName = booking.client_name || 'Client';
    subjectPrefix = `💬 Réponse de ${booking.biz_name}`;
  }

  if (!recipientEmail) {
    console.log("[Chat] Pas d'email destinataire trouvé pour booking", bookingId);
    return;
  }

  // ⚠️ CORRECTIF (trouvé en audit) : new Date('2026-06-25') sans heure est
  // interprété en UTC minuit, ce qui peut afficher la veille selon le
  // fuseau horaire d'exécution (ex: en France, UTC+1/+2). Ajout de
  // T12:00:00 pour se placer à midi, loin des bords de minuit — même
  // pattern déjà utilisé correctement ailleurs dans le code (webhook,
  // confirmation, etc.), raté ici lors de la première écriture.
  const dateLabel = booking.date
    ? new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : booking.date;

  // Lien vers le fil de chat réel — seule page qui affiche ChatThread
  // aujourd'hui, cliente comme pro (la page ne filtre pas par rôle, elle
  // dérive juste l'alignement des bulles du profil connecté). Pas de lien
  // pro dédié distinct pour l'instant.
  const chatUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app'}/mes-reservations/${bookingId}`;

  // ⚠️ MINIMISATION DE DONNÉES (audit, pas une mesure de conformité HDS) :
  // cet email ne doit contenir NI extrait du message NI nom de prestation
  // (service_name) — chat_messages.text n'est pas hébergé en environnement
  // certifié HDS, et un message de coordination de rendez-vous peut
  // involontairement contenir une donnée de santé. Réduire ce que Resend
  // reçoit réduit la surface d'exposition ; ça ne rend rien "conforme".
  // Le sujet de l'email suit la même règle (pas de service_name non plus).
  await sendEmail({
    to: recipientEmail,
    subject: `${subjectPrefix} — ${booking.biz_name}`,
    text: `Bonjour ${recipientName},\n\nVous avez un nouveau message concernant votre réservation du ${dateLabel} à ${formatTime(booking.time)} chez ${booking.biz_name}.\n\nConnectez-vous à Book'nPay pour le consulter :\n${chatUrl}\n\nL'équipe Book'nPay`,
  });
}
