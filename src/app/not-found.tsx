import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-4xl mb-4">🔍</p>
      <h1 className="text-lg font-semibold text-white mb-1.5">Page introuvable</h1>
      <p className="text-sm text-slate-400 max-w-xs mb-6">
        Ce lien n'existe pas ou plus — l'établissement ou la page que tu cherches a peut-être été retiré(e).
      </p>
      <Link
        href="/recherche"
        className="inline-flex items-center gap-1.5 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-[0_0_16px_rgba(52,211,153,0.3)] hover:shadow-[0_0_20px_rgba(52,211,153,0.45)] transition-all duration-200"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Retour à la recherche
      </Link>
    </div>
  );
}
