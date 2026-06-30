'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type View = 'login' | 'forgot' | 'forgot-sent';

export default function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/recherche';

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Résout initializePromise du GoTrueClient avant la première soumission,
    // évite la race condition lock × signInWithPassword sur cold mount.
    createClient().auth.getSession().catch(() => {});
  }, []);

  const inputClass = "w-full rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    window.location.href = redirectTo;
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Erreur');
      return;
    }
    setView('forgot-sent');
  };

  if (view === 'forgot-sent') {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="w-14 h-14 rounded-full bg-mint-500/15 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Email envoyé</p>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            Si un compte existe pour <span className="text-mint-400">{email}</span>, tu recevras
            un lien pour réinitialiser ton mot de passe.
          </p>
        </div>
        <button onClick={() => setView('login')} className="text-xs text-mint-400 hover:text-mint-300 transition-colors">
          ← Retour à la connexion
        </button>
      </div>
    );
  }

  if (view === 'forgot') {
    return (
      <form onSubmit={handleForgot} className="space-y-3">
        <p className="text-xs text-slate-400 mb-1">Saisis ton email — on t'envoie un lien de réinitialisation.</p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={inputClass}
        />
        {error && (
          <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)', color: loading ? '#94a3b8' : undefined }}
        >
          {loading ? 'Envoi...' : 'Envoyer le lien'}
        </button>
        <button type="button" onClick={() => { setView('login'); setError(null); }} className="w-full text-xs text-slate-500 py-1 hover:text-slate-300 transition-colors">
          ← Retour à la connexion
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleLogin} className="space-y-3">
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className={inputClass}
      />
      <div>
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className={inputClass}
        />
        <div className="flex justify-end mt-1.5">
          <button
            type="button"
            onClick={() => { setView('forgot'); setError(null); }}
            className="text-[11px] text-slate-500 hover:text-mint-400 transition-colors"
          >
            Mot de passe oublié ?
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
          color: loading ? '#94a3b8' : undefined,
        }}
      >
        {loading ? 'Connexion...' : 'Se connecter'}
      </button>
    </form>
  );
}
