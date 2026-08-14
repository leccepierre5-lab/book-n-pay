'use client';
// Écran zéro résultat (migration 0054, Bloc B 14/08) — deux actions
// optionnelles et consenties, en plus du journal silencieux déjà écrit
// côté serveur (voir page.tsx). Texte honnête : jamais de délai promis.
import { useState, type FormEvent } from 'react';
import Link from 'next/link';

type Mode = 'idle' | 'notify' | 'invite';
type Status = 'idle' | 'sending' | 'sent' | 'error';

export function ZeroResultsPanel({
  query,
  category,
  city,
}: {
  query: string | null;
  category: string | null;
  city: string | null;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [businessContact, setBusinessContact] = useState('');

  const submit = async (action: 'notify' | 'invite', extra: Record<string, unknown>) => {
    setStatus('sending');
    setError(null);
    const res = await fetch('/api/search-misses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, query, category, city, ...extra }),
    });
    if (res.ok) {
      setStatus('sent');
    } else {
      const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      setError(d.error ?? 'Erreur serveur');
      setStatus('error');
    }
  };

  const submitNotify = (e: FormEvent) => {
    e.preventDefault();
    submit('notify', { email, consent });
  };

  const submitInvite = (e: FormEvent) => {
    e.preventDefault();
    submit('invite', { businessName, businessContact });
  };

  if (status === 'sent') {
    return (
      <div className="py-16 text-center">
        <p className="text-4xl mb-4">✅</p>
        <p className="text-slate-300 text-sm">
          {mode === 'invite'
            ? 'Merci, on prend le relais.'
            : 'Merci — on vous écrit seulement si un pro correspondant arrive.'}
        </p>
      </div>
    );
  }

  return (
    <div className="py-16 text-center">
      <p className="text-4xl mb-4">🔍</p>
      <p className="text-slate-400 text-sm mb-1">Aucun établissement ne correspond.</p>
      <p className="text-slate-500 text-xs mb-6">Aucun pro ne propose encore ça ici — vous pouvez faire remonter la demande.</p>

      {mode === 'idle' && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setMode('notify')}
            className="rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-navy-950"
          >
            Prévenez-moi quand un pro arrive
          </button>
          <button
            onClick={() => setMode('invite')}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Invitez votre professionnel
          </button>
        </div>
      )}

      {mode === 'notify' && (
        <form onSubmit={submitNotify} className="mx-auto max-w-sm space-y-3 text-left">
          <input
            type="email"
            required
            placeholder="votre@email.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-2.5 text-sm text-white outline-none focus:border-mint-500/40"
          />
          <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-mint-500"
            />
            <span>
              J&apos;accepte que mon email soit conservé pour être prévenu si un pro correspondant arrive.
              Aucun autre usage, pas de date promise.
            </span>
          </label>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === 'sending'}
              className="rounded-xl bg-mint-500 px-4 py-2 text-sm font-semibold text-navy-950 disabled:opacity-50"
            >
              {status === 'sending' ? 'Envoi…' : 'Me prévenir'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-xs text-slate-500 hover:text-slate-300">
              Annuler
            </button>
          </div>
        </form>
      )}

      {mode === 'invite' && (
        <form onSubmit={submitInvite} className="mx-auto max-w-sm space-y-3 text-left">
          <input
            required
            placeholder="Nom du professionnel"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-2.5 text-sm text-white outline-none focus:border-mint-500/40"
          />
          <input
            required
            placeholder="Email ou téléphone professionnel"
            value={businessContact}
            onChange={(e) => setBusinessContact(e.target.value)}
            className="w-full rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-2.5 text-sm text-white outline-none focus:border-mint-500/40"
          />
          <p className="text-xs text-slate-500">
            On le contactera en tant que professionnel, jamais à titre personnel — et on lui dira que c&apos;est vous qui l&apos;avez signalé.
          </p>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === 'sending'}
              className="rounded-xl bg-mint-500 px-4 py-2 text-sm font-semibold text-navy-950 disabled:opacity-50"
            >
              {status === 'sending' ? 'Envoi…' : 'Inviter'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-xs text-slate-500 hover:text-slate-300">
              Annuler
            </button>
          </div>
        </form>
      )}

      <Link href="/recherche" className="mt-6 inline-block text-mint-400 text-xs hover:underline">
        Voir tous les établissements →
      </Link>
    </div>
  );
}
