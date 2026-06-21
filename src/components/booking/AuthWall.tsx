'use client';
// src/components/booking/AuthWall.tsx
// Port de src/components/booking/AuthWall.jsx — adapté à l'auth Supabase
// email + mot de passe (au lieu du téléphone Base44).
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthWall({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, phone, role: 'client' } },
        });
        if (signUpError) throw signUpError;
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === 'signup' && (
        <input
          type="text"
          placeholder="Nom complet"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
        />
      )}
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      {mode === 'signup' && (
        <input
          type="tel"
          placeholder="Téléphone (pour les rappels SMS)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
        />
      )}
      <input
        type="password"
        placeholder="Mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-mint-500 py-3 font-medium text-navy-950 disabled:opacity-50"
      >
        {loading ? '...' : mode === 'signup' ? "S'inscrire et continuer" : 'Se connecter'}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
        className="w-full text-center text-xs text-white/50 hover:text-white"
      >
        {mode === 'signup' ? 'Déjà un compte ? Se connecter' : "Pas de compte ? S'inscrire"}
      </button>
    </form>
  );
}
