'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

export default function AuthWall({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Safety net: if the user is already authenticated when this wall mounts, skip it immediately
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      if (data.session) onAuth();
    });
  }, [onAuth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { name: fullName.trim(), phone, role: 'client' },
          },
        });
        if (signUpError) throw signUpError;
        if (data.user) {
          await fetch('/api/auth/post-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id, name: fullName.trim(), referrerCode: null }),
          }).catch(() => {});
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
      onAuth();
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-xl bg-navy-800/60 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200";

  return (
    <div>
      {/* Logo */}
      <div className="flex items-center justify-center gap-2 mb-5">
        <Image src="/logo.jpg" alt="Book'nPay" width={36} height={36} className="rounded-xl ring-1 ring-mint-500/20" />
        <span className="font-bold text-white text-sm tracking-tight">Book'nPay</span>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-navy-900 rounded-xl border border-white/[0.06] mb-4">
        {(['signup', 'login'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all duration-200 ${
              mode === m
                ? 'bg-mint-500 text-navy-950 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {m === 'signup' ? 'Créer un compte' : 'Se connecter'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'signup' && (
          <input type="text" placeholder="Nom et prénom" value={fullName} onChange={(e) => setFullName(e.target.value)} required className={inputClass} />
        )}
        {mode === 'signup' && (
          <input type="tel" placeholder="Téléphone (rappels SMS)" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
        <input type="password" placeholder="Mot de passe (6 min.)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={inputClass} />

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
          {loading ? '...' : mode === 'signup' ? "S'inscrire et continuer" : 'Se connecter et continuer'}
        </button>
      </form>
    </div>
  );
}
