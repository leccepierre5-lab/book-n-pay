'use client';
// src/components/admin/AdminDashboard.tsx
// Port condensé de src/pages/AdminDashboard.jsx + ConfigPanel.jsx.
import { useState } from 'react';
import type { AppConfig, PartnerApplication } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/client';

interface BusinessRow {
  id: string;
  name: string;
  city: string;
  frozen: boolean;
  frozen_reason: string | null;
}

export default function AdminDashboard({
  configs,
  applications,
  businesses,
}: {
  configs: AppConfig[];
  applications: PartnerApplication[];
  businesses: BusinessRow[];
}) {
  const [tab, setTab] = useState<'config' | 'applications' | 'businesses'>('applications');
  const [localConfigs, setLocalConfigs] = useState(configs);
  const [localApplications, setLocalApplications] = useState(applications);
  const [localBusinesses, setLocalBusinesses] = useState(businesses);
  const [saving, setSaving] = useState<string | null>(null);
  const [freezing, setFreezing] = useState<string | null>(null);

  const updateConfig = async (key: string, value: string) => {
    setSaving(key);
    const supabase = createClient();
    await supabase.from('app_config').update({ value }).eq('key', key);
    setLocalConfigs((prev) => prev.map((c) => (c.key === key ? { ...c, value } : c)));
    setSaving(null);
  };

  const reviewApplication = async (id: string, status: 'approved' | 'rejected') => {
    const res = await fetch('/api/admin/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: id, status }),
    });
    if (res.ok) {
      setLocalApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    }
  };

  const toggleFreeze = async (bizId: string, currentlyFrozen: boolean) => {
    setFreezing(bizId);
    const reason = currentlyFrozen ? null : window.prompt('Raison du gel (optionnel) :') || 'Non précisée';
    const res = await fetch('/api/admin/freeze-business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bizId, action: currentlyFrozen ? 'unfreeze' : 'freeze', reason }),
    });
    if (res.ok) {
      setLocalBusinesses((prev) =>
        prev.map((b) =>
          b.id === bizId ? { ...b, frozen: !currentlyFrozen, frozen_reason: currentlyFrozen ? null : reason } : b
        )
      );
    }
    setFreezing(null);
  };

  const pendingApplications = localApplications.filter((a) => a.status === 'pending');

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold text-white">Administration</h1>

        <div className="mb-5 flex gap-2">
          <button
            onClick={() => setTab('applications')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === 'applications' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Candidatures ({pendingApplications.length})
          </button>
          <button
            onClick={() => setTab('config')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === 'config' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Configuration
          </button>
          <button
            onClick={() => setTab('businesses')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === 'businesses' ? 'bg-mint-500 text-navy-950' : 'bg-navy-900 text-white/70'
            }`}
          >
            Établissements
          </button>
        </div>

        {tab === 'config' && (
          <div className="space-y-3">
            {localConfigs.map((cfg) => (
              <div key={cfg.key} className="rounded-xl bg-navy-900 p-4">
                <label className="mb-1 block text-xs text-white/50">
                  {cfg.label || cfg.key}
                  {cfg.description && <span className="ml-1 text-white/30">— {cfg.description}</span>}
                </label>
                <input
                  defaultValue={cfg.value}
                  onBlur={(e) => e.target.value !== cfg.value && updateConfig(cfg.key, e.target.value)}
                  disabled={saving === cfg.key}
                  className="w-full rounded-lg bg-navy-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
                />
              </div>
            ))}
            {localConfigs.length === 0 && (
              <p className="text-sm text-white/40">
                Aucune config trouvée. Initialise les clés frais_gestion_palier_1 à 4 et
                mode_test_paiement dans la table app_config.
              </p>
            )}
          </div>
        )}

        {tab === 'applications' && (
          <div className="space-y-3">
            {localApplications.map((app) => (
              <div key={app.id} className="rounded-xl bg-navy-900 p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{app.etablissement}</p>
                    <p className="text-xs text-white/50">
                      {app.gerant} · {app.email}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      app.status === 'pending'
                        ? 'bg-amber-500/20 text-amber-300'
                        : app.status === 'approved'
                        ? 'bg-emerald-600/20 text-emerald-400'
                        : 'bg-red-600/20 text-red-400'
                    }`}
                  >
                    {app.status}
                  </span>
                </div>
                {app.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => reviewApplication(app.id, 'approved')}
                      className="rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-navy-950"
                    >
                      Approuver
                    </button>
                    <button
                      onClick={() => reviewApplication(app.id, 'rejected')}
                      className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-300"
                    >
                      Rejeter
                    </button>
                  </div>
                )}
              </div>
            ))}
            {localApplications.length === 0 && (
              <p className="text-sm text-white/40">Aucune candidature pour l'instant.</p>
            )}
          </div>
        )}

        {tab === 'businesses' && (
          <div className="space-y-3">
            {localBusinesses.map((biz) => (
              <div key={biz.id} className="rounded-xl bg-navy-900 p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{biz.name}</p>
                    <p className="text-xs text-white/50">{biz.city}</p>
                    {biz.frozen && biz.frozen_reason && (
                      <p className="mt-1 text-xs text-red-400">Raison : {biz.frozen_reason}</p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      biz.frozen ? 'bg-red-600/20 text-red-400' : 'bg-emerald-600/20 text-emerald-400'
                    }`}
                  >
                    {biz.frozen ? '❄️ Gelé' : '✓ Actif'}
                  </span>
                </div>
                <button
                  onClick={() => toggleFreeze(biz.id, biz.frozen)}
                  disabled={freezing === biz.id}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    biz.frozen ? 'bg-emerald-500 text-navy-950' : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {freezing === biz.id ? '...' : biz.frozen ? 'Dégeler' : 'Geler le compte'}
                </button>
              </div>
            ))}
            {localBusinesses.length === 0 && (
              <p className="text-sm text-white/40">Aucun établissement.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
