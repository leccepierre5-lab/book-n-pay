'use client';
// src/components/ui/Modal.tsx
// Composant partagé — avant lui, chaque modale (LoyaltyModal, PostVisitPopup,
// les modales dashboard pro, QRScanner) codait son propre overlay `fixed
// inset-0` sans role="dialog", sans piège de focus, sans fermeture Échap :
// la même lacune d'accessibilité recopiée N fois. Toute nouvelle modale doit
// passer par ce composant plutôt que reproduire un overlay à la main.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

export default function Modal({
  onClose,
  children,
  overlayClassName,
  panelClassName,
  ariaLabel,
  ariaLabelledBy,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: ReactNode;
  /** Classes de l'overlay plein écran (positionnement + fond) — une par appelant, design inchangé. */
  overlayClassName: string;
  /** Classes du panneau de contenu (le "card" visible) — une par appelant, design inchangé. */
  panelClassName: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Certaines modales ne se fermaient pas au clic sur le fond avant ce composant — comportement préservé par défaut à true, passer false pour garder l'ancien comportement d'une modale qui ne le faisait pas. */
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    if (!node) return;

    const focusables = getFocusable(node);
    (focusables[0] ?? node).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable(node);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={overlayClassName} onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}
