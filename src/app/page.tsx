'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* ── Icônes slides ── */
function GhostIcon() {
  return (
    <div
      className="flex items-center justify-center w-24 h-24 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.16) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 60px rgba(52,211,153,0.35), 0 0 120px rgba(52,211,153,0.12), inset 0 0 0 1px rgba(52,211,153,0.22)',
      }}
    >
      <svg className="w-12 h-12" viewBox="0 0 24 26" fill="rgba(52,211,153,0.9)">
        <path d="M12 1C6.48 1 2 5.48 2 11L2 22Q4.5 26 7 22Q9.5 26 12 22Q14.5 26 17 22Q19.5 26 22 22L22 11C22 5.48 17.52 1 12 1Z"/>
        <circle cx="8.5" cy="13" r="2" fill="rgb(10,18,36)"/>
        <circle cx="15.5" cy="13" r="2" fill="rgb(10,18,36)"/>
      </svg>
    </div>
  );
}
function ClockIcon() {
  return (
    <div
      className="flex items-center justify-center w-24 h-24 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.16) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 60px rgba(52,211,153,0.35), 0 0 120px rgba(52,211,153,0.12), inset 0 0 0 1px rgba(52,211,153,0.22)',
      }}
    >
      <svg className="w-11 h-11" viewBox="0 0 24 24" fill="none"
        stroke="rgba(52,211,153,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
  );
}
function ShieldIcon() {
  return (
    <div
      className="flex items-center justify-center w-24 h-24 rounded-3xl"
      style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.16) 0%, rgba(52,211,153,0.05) 100%)',
        boxShadow: '0 0 60px rgba(52,211,153,0.35), 0 0 120px rgba(52,211,153,0.12), inset 0 0 0 1px rgba(52,211,153,0.22)',
      }}
    >
      <svg className="w-11 h-11" viewBox="0 0 24 24" fill="none"
        stroke="rgba(52,211,153,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <polyline points="9 12 11 14 15 10"/>
      </svg>
    </div>
  );
}

const SLIDES = [
  {
    icon: <GhostIcon />,
    title: 'Fini les clients\nfantômes',
    desc: "Réservez votre créneau en toute sérénité. Votre place est confirmée instantanément, pour vous comme pour votre professionnel.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ClockIcon />,
    title: 'Réservez en\n30 secondes',
    desc: "Trouvez le bon professionnel près de chez vous, choisissez votre créneau et payez l'acompte instantanément.",
    btn: 'Suivant',
    showPasser: true,
  },
  {
    icon: <ShieldIcon />,
    title: 'Votre Statut\nSérénité',
    desc: "Honorez vos rendez-vous, grimpez les paliers Standard → Gold et débloquez des Jokers d'annulation sans frais.",
    btn: 'Commencer',
    showPasser: false,
  },
];

/* ── Logo centré inline (au-dessus du contenu) ── */
function InlineLogo() {
  return (
    <div className="flex flex-col items-center gap-2.5 mb-2">
      <Image
        src="/logo.jpg"
        alt="Book'nPay"
        width={80}
        height={80}
        className="rounded-2xl ring-2 ring-mint-500/20 shadow-[0_0_32px_rgba(52,211,153,0.25)]"
        priority
      />
      <span className="text-lg font-bold text-white tracking-tight">Book'nPay</span>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="absolute top-4 left-4 flex items-center gap-1.5 rounded-full bg-white/[0.07] border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200"
    >
      ← Retour
    </button>
  );
}

function CGULine() {
  return (
    <p className="text-[11px] text-slate-600 text-center leading-relaxed px-4">
      En utilisant Book'nPay, vous acceptez nos{' '}
      <Link href="/cgu" className="text-slate-400 underline underline-offset-2">
        Conditions Générales d'Utilisation
      </Link>
    </p>
  );
}

/* ── Bandeau utilisateur déjà connecté ──
   Remplace l'ancien redirect forcé au montage (cassait le bouton retour, cf. 02/07/2026) :
   la home reste affichée et navigable, ce bandeau propose juste un raccourci. */
function ConnectedBanner({ href }: { href: string }) {
  return (
    <div className="w-full bg-navy-900/90 backdrop-blur border-b border-emerald-500/15 px-4 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm text-center">
      <span className="text-slate-300">Vous êtes déjà connecté</span>
      <Link
        href={href}
        className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap"
      >
        Accéder à mon espace →
      </Link>
    </div>
  );
}

