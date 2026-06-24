'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function GhostIcon() {
  return (
    <div className="flex items-center justify-center w-[72px] h-[72px] rounded-2xl"
      style={{ background: 'rgba(5,30,20,0.9)', boxShadow: '0 0 24px rgba(52,211,153,0.25), inset 0 0 0 1px rgba(52,211,153,0.15)' }}>
      <svg className="w-9 h-9 text-mint-400" viewBox="0 0 24 26" fill="currentColor">
        <path d="M12 1C6.48 1 2 5.48 2 11L2 22Q4.5 26 7 22Q9.5 26 12 22Q14.5 26 17 22Q19.5 26 22 22L22 11C22 5.48 17.52 1 12 1Z"/>
        <circle cx="8.5" cy="13" r="2" fill="rgb(5,20,35)"/>
        <circle cx="15.5" cy="13" r="2" fill="rgb(5,20,35)"/>
      </svg>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg className="w-11 h-11 text-mint-400" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-11 h-11 text-mint-400" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
  );
}

const SLIDES = [
  {
    icon: <GhostIcon />,
    title: 'Fini les clients fantômes',
    desc: "Réservez votre créneau en toute sérénité. Votre place est confirmée instantanément, pour vous comme pour votre professionnel.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ClockIcon />,
    title: 'Réservez en 30 secondes',
    desc: "Trouvez le bon pro près de chez vous, choisissez votre créneau et payez l'acompte instantanément.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ShieldIcon />,
    title: 'Votre Statut Sérénité',
    desc: "Honorez vos rendez-vous, grimpez les paliers (Standard à Gold) et débloquez vos Jokers d'annulation pour ne plus jamais perdre vos frais en cas d'imprévu.",
    btn: 'Découvrir mon statut',
    showPasser: false,
  },
];

export default function HomePage() {
  const [slide, setSlide] = useState(0);
  const router = useRouter();

  const handleNext = () => {
    if (slide < 2) setSlide(slide + 1);
    else setSlide(3);
  };

  // Choice screen
  if (slide === 3) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="flex items-center gap-3 mb-10">
          <Image src="/logo.jpg" alt="Book'nPay" width={52} height={52} className="rounded-full" priority />
          <span className="text-2xl font-bold text-white">Book'nPay</span>
        </div>

        <p className="text-slate-400 text-sm mb-6">Vous êtes...</p>

        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => router.push('/recherche')}
            className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-white/10 p-5 text-left hover:bg-navy-800 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-slate-700/60 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-slate-300" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white text-base">Particulier</p>
              <p className="text-xs text-slate-400 mt-0.5">Réserver des prestations</p>
            </div>
          </button>

          <button
            onClick={() => router.push('/pro')}
            className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-mint-500/40 p-5 text-left hover:bg-navy-800 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-mint-500/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-8-2h4v2h-4V5zM4 20V9h16l.01 11H4z"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white text-base">Professionnel</p>
              <p className="text-xs text-slate-400 mt-0.5">Gérer mon établissement &amp; réservations</p>
            </div>
          </button>
        </div>

        <p className="mt-10 text-xs text-slate-600 text-center px-4">
          En utilisant Book'nPay, vous acceptez nos{' '}
          <Link href="/cgu" className="text-slate-500 hover:underline">
            Conditions Générales d'Utilisation
          </Link>
        </p>
      </div>
    );
  }

  const current = SLIDES[slide];

  return (
    <div className="flex flex-col min-h-screen px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Image src="/logo.jpg" alt="Book'nPay" width={52} height={52} className="rounded-full" priority />
        <span className="text-xl font-bold text-white">Book'nPay</span>
      </div>

      {/* Slide content */}
      <div className="flex flex-col items-center text-center flex-1 justify-center gap-5 max-w-xs mx-auto w-full">
        {current.icon}

        <h1 className="text-2xl font-bold text-white leading-tight">{current.title}</h1>
        <p className="text-slate-400 text-sm leading-relaxed">{current.desc}</p>

        {/* Dot indicators */}
        <div className="flex gap-2 mt-1">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === slide ? 'w-6 bg-mint-500' : 'w-1.5 bg-white/20'}`}
            />
          ))}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="pt-8 max-w-xs mx-auto w-full space-y-3">
        <button
          onClick={handleNext}
          className="w-full rounded-xl bg-mint-500 py-4 font-semibold text-navy-950 text-base flex items-center justify-center gap-2"
        >
          {current.btn} <span className="text-lg">›</span>
        </button>

        {current.showPasser && (
          <button onClick={() => setSlide(3)} className="w-full text-sm text-slate-400 py-2 hover:text-slate-200 transition-colors">
            Passer →
          </button>
        )}

        {/* Social proof */}
        <div className="flex items-center justify-center gap-3 py-2">
          <div className="flex -space-x-2">
            {['🧑', '👩', '👨'].map((emoji, i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-navy-800 border-2 border-navy-950 flex items-center justify-center text-sm">
                {emoji}
              </div>
            ))}
          </div>
          <span className="text-xs text-slate-400">Déjà adopté par de nombreux professionnels ⭐</span>
        </div>

        <p className="text-xs text-slate-600 text-center pb-2">
          En utilisant Book'nPay, vous acceptez nos{' '}
          <Link href="/cgu" className="text-slate-500 hover:underline">
            Conditions Générales d'Utilisation
          </Link>
        </p>
      </div>
    </div>
  );
}
