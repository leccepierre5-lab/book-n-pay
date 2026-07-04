'use client';
// src/components/pro/FicheClientIntelligente.tsx
// Port de src/components/pro/FicheClientIntelligente.jsx — aide à la
// décision pour le pro face à un no-show : rembourser ou retenir les frais,
// basé sur l'historique de fiabilité du client CHEZ CE business.
import { useEffect, useState } from 'react';

const STATUT_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  Standard: { icon: '⚪', color: '#64748b', bg: '#f1f5f9' },
  Bronze: { icon: '🥉', color: '#b45309', bg: '#fef3c7' },
  Argent: { icon: '🥈', color: '#6b7280', bg: '#f3f4f6' },
  Gold: { icon: '🏆', color: '#d97706', bg: '#fef9c3' },
};

interface Member {
  id: string;
  name: string;
  phone: string | null;
  deposit: number | null;
}

export default function FicheClientIntelligente({
  member,
  onRembourser,
  onGarder,
}: {
  member: Member | null;
  onRembourser: () => Promise<void>;
  onGarder: () => void;
}) {
  const [stats, setStats] = useState({ total: 0, noShow: 0, score: 100 });
  const [appUser, setAppUser] = useState<{
    statut: string;
    jokers_disponibles: number;
    rdv_honores: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinct de `loading` (chargement des stats) — protège spécifiquement
  // contre un double-clic sur "Rembourser" déclenchant deux remboursements
  // Stripe.
  const [refunding, setRefunding] = useState(false);

  const handleRembourserClick = async () => {
    setRefunding(true);
    try {
      await onRembourser();
    } finally {
      setRefunding(false);
    }
  };

  useEffect(() => {
    if (!member?.phone) return;
    setLoading(true);
    fetch(`/api/pro/client-stats?phone=${encodeURIComponent(member.phone)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.stats) setStats(data.stats);
        if (data.appUser) setAppUser(data.appUser);
      })
      .finally(() => setLoading(false));
  }, [member?.phone]);

  if (!member) return null;

  const conseil =
    stats.score >= 90
      ? 'Client très fiable : un remboursement est recommandé pour fidélisation.'
      : stats.score >= 70
      ? 'Profil mixte : à votre discrétion selon le contexte.'
      : 'Attention : plusieurs no-shows détectés. Retenir les frais de réservation est conseillé.';

  const scoreColor = stats.score >= 90 ? '#16a34a' : stats.score >= 70 ? '#d97706' : '#dc2626';
  const scoreBg = stats.score >= 90 ? '#dcfce7' : stats.score >= 70 ? '#fef9c3' : '#fee2e2';

  const statut = appUser?.statut || 'Standard';
  const sc = STATUT_CONFIG[statut] || STATUT_CONFIG.Standard;
  const jokers = appUser?.jokers_disponibles ?? 1;
  const maxJokers = appUser ? ((appUser.rdv_honores ?? 0) >= 51 ? 3 : (appUser.rdv_honores ?? 0) >= 31 ? 2 : 1) : 1;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-navy-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-white">Fiche client intelligente</p>
        <div className="flex items-center gap-2">
          {appUser && (
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: sc.bg, color: sc.color }}
            >
              {sc.icon} {statut}
            </span>
          )}
          <span
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{ background: scoreBg, color: scoreColor }}
          >
            {loading ? '...' : `${stats.score}%`}
          </span>
        </div>
      </div>

      {appUser && (
        <div className="flex items-center justify-between rounded-xl bg-navy-800 px-3 py-2">
          <div>
            <p className="text-[10px] text-white/40">Jokers disponibles</p>
            <div className="mt-0.5 flex gap-1">
              {Array.from({ length: maxJokers }).map((_, i) => (
                <span key={i} className={`text-base ${i < jokers ? 'opacity-100' : 'opacity-20'}`}>
                  🃏
                </span>
              ))}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-white/40">RDV honorés</p>
            <p className="text-base font-bold text-white">{appUser.rdv_honores || 0}</p>
          </div>
        </div>
      )}

      <div className="flex gap-3 text-center">
        <div className="flex-1 rounded-lg bg-navy-800 py-2">
          <p className="text-lg font-bold text-white">{stats.total}</p>
          <p className="text-[10px] text-white/40">RDV total</p>
        </div>
        <div className="flex-1 rounded-lg bg-red-950/40 py-2">
          <p className="text-lg font-bold text-red-400">{stats.noShow}</p>
          <p className="text-[10px] text-white/40">No-show(s)</p>
        </div>
        <div className="flex-1 rounded-lg bg-emerald-950/40 py-2">
          <p className="text-lg font-bold text-emerald-400">{stats.total - stats.noShow}</p>
          <p className="text-[10px] text-white/40">Honorés</p>
        </div>
      </div>

      <div className="rounded-lg p-3 text-xs italic leading-relaxed text-white/70" style={{ background: scoreBg + '20' }}>
        💡 {conseil}
      </div>

      {member.deposit && member.deposit > 0 && (
        <div className="flex gap-2">
          <button
            onClick={handleRembourserClick}
            disabled={refunding}
            className="flex-1 rounded-lg bg-blue-500 py-2.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {refunding ? 'Remboursement...' : 'Rembourser (geste)'}
          </button>
          <button
            onClick={onGarder}
            disabled={refunding}
            className="flex-1 rounded-lg bg-red-500 py-2.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            Frais retenus
          </button>
        </div>
      )}
    </div>
  );
}
