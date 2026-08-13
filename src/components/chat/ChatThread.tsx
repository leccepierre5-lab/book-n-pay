'use client';
// src/components/chat/ChatThread.tsx
// Port simplifié de src/components/BookingChat.jsx
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ChatMessage } from '@/lib/database.types';
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/chat';

export default function ChatThread({
  bookingId,
  senderRole,
}: {
  bookingId: string;
  senderRole: 'client' | 'pro';
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from('chat_messages')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));

    const channel = supabase
      .channel(`chat-${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `booking_id=eq.${bookingId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as ChatMessage])
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId]);

  const send = async () => {
    if (!text.trim()) return;
    // Garde-fou client, en plus du `maxLength` du champ — ne remplace pas la
    // revalidation serveur (route.ts), même principe qu'ailleurs dans le
    // repo : ne jamais faire confiance à une seule validation côté client.
    if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
      setError(`Le message ne doit pas dépasser ${CHAT_MESSAGE_MAX_LENGTH} caractères.`);
      return;
    }
    setSending(true);
    setError(null);
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, text }),
    });
    // ⚠️ CORRECTIF (trouvé en audit) : aucun retour visuel en cas d'échec —
    // le texte restait dans le champ sans explication. Ajout d'un message
    // d'erreur discret plutôt qu'un échec silencieux.
    if (res.ok) {
      setText('');
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Le message n'a pas pu être envoyé. Réessaie.");
    }
    setSending(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
              m.sender_role === senderRole
                ? 'ml-auto bg-mint-500 text-navy-950'
                : 'bg-navy-800 text-white'
            }`}
          >
            {m.text}
          </div>
        ))}
        {messages.length === 0 && (
          <p className="py-6 text-center text-xs text-white/40">Aucun message pour l'instant.</p>
        )}
      </div>
      {error && <p className="px-3 pb-1 text-xs text-red-400">{error}</p>}
      {/* Mention minimisation des données (Pierre, texte exact — ne pas
          reformuler) : ce chat n'est pas hébergé en environnement certifié
          HDS, donc rien ici ne "sécurise" une donnée de santé qui y serait
          saisie — la mention réduit seulement le risque qu'elle y entre. */}
      <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
        <span className="shrink-0 text-sm text-amber-400">⚠</span>
        <p className="text-[11px] leading-snug text-amber-300">
          Ce chat sert à organiser votre rendez-vous. N&apos;y indiquez aucune information de santé
          ou donnée confidentielle.
        </p>
      </div>
      <div className="flex gap-2 p-3 pt-0">
        <div className="flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, CHAT_MESSAGE_MAX_LENGTH))}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Écrire un message..."
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            className="w-full rounded-lg bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
          />
          <p className="mt-1 text-right text-[10px] text-white/30">
            {text.length}/{CHAT_MESSAGE_MAX_LENGTH}
          </p>
        </div>
        <button
          onClick={send}
          disabled={sending}
          className="h-fit rounded-lg bg-mint-500 px-4 py-2 text-sm font-medium text-navy-950 disabled:opacity-50"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
