'use client';
import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'bnp_cookie_notice_dismissed';
const REOPEN_EVENT = 'bnp:cookie-notice:reopen';

// Aucun cookie de mesure d'audience/publicité dans le repo (vérifié : zéro
// script analytics/tracking) — seuls les cookies de session Supabase
// (auth, strictement nécessaires) sont posés. Bandeau informatif à
// acquittement unique, pas de choix accepter/refuser à proposer.
export function openCookieNotice() {
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(localStorage.getItem(STORAGE_KEY) !== 'true');

    const reopen = () => setVisible(true);
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, []);

  // Bandeau `fixed bottom-0` : sans réserver cet espace dans le flux normal
  // de la page, un CTA en bas de page (ex: "Continuer" du wizard onboarding)
  // peut se retrouver visuellement ET fonctionnellement sous ce bandeau, qui
  // intercepte alors le clic — confirmé en test réel (Playwright:
  // "intercepts pointer events"), plus fréquent sur mobile où le bandeau est
  // plus haut (texte + bouton empilés en colonne au lieu d'une ligne).
  // ResizeObserver plutôt qu'une valeur fixe : la hauteur réelle varie selon
  // la largeur d'écran et le retour à la ligne du texte.
  useEffect(() => {
    if (!visible) {
      document.body.style.paddingBottom = '';
      return;
    }
    const el = bannerRef.current;
    if (!el) return;
    const applyPadding = () => { document.body.style.paddingBottom = `${el.offsetHeight}px`; };
    applyPadding();
    const observer = new ResizeObserver(applyPadding);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = '';
    };
  }, [visible]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      ref={bannerRef}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-navy-950/95 backdrop-blur px-4 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-xs leading-relaxed text-slate-400">
          Book&apos;nPay utilise uniquement des cookies strictement nécessaires au fonctionnement du site (connexion, session) — aucun cookie de mesure d&apos;audience ni de publicité.
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-xl px-4 py-2 text-xs font-semibold text-navy-950 transition-all hover:scale-[1.01]"
          style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)' }}
        >
          J&apos;ai compris
        </button>
      </div>
    </div>
  );
}
