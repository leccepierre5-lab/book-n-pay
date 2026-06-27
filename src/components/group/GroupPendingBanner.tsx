'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

interface PendingGroup {
  pending: true;
  groupRef: string;
  deadline: string;
  paidCount: number;
  totalCount: number;
  selfStatus: 'invite' | 'paid';
  payLink: string | null;
  bizName: string;
  serviceName: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatTimer(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${pad(min)}:${pad(sec)}`;
}

function getColor(ms: number) {
  if (ms > 10 * 60 * 1000) {
    return {
      bg: 'bg-emerald-500/10 border-emerald-500/20',
      text: 'text-emerald-300',
      dot: 'bg-emerald-400',
      btn: 'bg-emerald-500 hover:bg-emerald-400 text-navy-950',
    };
  }
  if (ms > 5 * 60 * 1000) {
    return {
      bg: 'bg-amber-500/10 border-amber-500/20',
      text: 'text-amber-300',
      dot: 'bg-amber-400',
      btn: 'bg-amber-500 hover:bg-amber-400 text-navy-950',
    };
  }
  return {
    bg: 'bg-red-500/10 border-red-500/20',
    text: 'text-red-300',
    dot: 'bg-red-400',
    btn: 'bg-red-500 hover:bg-red-400 text-white',
  };
}

export default function GroupPendingBanner() {
  const pathname = usePathname();
  const [group, setGroup] = useState<PendingGroup | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/group/pending-status');
      if (!res.ok) return;
      const data = await res.json();
      if (data.pending) {
        setGroup(data as PendingGroup);
      } else {
        setGroup(null);
      }
    } catch {
      // réseau — silencieux
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 30_000);
    return () => clearInterval(poll);
  }, [fetchStatus]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Masquer sur la page de paiement (redondant avec le timer déjà présent)
  if (pathname.startsWith('/pay/')) return null;
  if (!group) return null;

  const msLeft = new Date(group.deadline).getTime() - now;
  if (msLeft <= 0) {
    // Déclencher un refresh — le backend aura expiré le groupe
    setTimeout(fetchStatus, 1500);
    return null;
  }

  const c = getColor(msLeft);

  return (
    <div className={`sticky top-14 z-40 border-b ${c.bg} ${c.text} transition-colors duration-1000`}>
      <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Dot animé */}
        <span className={`flex-none w-2 h-2 rounded-full ${c.dot} animate-pulse`} />

        {/* Infos */}
        <span className="text-xs font-medium truncate min-w-0 flex-1">
          <span className="font-semibold">{group.bizName}</span>
          <span className="opacity-60"> · </span>
          {group.paidCount}/{group.totalCount} ont confirmé
          <span className="opacity-60"> · </span>
          <span className="font-mono font-bold">{formatTimer(msLeft)}</span>
        </span>

        {/* CTA */}
        {group.selfStatus === 'invite' && group.payLink ? (
          <Link
            href={group.payLink}
            className={`flex-none text-xs font-bold px-3 py-1.5 rounded-lg transition-colors duration-150 ${c.btn}`}
          >
            Finaliser ma place →
          </Link>
        ) : (
          <Link
            href="/mes-reservations"
            className="flex-none text-xs opacity-60 hover:opacity-100 transition-opacity"
          >
            Voir le groupe →
          </Link>
        )}
      </div>
    </div>
  );
}
