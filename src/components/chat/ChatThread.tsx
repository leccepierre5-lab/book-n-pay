'use client';
// src/components/chat/ChatThread.tsx
// Port simplifié de src/components/BookingChat.jsx
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ChatMessage } from '@/lib/database.types';

export default function ChatThread({
  bookingId,
  senderRole,
  senderName,
}: {
  bookingId: string;
  senderRole: 'client' | 'pro';
  senderName: string;
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
    setSending(true);
    setError(null);
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, senderRole, senderName, text }),
    });
    // ⚠️ CORRECTIF (trouvé en audit) : aucun retour visuel en cas d'échec —
    // le texte restait dans le champ sans explication. Ajout d'un message
    // d'erreur discret plutôt qu'un échec silencieux.
    if (res.ok) {
      setText('');
    } else {
      setError("Le message n'a pas pu être envoyé. Réessaie.");
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
      <div className="flex gap-2 p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Écrire un message..."
          className="flex-1 rounded-lg bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
        />
        <button
          onClick={send}
          disabled={sending}
          className="rounded-lg bg-mint-500 px-4 py-2 text-sm font-medium text-navy-950 disabled:opacity-50"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
