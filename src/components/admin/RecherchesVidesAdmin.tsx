'use client';
// src/components/admin/RecherchesVidesAdmin.tsx
// Migration 0054 (Bloc B, 14/08) — agrégat métier/ville pour le
// démarchage, invitations avec preuve article 14 (informed_at), et emails
// de notification avec suppression manuelle (pas de purge automatique —
// dette de rétention notée dans l'encart ci-dessous).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { SearchMiss } from '@/lib/database.types';

function aggregate(misses: SearchMiss[]) {
  const map = new Map<string, { category: string; city: string; count: number }>();
  for (const m of misses) {
    const category = m.category || '—';
    const city = m.city || '—';
    const key = `${category}|${city}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { category, city, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export default function RecherchesVidesAdmin({ misses }: { misses: SearchMiss[] }) {
  const [local, setLocal] = useState(misses);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const aggregated = useMemo(() => aggregate(local), [local]);
  const invitations = useMemo(
    () => local.filter((m) => m.action === 'invite').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [local]
  );
  const notifications = useMemo(
    () => local.filter((m) => m.action === 'notify').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [local]
  );

  const toggleInformed = async (id: string, next: boolean) => {
    setBusyId(id);
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    const res = await fetch(`/api/admin/search-misses/${id}/informed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ informed: next }),
    });
    if (res.ok) {
      const { informed_at } = await res.json();
      setLocal((prev) => prev.map((m) => (m.id === id ? { ...m, informed_at } : m)));
    } else {
      const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      setErrorById((prev) => ({ ...prev, [id]: d.error ?? 'Erreur serveur' }));
    }
    setBusyId(null);
  };

  const deleteNotify = async (id: string) => {
    if (!window.confirm('Supprimer cet email de notification ?')) return;
    setBusyId(id);
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    const res = await fetch(`/api/admin/search-misses/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setLocal((prev) => prev.filter((m) => m.id !== id));
    } else {
      const d = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      setErrorById((prev) => ({ ...prev, [id]: d.error ?? 'Erreur serveur' }));
    }
    setBusyId(null);
  };

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/admin" className="text-white/60 hover:text-white">
            ←
          </Link>
          <h1 className="text-lg font-semibold text-white">Recherches sans résultat</h1>
        </div>

        <p className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Dette RGPD connue (14/08) : les emails de notification ci-dessous n&apos;ont pas de purge
          automatique — un email conservé indéfiniment &quot;en attendant qu&apos;un pro
          ouvre&quot; devient difficile à justifier. Suppression manuelle possible en attendant une
          vraie politique de rétention.
        </p>

        <section className="mb-8">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
            Demande par métier / ville ({local.length} recherche{local.length > 1 ? 's' : ''} au total)
          </h2>
          {aggregated.length === 0 ? (
            <p className="text-sm text-white/40">Aucune donnée.</p>
          ) : (
            <div className="space-y-1.5">
              {aggregated.map((row) => (
                <div
                  key={`${row.category}|${row.city}`}
                  className="flex items-center justify-between rounded-lg bg-navy-900 px-3 py-2 text-sm"
                >
                  <span className="text-white/80">
                    {row.category} · {row.city}
                  </span>
                  <span className="font-mono text-xs text-white/50">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
            Invitations ({invitations.length})
          </h2>
          {invitations.length === 0 ? (
            <p className="text-sm text-white/40">Aucune invitation.</p>
          ) : (
            <div className="space-y-3">
              {invitations.map((m) => (
                <div key={m.id} className="rounded-xl bg-navy-900 p-4">
                  <p className="text-sm font-semibold text-white">{m.invited_business_name}</p>
                  <p className="text-xs text-white/50">{m.invited_business_contact}</p>
                  <p className="mt-1 text-[11px] text-white/30">
                    {m.category || '—'} · {m.city || '—'} · {new Date(m.created_at).toLocaleString('fr-FR')}
                  </p>
                  {errorById[m.id] && <p className="mt-2 text-xs text-rose-400">{errorById[m.id]}</p>}
                  <label className="mt-3 flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!m.informed_at}
                      disabled={busyId === m.id}
                      onChange={(e) => toggleInformed(m.id, e.target.checked)}
                      className="accent-mint-500"
                    />
                    {m.informed_at
                      ? `Informé le ${new Date(m.informed_at).toLocaleDateString('fr-FR')} (article 14)`
                      : 'Informé de la source au premier contact (article 14)'}
                  </label>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
            Emails de notification ({notifications.length})
          </h2>
          {notifications.length === 0 ? (
            <p className="text-sm text-white/40">Aucun email en attente.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-navy-900 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white/80">{m.user_email}</p>
                    <p className="text-[11px] text-white/30">
                      {m.category || '—'} · {m.city || '—'} · {new Date(m.created_at).toLocaleString('fr-FR')}
                    </p>
                    {errorById[m.id] && <p className="mt-1 text-xs text-rose-400">{errorById[m.id]}</p>}
                  </div>
                  <button
                    onClick={() => deleteNotify(m.id)}
                    disabled={busyId === m.id}
                    className="shrink-0 rounded-lg border border-rose-500/30 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
