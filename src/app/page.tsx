'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function GhostIcon() {
  return (
    <div
      className="flex items-center justify-center w-20 h-20 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.15) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 40px rgba(52,211,153,0.2), inset 0 0 0 1px rgba(52,211,153,0.2)',
      }}
    >
      <svg className="w-10 h-10 text-mint-400" viewBox="0 0 24 26" fill="currentColor">
        <path d="M12 1C6.48 1 2 5.48 2 11L2 22Q4.5 26 7 22Q9.5 26 12 22Q14.5 26 17 22Q19.5 26 22 22L22 11C22 5.48 17.52 1 12 1Z"/>
        <circle cx="8.5" cy="13" r="2" fill="rgb(15,23,42)"/>
        <circle cx="15.5" cy="13" r="2" fill="rgb(15,23,42)"/>
      </svg>
    </div>
  );
}

function ClockIcon() {
  return (
    <div
      className="flex items-center justify-center w-20 h-20 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.15) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 40px rgba(52,211,153,0.2), inset 0 0 0 1px rgba(52,211,153,0.2)',
      }}
    >
      <svg className="w-10 h-10 text-mint-400" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
  );
}

function ShieldIcon() {
  return (
    <div
      className="flex items-center justify-center w-20 h-20 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.15) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 40px rgba(52,211,153,0.2), inset 0 0 0 1px rgba(52,211,153,0.2)',
      }}
    >
      <svg className="w-10 h-10 text-mint-400" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <polyline points="9 12 11 14 15 10"/>
      </svg>
    </div>
  );
}

const SLIDES = [
  {
    icon: <GhostIcon />,
    tag: 'ZÉRO CLIENT FANTÔME',
    title: 'Fini les clients\nfantômes',
    desc: "Votre place est confirmée instantanément, pour vous comme pour votre professionnel. L'acompte sécurise chaque réservation.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ClockIcon />,
    tag: 'RAPIDITÉ',
    title: 'Réservez en\n30 secondes',
    desc: "Trouvez le bon professionnel près de chez vous, choisissez votre créneau et payez l'acompte instantanément.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ShieldIcon />,
    tag: 'PROGRAMME FIDÉLITÉ',
    title: 'Votre Statut\nSérénité',
    desc: "Honorez vos rendez-vous, grimpez les paliers Standard → Gold et débloquez des Jokers d'annulation sans frais.",
    btn: 'Commencer',
    showPasser: false,
  },
];

