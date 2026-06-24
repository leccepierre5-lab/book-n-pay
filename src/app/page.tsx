'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const SLIDES = [
  {
    icon: '👻',
    title: 'Fini les clients fantômes',
    desc: "Réservez votre créneau en toute sérénité. Votre place est confirmée instantanément, pour vous comme pour votre professionnel.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: '⏱️',
    title: 'Réservez en 30 secondes',
    desc: "Trouvez le bon pro près de chez vous, choisissez votre créneau et payez l'acompte instantanément.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: '🛡️',
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
            <div className="w-10 h-10 rounded-full bg-slate-700/60 flex items-center justify-center text-xl shrink-0">👤</div>
            <div>
              <p className="font-semibold text-white text-base">Particulier</p>
              <p className="text-xs text-slate-400 mt-0.5">Réserver des prestations</p>
            </div>
          </button>

          <button
            onClick={() => router.push('/pro')}
            className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-mint-500/40 p-5 text-left hover:bg-navy-800 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-mint-500/10 flex items-center justify-center text-xl shrink-0">💼</div>
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
        <div className="flex items-center justify-center w-24 h-24 rounded-3xl bg-mint-500/10 text-5xl shadow-xl shadow-mint-500/10">
          {current.icon}
        </div>

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