export default function HomePage() {
  // null = vérification de session en cours (évite un flash onboarding pour les utilisateurs connectés)
  const [slide, setSlide] = useState<number | null>(null);
  // Destination du bandeau si connecté (null = déconnecté, ou statut pas encore résolu)
  const [connectedSpace, setConnectedSpace] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      // Source de vérité : session Supabase (couvre nouvel appareil sans localStorage)
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const { data: appUser } = await supabase
          .from('app_users')
          .select('role')
          .eq('id', data.session.user.id)
          .single();
        const role = appUser?.role;
        setConnectedSpace(role === 'admin' ? '/admin' : role === 'pro' ? '/pro' : '/recherche');
      }
      // Fallback rapide : localStorage pour les visiteurs qui ont déjà vu l'onboarding.
      // La home reste affichée et navigable même pour un utilisateur connecté (voir ConnectedBanner) —
      // ne plus rediriger de force au montage, ça cassait le bouton retour (02/07/2026).
      setSlide(localStorage.getItem('bnp_onboarding_done') ? 3 : 0);
    };
    init();
  }, []);

  const handleNext = () => {
    if (slide === null) return;
    if (slide < 2) setSlide(slide + 1);
    else {
      localStorage.setItem('bnp_onboarding_done', '1');
      setSlide(3);
    }
  };

  if (slide === null) return <div className="min-h-dvh" />;

  /* ── Écran auth Particulier ── */
  if (slide === 4) {
    return (
      <div className="flex flex-col min-h-dvh">
        {connectedSpace && <ConnectedBanner href={connectedSpace} />}
        <div className="relative flex flex-col items-center justify-center flex-1 px-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />
          <BackButton onBack={() => setSlide(3)} />
          <InlineLogo />
          <div className="w-full max-w-sm space-y-3 mt-4">
            <button
              onClick={() => router.push('/inscription')}
              className="w-full rounded-2xl py-4 font-semibold text-[#0a1224] text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 24px rgba(52,211,153,0.4)' }}
            >
              Créer un compte
            </button>
            <button
              onClick={() => router.push('/connexion?redirect=/recherche')}
              className="w-full rounded-2xl border border-white/10 py-4 font-semibold text-white text-sm hover:bg-white/5 hover:border-white/20 transition-all duration-200"
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
          <div className="mt-8"><CGULine /></div>
        </div>
      </div>
    );
  }

  /* ── Écran auth Professionnel ── */
  if (slide === 5) {
    return (
      <div className="flex flex-col min-h-dvh">
        {connectedSpace && <ConnectedBanner href={connectedSpace} />}
        <div className="relative flex flex-col items-center justify-center flex-1 px-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />
          <BackButton onBack={() => setSlide(3)} />
          <InlineLogo />
          <div className="w-full max-w-sm space-y-3 mt-4">
            <button
              onClick={() => router.push('/devenir-partenaire')}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-4 font-semibold text-white text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
              style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.35)' }}
            >
              Inscrire mon établissement
            </button>
            <button
              onClick={() => router.push('/connexion?redirect=/pro')}
              className="w-full rounded-2xl border border-white/10 py-4 font-semibold text-white text-sm hover:bg-white/5 hover:border-white/20 transition-all duration-200"
            >
              Mon espace professionnel
            </button>
            <button
              onClick={() => router.push('/tarifs')}
              className="w-full py-3 text-sm text-emerald-400/80 hover:text-emerald-400 transition-colors"
            >
              Voir les tarifs &amp; rentabilité →
            </button>
          </div>
          <div className="mt-8"><CGULine /></div>
        </div>
      </div>
    );
  }

  /* ── Écran choix Particulier / Professionnel ── */
  if (slide === 3) {
    return (
      <div className="flex flex-col min-h-dvh">
        {connectedSpace && <ConnectedBanner href={connectedSpace} />}
        <div className="relative flex flex-col items-center justify-center flex-1 px-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.06)_0%,transparent_70%)] pointer-events-none" />
          <BackButton onBack={() => setSlide(2)} />
          <InlineLogo />
          <p className="text-slate-500 text-xs mb-5 mt-6 tracking-widest uppercase font-semibold">Vous êtes…</p>
          <div className="w-full max-w-sm space-y-3">
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
              className="w-full flex items-center gap-4 rounded-2xl bg-navy-900 border border-emerald-500/20 p-5 text-left hover:bg-navy-800/80 hover:border-emerald-500/35 transition-all duration-200 group"
              style={{ boxShadow: '0 0 20px rgba(52,211,153,0.05)' }}
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/15 transition-colors">
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 7h-4V5c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-8-2h4v2h-4V5zM4 20V9h16l.01 11H4z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm">Professionnel</p>
                <p className="text-xs text-slate-500 mt-0.5">Gérer mon établissement</p>
              </div>
              <svg className="w-4 h-4 text-emerald-600 group-hover:text-emerald-400 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
          <div className="mt-10"><CGULine /></div>
        </div>
      </div>
    );
  }

  /* ── Slides onboarding ── */
  const current = SLIDES[slide];

  return (
    <>
      {connectedSpace && <ConnectedBanner href={connectedSpace} />}
      <div className="relative flex flex-col min-h-dvh overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(52,211,153,0.07)_0%,transparent_65%)] pointer-events-none" />

        {/* Bouton retour (slides 1 et 2) */}
        {slide > 0 && <BackButton onBack={() => setSlide(slide - 1)} />}

        {/* Contenu central */}
        <div key={slide} className="animate-slide-in flex flex-col items-center text-center flex-1 justify-center gap-7 max-w-sm mx-auto w-full px-4 relative z-10">
          <InlineLogo />
          {current.icon}

          <div className="space-y-3">
            <h1 className="text-[1.9rem] font-bold text-white leading-tight whitespace-pre-line">
              {current.title}
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-[270px] mx-auto">
              {current.desc}
            </p>
          </div>

          {/* Dots pagination */}
          <div className="flex gap-2">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === slide
                    ? 'w-8 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                    : 'w-1.5 bg-white/15'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Bas de page */}
        <div className="px-4 pb-8 max-w-sm mx-auto w-full space-y-3 relative z-10">
          <button
            onClick={handleNext}
            className="w-full rounded-2xl py-4 font-bold text-[#0a1224] text-base flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: 'linear-gradient(135deg, #34d399, #6ee7b7)',
              boxShadow: '0 4px 28px rgba(52,211,153,0.45)',
            }}
          >
            {current.btn} <span className="text-lg">›</span>
          </button>

          <button
            onClick={() => { localStorage.setItem('bnp_onboarding_done', '1'); setSlide(3); }}
            className={`w-full text-sm py-2 transition-colors ${
              current.showPasser
                ? 'text-slate-500 hover:text-slate-300'
                : 'invisible'
            }`}
          >
            Passer →
          </button>

          <CGULine />
        </div>
      </div>
    </>
  );
}
