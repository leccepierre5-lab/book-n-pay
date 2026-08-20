'use client';
// src/components/pro/FicheClientIntelligente.tsx
// Port de src/components/pro/FicheClientIntelligente.jsx — aide à la
// décision pour le pro face à un no-show : rembourser ou retenir les frais,
// basé sur l'historique de fiabilité du client CHEZ CE business.
import { useEffect, useState } from 'react';
import { JOKERS_LIMITES } from '@/lib/booking-utils';

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
}: {
  member: Member | null;
  onRembourser: () => Promise<void>;
}) {
  // score: null tant qu'aucun historique n'a été chargé OU confirmé vide —
  // jamais une valeur numérique par défaut (voir le bug du 20/08 : `: 100`
  // faisait passer "aucune donnée" pour "dossier parfait").
  const [stats, setStats] = useState<{ total: number; noShow: number; score: number | null }>({
    total: 0,
    noShow: 0,
    score: null,
  });
  const [appUser, setAppUser] = useState<{
    statut: string;
    jokers_disponibles: number;
    jokers_utilises: number;
    rdv_honores: number;
  } | null>(null);
  // true dès le montage (pas false) : évite qu'un premier rendu, avant même
  // que l'effet ne parte, affiche brièvement l'état par défaut comme si
  // c'était la donnée réelle — c'est ce flash-là qui faisait dire "très
  // fiable, remboursement recommandé" sur n'importe quel client le temps
  // que le fetch réponde (trouvé le 20/08, voir booking-utils.ts pour le
  // contexte du geste commercial).
  const [loading, setLoading] = useState(true);
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
    if (!member?.phone) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/pro/client-stats?phone=${encodeURIComponent(member.phone)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.stats) setStats(data.stats);
        if (data.appUser) setAppUser(data.appUser);
      })
      // Échec réseau : rester sur score=null (neutre), jamais retomber sur
      // un score par défaut qui laisserait croire à un historique connu.
      .catch(() => setStats({ total: 0, noShow: 0, score: null }))
      .finally(() => setLoading(false));
  }, [member?.phone]);

  if (!member) return null;

  const hasHistory = stats.score !== null;
  // Un seul no-show n'a pas la même portée qu'un client récidiviste — trouvé
  // le 20/08 : le message générique "plusieurs no-shows détectés" s'affichait
  // même pour un premier incident isolé (score<70 dès 1 no-show sur 1 RDV),
  // ce qui décrédibilise l'aide à la décision aux yeux du pro.
  const conseil = !hasHistory
    ? 'Premier rendez-vous, aucun historique.'
    : stats.score! >= 90
    ? 'Client très fiable : un remboursement est recommandé pour fidélisation.'
    : stats.score! >= 70
    ? 'Profil mixte : à votre discrétion selon le contexte.'
    : stats.noShow === 1
    ? "Un no-show détecté. Un imprévu isolé n'a pas la même portée qu'un client récidiviste — à votre appréciation."
    : 'Attention : plusieurs no-shows détectés. Retenir les frais de réservation est conseillé.';

  const scoreColor = !hasHistory ? '#94a3b8' : stats.score! >= 90 ? '#16a34a' : stats.score! >= 70 ? '#d97706' : '#dc2626';
  const scoreBg = !hasHistory ? '#f1f5f9' : stats.score! >= 90 ? '#dcfce7' : stats.score! >= 70 ? '#fef9c3' : '#fee2e2';

  const statut = appUser?.statut || 'Standard';
  const sc = STATUT_CONFIG[statut] || STATUT_CONFIG.Standard;
  const jokers = appUser?.jokers_disponibles ?? 1;
  const jokersUtilises = appUser?.jokers_utilises ?? 0;
  const maxJokers = JOKERS_LIMITES[statut] ?? 1;

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
            {loading ? '...' : hasHistory ? `${stats.score}%` : '—'}
          </span>
        </div>
      </div>

      {/* Trouvé le 20/08 : "Historique indisponible" s'affichait à côté des
          compteurs de fiabilité (RDV total/no-show/honorés) alors que
          CEUX-LÀ sont remplis — appUser (profil fidélité) et stats (historique
          de réservation) sont deux données indépendantes, un client peut avoir
          l'une sans l'autre. Le badge ne parle donc que du profil fidélité,
          déplacé ici à la place du bloc jokers/RDV honorés qu'il remplace
          plutôt que dans l'en-tête à côté du score. */}
      {!loading && (
        appUser ? (
          <div className="flex items-center justify-between rounded-xl bg-navy-800 px-3 py-2">
            <div>
              <p className="text-[10px] text-white/40">Jokers ({jokersUtilises}/{maxJokers} utilisés)</p>
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
        ) : (
          <div className="rounded-xl bg-navy-800 px-3 py-2 text-center text-[11px] text-white/40">
            Pas encore inscrit — aucun profil de fidélité chez vous
          </div>
        )
      )}

      {/* Compteurs ET conseil gatés sur loading, comme le pill de score l'est
          déjà — trouvé le 20/08 : sans ce garde-fou, n'importe quel client
          affiche "0/0/0" + "très fiable, remboursement recommandé" pendant
          le fetch, quel que soit son vrai historique. */}
      {loading ? (
        <div className="rounded-lg bg-navy-800 py-3 text-center text-xs text-white/40">
          Chargement de l&apos;historique…
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* Un seul bouton d'action, pas deux côte à côte — trouvé le 20/08 :
          "Frais retenus" ne persistait rien (fermait juste la modale, voir
          l'ancien handleKeepFees dans ProDashboard.tsx/ProCalendar.tsx) et sa
          présence à côté d'un bouton bleu suggérait un choix obligatoire
          entre deux actions, alors qu'il n'y a qu'une action possible : le
          geste commercial, facultatif. L'état par défaut (frais acquis) est
          dit explicitement plutôt que matérialisé par un bouton. */}
      {member.deposit && member.deposit > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">Les frais de réservation vous sont acquis.</p>
          <button
            onClick={handleRembourserClick}
            disabled={refunding}
            className="w-full rounded-lg border border-blue-500/40 py-2.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {refunding ? 'Remboursement...' : 'Rembourser en geste commercial'}
          </button>
        </div>
      )}
    </div>
  );
}
