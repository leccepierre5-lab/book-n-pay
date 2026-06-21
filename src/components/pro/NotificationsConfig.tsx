'use client';
// src/components/pro/NotificationsConfig.tsx
// Port de src/components/pro/NotificationsConfig.jsx — persisté dans
// business_settings.notification_prefs (jsonb) plutôt que localStorage,
// pour que les préférences suivent le pro sur tous ses appareils.
// ⚠️ Comme dans l'original : la plupart des toggles sont déclaratifs
// uniquement pour l'instant — les crons (send-rdv-reminders, etc.) ne lisent
// pas encore cette config pour décider d'envoyer ou non. Documenté en TODO
// dans le README plutôt que de prétendre que ces toggles changent déjà le
// comportement réel des crons.
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const DEFAULTS: Record<string, boolean> = {
  rdvImminent: true,
  noShowAuto: true,
  newBooking: true,
  cancelBooking: true,
  paymentReceived: true,
  groupPending: true,
  reminderH24: false,
  reminderH2: true,
};

const NOTIF_ITEMS = [
  {
    group: 'Alertes temps réel',
    items: [
      { key: 'rdvImminent', emoji: '🕐', label: 'RDV imminent', desc: 'Alerte 15 min avant le rendez-vous' },
      { key: 'noShowAuto', emoji: '⚠️', label: 'No-show probable', desc: 'Alerte si le client a 5 min de retard' },
    ],
  },
  {
    group: 'Nouvelles réservations',
    items: [
      { key: 'newBooking', emoji: '✅', label: 'Nouvelle réservation', desc: 'Quand un client confirme un RDV' },
      { key: 'cancelBooking', emoji: '❌', label: 'Annulation', desc: 'Quand un client annule' },
      { key: 'paymentReceived', emoji: '💳', label: 'Acompte reçu', desc: 'Quand un paiement est validé' },
      { key: 'groupPending', emoji: '👥', label: 'Groupe incomplet', desc: "Quand un membre du groupe n'a pas encore payé" },
    ],
  },
  {
    group: 'Rappels automatiques',
    items: [
      { key: 'reminderH24', emoji: '🔔', label: 'Rappel client J-1', desc: 'Envoyer un rappel aux clients 24h avant' },
      { key: 'reminderH2', emoji: '🕐', label: 'Rappel client H-2', desc: 'Envoyer un rappel aux clients 2h avant' },
    ],
  },
];

export default function NotificationsConfig({
  bizId,
  initialPrefs,
}: {
  bizId: string;
  initialPrefs: Record<string, boolean> | null;
}) {
  const [config, setConfig] = useState<Record<string, boolean>>({ ...DEFAULTS, ...(initialPrefs || {}) });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (key: string) => setConfig((c) => ({ ...c, [key]: !c[key] }));

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from('business_settings')
      .upsert({ biz_id: bizId, notification_prefs: config }, { onConflict: 'biz_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const activeCount = Object.values(config).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl bg-navy-950 p-4 text-white">
        <div>
          <h3 className="text-sm font-semibold">Notifications automatiques</h3>
          <p className="mt-0.5 text-[11px] text-white/50">
            {activeCount} alerte{activeCount > 1 ? 's' : ''} activée{activeCount > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/20">🔔</div>
      </div>

      {NOTIF_ITEMS.map((group) => (
        <div key={group.group} className="overflow-hidden rounded-2xl border border-white/10 bg-navy-900">
          <div className="border-b border-white/10 bg-navy-800 px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{group.group}</p>
          </div>
          <div className="divide-y divide-white/5">
            {group.items.map((item) => {
              const enabled = config[item.key];
              return (
                <div key={item.key} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)' }}
                  >
                    {item.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${enabled ? 'text-white' : 'text-white/40'}`}>
                      {item.label}
                    </p>
                    <p className="truncate text-[11px] text-white/40">{item.desc}</p>
                  </div>
                  <button
                    onClick={() => toggle(item.key)}
                    className="relative h-[22px] w-10 shrink-0 rounded-full transition-colors"
                    style={{ background: enabled ? '#059669' : '#334155' }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform"
                      style={{ transform: enabled ? 'translateX(18px)' : 'translateX(0)' }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-3">
        <p className="mb-1 text-[11px] font-semibold text-blue-400">ℹ️ Comment ça fonctionne</p>
        <p className="text-[11px] text-white/60">
          Les alertes temps réel apparaissent dans le panneau d'alertes de votre espace. Les rappels
          automatiques sont envoyés par email aux clients (SMS à venir).
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
          saved ? 'bg-emerald-600 text-white' : 'bg-navy-950 text-white hover:bg-navy-800'
        }`}
      >
        {saved ? '✓ Préférences sauvegardées !' : saving ? '...' : '💾 Sauvegarder les préférences'}
      </button>
    </div>
  );
}
