import Link from 'next/link';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/[0.06] bg-navy-950">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:justify-between">
        <p>© {year} Book&apos;nPay</p>
        <nav className="flex items-center gap-4">
          <Link href="/cgu" className="hover:text-white transition-colors duration-200">
            CGU/CGV
          </Link>
          <Link href="/mentions-legales" className="hover:text-white transition-colors duration-200">
            Mentions légales
          </Link>
          {/* Emplacement réservé pour le futur lien "Gérer les cookies"
              (bandeau de consentement pas encore implémenté). */}
          <a
            href="mailto:contact@book-n-pay.com"
            className="hover:text-white transition-colors duration-200"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
