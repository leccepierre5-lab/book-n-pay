'use client';
import { useState } from 'react';

interface GuestLink {
  memberId: string;
  idx: number;
}

export default function ShareGuestLinks({ guestMemberIds }: { guestMemberIds: string[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const links: GuestLink[] = guestMemberIds.map((id, i) => ({ memberId: id, idx: i + 1 }));

  const handleCopy = async (memberId: string) => {
    const url = `${origin}/pay/${memberId}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(memberId);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleShare = (memberId: string, idx: number) => {
    const url = `${origin}/pay/${memberId}`;
    if (navigator.share) {
      navigator.share({
        title: "Book'nPay — Payez votre place",
        text: `Voici le lien pour payer votre créneau #${idx}`,
        url,
      }).catch(() => {});
    } else {
      handleCopy(memberId);
    }
  };

  if (links.length === 0) return null;

  return (
    <div className="rounded-2xl bg-navy-900 border border-blue-500/25 overflow-hidden mb-4">
      <div className="px-4 py-3 bg-blue-500/10 border-b border-blue-500/20">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <p className="text-sm font-semibold text-blue-300">
            Partagez les liens de paiement
          </p>
        </div>
        <p className="text-xs text-slate-400 mt-1 ml-6">
          Chaque invité reçoit son propre lien pour payer sa place ({links.length} invité{links.length > 1 ? 's' : ''}).
        </p>
      </div>
      <div className="px-4 py-3 space-y-2">
        {links.map(({ memberId, idx }) => (
          <div key={memberId} className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
            <p className="text-[11px] text-slate-500 mb-2">Créneau {idx}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleShare(memberId, idx)}
                className="flex-1 rounded-lg py-2 text-xs font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
              >
                Partager le lien
              </button>
              <button
                onClick={() => handleCopy(memberId)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  copiedId === memberId
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-white/15 text-white/60 hover:bg-white/10'
                }`}
              >
                {copiedId === memberId ? '✓' : 'Copier'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
