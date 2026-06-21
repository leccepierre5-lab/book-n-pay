'use client';
// src/components/auth/RegisterForm.tsx
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get('ref');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, phone, role: 'client', referral_code: referralCode || undefined } },
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    router.push('/recherche');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {referralCode && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          🎁 Tu rejoins Book'nPay grâce à un parrainage — vous recevrez tous les deux un bonus dès
          ton premier RDV honoré.
        </p>
      )}
      <input
        type="text"
        placeholder="Nom complet"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        type="tel"
        placeholder="Téléphone (rappels SMS)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
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
        {loading ? '...' : "S'inscrire"}
      </button>
      <Link href="/connexion" className="block text-center text-xs text-white/50 hover:text-white">
        Déjà un compte ? Se connecter
      </Link>
    </form>
  );
}
