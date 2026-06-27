'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function RegisterForm() {
  const searchParams = useSearchParams();
  const referralCode = searchParams.get('ref');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();

    // 1. Créer l'utilisateur (sans emailRedirectTo — la confirmation est gérée server-side)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: fullName.trim(),
          phone,
          role: 'client',
          referrer_code: referralCode || undefined,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (!data.user) {
      setError("Erreur lors de la création du compte. Cet email est peut-être déjà utilisé.");
      setLoading(false);
      return;
    }

    // 2. Côté serveur : auto-confirme l'email + code parrain + email de bienvenue via Resend
    const postRes = await fetch('/api/auth/post-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: data.user.id,
        email,
        name: fullName.trim(),
        referrerCode: referralCode || null,
      }),
    }).catch(() => null);

    const postData = postRes ? await postRes.json().catch(() => null) : null;

    if (postData?.confirmed) {
      // 3. Email confirmé côté serveur — on peut se connecter directement
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError("Compte créé mais connexion automatique échouée. Connecte-toi manuellement.");
        setLoading(false);
        return;
      }
      window.location.href = '/recherche';
    } else {
      // Fallback : post-signup a échoué, l'utilisateur doit peut-être confirmer son email manuellement
      window.location.href = '/connexion?message=compte-cree';
    }
  };

  const inputClass = "w-full rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {referralCode && (
        <div className="rounded-2xl bg-amber-500/8 border border-amber-500/20 px-4 py-3 flex items-start gap-3">
          <span className="text-base shrink-0">🎁</span>
          <p className="text-xs text-amber-300 leading-relaxed">
            Tu rejoins via un parrainage — vous recevrez tous les deux un bonus dès ton premier RDV honoré.
          </p>
        </div>
      )}
      <input
        type="text"
        placeholder="Nom et prénom"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        required
        className={inputClass}
      />
      <input
        type="tel"
        placeholder="Téléphone (rappels SMS)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className={inputClass}
      />
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className={inputClass}
      />
      <input
        type="password"
        placeholder="Mot de passe (6 caractères min.)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
        className={inputClass}
      />
      <input
        type="password"
        placeholder="Confirmer le mot de passe"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
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
        style={{
          background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
          color: loading ? '#94a3b8' : undefined,
        }}
      >
        {loading ? 'Création...' : "S'inscrire gratuitement"}
      </button>
    </form>
  );
}
