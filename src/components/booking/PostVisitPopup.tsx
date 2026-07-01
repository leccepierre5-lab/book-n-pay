'use client';
import { useCallback, useEffect, useState } from 'react';

interface PostVisit {
  pending: true;
  bizName: string;
  serviceName: string;
  googlePlaceUrl: string | null;
  referralCode: string | null;
}

export default function PostVisitPopup() {
  const [data, setData] = useState<PostVisit | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/booking/post-visit-status');
      if (!res.ok) return;
      const json = await res.json();
      if (json.pending) setData(json as PostVisit);
    } catch {
      // réseau — silencieux
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 30_000);
    return () => clearInterval(poll);
  }, [fetchStatus]);

  if (!data) return null;

  const referralLink = data.referralCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/inscription?ref=${data.referralCode}`
    : null;

  const handleCopy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl bg-navy-900 border border-white/[0.08] p-6 animate-slide-in">
        <div className="text-center mb-5">
          <p className="text-lg font-bold text-white">Merci pour votre visite ! 🎉</p>
        </div>

        {referralLink && (
          <div className="rounded-xl border border-amber-600/30 bg-amber-950/30 p-4 mb-3">
            <p className="text-xs font-semibold text-amber-300 mb-1.5">🎁 Parrainez un ami</p>
            <p className="text-xs leading-relaxed text-white/70 mb-3">
              <strong className="text-amber-300">-20% pour vous</strong> sur votre prochaine réservation, et{' '}
              <strong className="text-amber-300">-10% pour la personne parrainée</strong> dès sa première visite.
            </p>
            <button
              onClick={handleCopy}
              className={`w-full rounded-xl py-2.5 text-xs font-semibold transition-colors ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
              }`}
            >
              {copied ? 'Copié !' : 'Copier mon lien de parrainage'}
            </button>
          </div>
        )}

        {data.googlePlaceUrl && (
          <div className="rounded-xl border border-white/[0.08] bg-navy-800/60 p-4 mb-5">
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Vous avez apprécié cette prestation ? Laissez un avis à{' '}
              <span className="text-white font-medium">{data.bizName}</span>
            </p>
            <a
              href={data.googlePlaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl py-2.5 text-center text-xs font-semibold text-navy-950 transition-all hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)' }}
            >
              Laisser un avis Google →
            </a>
          </div>
        )}

        <button
          onClick={() => setData(null)}
          className="w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