function LogoCentered() {
  return (
    <div className="flex flex-col items-center gap-3 mb-10">
      <div className="relative">
        <Image src="/logo.jpg" alt="Book'nPay" width={72} height={72} className="rounded-2xl ring-2 ring-mint-500/20 shadow-[0_0_32px_rgba(52,211,153,0.2)]" priority />
      </div>
      <span className="text-2xl font-bold tracking-tight" style={{ background: 'linear-gradient(135deg, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Book'nPay
      </span>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="absolute top-5 left-4 flex items-center gap-1.5 rounded-full bg-white/[0.07] border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200"
    >
      ← Changer de profil
    </button>
  );
}

function CGU() {
  return (
    <p className="mt-8 text-xs text-slate-700 text-center px-4">
      En continuant, vous acceptez nos{' '}
      <Link href="/cgu" className="text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline transition-colors">
        CGU
      </Link>
    </p>
  );
}

export default function HomePage() {
  const [slide, setSlide] = useState(0);
  const router = useRouter();

  const handleNext = () => {
    if (slide < 2) setSlide(slide + 1);
    else setSlide(3);
  };

  // ─── Écran auth Particulier ─────────────────────────────────────────────────
  if (slide === 4) {
    return (
      <div className="relative flex flex-col items-center justify-center min-h-screen px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />
        <BackButton onBack={() => setSlide(3)} />
        <LogoCentered />
        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => router.push('/inscription')}
            className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 24px rgba(52,211,153,0.4)' }}
          >
            Créer un compte
          </button>
          <button
            onClick={() => router.push('/connexion?redirect=/recherche')}
            className="w-full rounded-2xl border border-white/12 py-4 font-semibold text-white text-sm hover:bg-white/5 hover:border-white/20 transition-all duration-200"
          >
            Se connecter
          </button>
          <button
            onClick={() => router.push('/recherche')}
            className="w-full py-3 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Continuer sans compte →
          </button>
        </div>
        <CGU />
      </div>
    );
  }

  // ─── Écran auth Professionnel ───────────────────────────────────────────────
  if (slide === 5) {
    return (
      <div className="relative flex flex-col items-center justify-center min-h-screen px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />
        <BackButton onBack={() => setSlide(3)} />
        <LogoCentered />
        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => router.push('/devenir-partenaire')}
            className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-4 font-semibold text-white text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
            style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.35)' }}
          >
            Inscrire mon établissement
          </button>
          <button
            onClick={() => router.push('/connexion?redirect=/pro')}
            className="w-full rounded-2xl border border-white/12 py-4 font-semibold text-white text-sm hover:bg-white/5 hover:border-white/20 transition-all duration-200"
          >
            Mon espace professionnel
          </button>
          <button
            onClick={() => router.push('/tarifs')}
            className="w-full py-3 text-sm text-mint-400/80 hover:text-mint-400 transition-colors"
          >
            Voir les tarifs &amp; rentabilité →
          </button>
        </div>
        <CGU />
      </div>
    );
  }

  // ─── Écran choix Particulier / Professionnel ────────────────────────────────
  if (slide === 3) {
    return (
      <div className="relative flex flex-col items-center justify-center min-h-screen px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />

        <div className="flex items-center gap-3 mb-12">
          <Image src="/logo.jpg" alt="Book'nPay" width={44} height={44} className="rounded-xl ring-1 ring-mint-500/20" priority />
          <span className="text-xl font-bold tracking-tight text-white">Book'nPay</span>
        </div>

        <p className="text-slate-500 text-sm mb-6 tracking-wide uppercase text-xs font-semibold">Vous êtes...</p>

        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => setSlide(4)}
            className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-white/[0.08] p-5 text-left hover:bg-navy-800/80 hover:border-white/15 transition-all duration-200 group"
          >
            <div className="w-11 h-11 rounded-xl bg-slate-700/50 border border-white/[0.06] flex items-center justify-center shrink-0 group-hover:bg-slate-700/70 transition-colors">
              <svg className="w-5 h-5 text-slate-300" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">Particulier</p>
              <p className="text-xs text-slate-500 mt-0.5">Réserver des prestations</p>
            </div>
            <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <button
            onClick={() => setSlide(5)}
            className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-mint-500/20 p-5 text-left hover:bg-navy-800/80 hover:border-mint-500/35 transition-all duration-200 group"
            style={{ boxShadow: '0 0 20px rgba(52,211,153,0.05)' }}
          >
            <div className="w-11 h-11 rounded-xl bg-mint-500/10 border border-mint-500/20 flex items-center justify-center shrink-0 group-hover:bg-mint-500/15 transition-colors">
              <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-8-2h4v2h-4V5zM4 20V9h16l.01 11H4z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">Professionnel</p>
              <p className="text-xs text-slate-500 mt-0.5">Gérer mon établissement</p>
            </div>
            <svg className="w-4 h-4 text-mint-600 group-hover:text-mint-400 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <p className="mt-12 text-[11px] text-slate-700 text-center px-4">
          En continuant, vous acceptez nos{' '}
          <Link href="/cgu" className="text-slate-500 hover:underline">CGU</Link>
        </p>
      </div>
    );
  }

  // ─── Slides onboarding ──────────────────────────────────────────────────────
  const current = SLIDES[slide];

  return (
    <div className="relative flex flex-col min-h-screen px-6 py-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(52,211,153,0.07)_0%,transparent_65%)] pointer-events-none" />

      <div className="flex items-center gap-3 relative z-10">
        <Image src="/logo.jpg" alt="Book'nPay" width={38} height={38} className="rounded-xl ring-1 ring-mint-500/20" priority />
        <span className="text-base font-bold tracking-tight text-white">Book'nPay</span>
      </div>

      <div className="flex flex-col items-center text-center flex-1 justify-center gap-6 max-w-xs mx-auto w-full relative z-10">
        {current.icon}

        <div className="space-y-1">
          <p className="text-[10px] font-bold tracking-[0.2em] text-mint-500/70 uppercase">{current.tag}</p>
          <h1 className="text-[1.75rem] font-bold text-white leading-tight whitespace-pre-line">{current.title}</h1>
        </div>

        <p className="text-slate-400 text-sm leading-relaxed max-w-[260px]">{current.desc}</p>

        <div className="flex gap-2 mt-1">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === slide ? 'w-8 bg-mint-500 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'w-1.5 bg-white/15'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="pt-6 max-w-xs mx-auto w-full space-y-3 relative z-10">
        <button
          onClick={handleNext}
          className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
            boxShadow: '0 4px 28px rgba(52,211,153,0.4)',
          }}
        >
          {current.btn} <span className="text-base">›</span>
        </button>

        {current.showPasser && (
          <button onClick={() => setSlide(3)} className="w-full text-xs text-slate-500 py-2 hover:text-slate-300 transition-colors">
            Passer →
          </button>
        )}

        <div className="flex items-center justify-center gap-3 py-2">
          <div className="flex -space-x-2">
            {['🧑', '👩', '👨'].map((emoji, i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-navy-800 border-2 border-navy-950 flex items-center justify-center text-sm shadow-sm">
                {emoji}
              </div>
            ))}
          </div>
          <span className="text-[11px] text-slate-500">Adopté par de nombreux pros ⭐</span>
        </div>

        <p className="text-[11px] text-slate-700 text-center pb-2">
          En continuant, vous acceptez nos{' '}
          <Link href="/cgu" className="text-slate-500 hover:underline">CGU</Link>
        </p>
      </div>
    </div>
  );
}
