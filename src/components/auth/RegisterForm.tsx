'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get('ref');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [acceptedCgu, setAcceptedCgu] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (!acceptedCgu) {
      setError('Vous devez accepter les CGU/CGV pour créer un compte.');
      return;
    }
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        name: fullName.trim(),
        phone,
        referralCode: referralCode || null,
        cguAccepted: acceptedCgu,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 409) {
        setError(data.error || 'Ce compte existe déjà. Connectez-vous ou utilisez un autre email.');
        setLoading(false);
        setTimeout(() => router.push(`/connexion?email=${encodeURIComponent(email)}`), 1800);
        return;
      }
      setError(data.error || "Une erreur est survenue. Réessaie.");
      setLoading(false);
      return;
    }

    setEmailSent(true);
    setLoading(false);
  };

  const inputClass = "w-full rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200";

  if (emailSent) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="w-14 h-14 rounded-full bg-mint-500/15 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Vérifie ta boîte mail</p>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            On a envoyé un lien de confirmation à <span className="text-mint-400">{email}</span>.<br />
            Clique dessus pour activer ton compte et te connecter.
          </p>
        </div>
        <p className="text-slate-600 text-xs">Tu ne vois rien ? Vérifie tes spams.</p>
      </div>
    );
  }

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
      <label className="flex items-start gap-2.5 text-xs text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={acceptedCgu}
          onChange={(e) => setAcceptedCgu(e.target.checked)}
          required
          className="mt-0.5 accent-mint-500"
        />
        <span>
          J&apos;accepte les{' '}
          <Link
            href="/cgu"
            target="_blank"
            rel="noopener noreferrer"
            className="text-mint-400 underline underline-offset-2 hover:text-mint-300"
          >
            conditions générales d&apos;utilisation
          </Link>
        </span>
      </label>

      {error && (
        <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={loading || !acceptedCgu}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: loading || !acceptedCgu ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading || !acceptedCgu ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
          color: loading || !acceptedCgu ? '#94a3b8' : undefined,
        }}
      >
        {loading ? 'Création...' : "S'inscrire gratuitement"}
      </button>
    </form>
  );
}
