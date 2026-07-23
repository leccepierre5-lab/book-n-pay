'use client';
// src/components/pro/AlertsPanel.tsx
// Port condensé de src/components/pro/AlertsPanel.jsx — calcule les alertes
// "RDV imminent" (< 15 min) et "no-show probable" (5-120 min de retard)
// directement depuis les bookings du jour déjà chargés par le dashboard.
// Le système localStorage pub/sub de l'original (pushProAlert) servait à
// des notifications poussées par d'autres écrans — non porté ici. Si besoin
// plus tard, on peut le remplacer par Supabase Realtime (déjà activé dans
// la migration 0005 sur bookings/booking_members).
import { useEffect, useState } from 'react';

interface BookingMemberRow {
  id: string;
  name: string;
  status: string;
}

interface BookingRow {
  id: string;
  date: string;
  time: string;
  service_name: string;
  booking_members: BookingMemberRow[];
}

interface Alert {
  id: string;
  type: 'warning' | 'danger';
  title: string;
  msg: string;
}

function computeAlerts(bookings: BookingRow[], today: string, prefs: Record<string, boolean> | null): Alert[] {
  // Défaut TRUE (opt-out) — même convention que resolveNotifiableOwnerEmail
  // (lib/pro-notifications.ts) et NotificationsConfig.tsx : un pro qui n'a
  // jamais ouvert ses réglages doit continuer à voir ces alertes.
  const rdvImminentEnabled = prefs?.rdvImminent !== false;
  const noShowAutoEnabled = prefs?.noShowAuto !== false;
  const now = new Date();
  const alerts: Alert[] = [];

  for (const b of bookings) {
    if (b.date !== today) continue;
    const [h, m] = b.time.split(':').map(Number);
    const slotTime = new Date(b.date + 'T00:00:00');
    slotTime.setHours(h, m, 0, 0);
    const minsUntil = (slotTime.getTime() - now.getTime()) / 60000;

    for (const member of b.booking_members || []) {
      if (rdvImminentEnabled && member.status === 'paid' && minsUntil > 0 && minsUntil <= 15) {
        alerts.push({
          id: `soon-${b.id}-${member.id}`,
          type: 'warning',
          title: 'RDV imminent',
          msg: `${member.name} — ${b.service_name} à ${b.time} (dans ${Math.ceil(minsUntil)} min)`,
        });
      }
      if (noShowAutoEnabled && member.status === 'paid' && minsUntil < -5 && minsUntil > -120) {
        alerts.push({
          id: `noshow-${b.id}-${member.id}`,
          type: 'danger',
          title: 'No-show probable',
          msg: `${member.name} — ${b.service_name} à ${b.time} (retard : ${Math.abs(Math.floor(minsUntil))} min)`,
        });
      }
    }
  }

  return alerts;
}

export default function AlertsPanel({
  bookings,
  notificationPrefs,
}: {
  bookings: BookingRow[];
  notificationPrefs?: Record<string, boolean> | null;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const update = () => setAlerts(computeAlerts(bookings, today, notificationPrefs ?? null));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [bookings, notificationPrefs]);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-5 space-y-2">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            alert.type === 'danger'
              ? 'border-red-600/30 bg-red-950/30 text-red-300'
              : 'border-amber-500/30 bg-amber-950/30 text-amber-300'
          }`}
        >
          <div>
            <p className="font-semibold">
              {alert.type === 'danger' ? '⚠️' : '🕐'} {alert.title}
            </p>
            <p className="mt-0.5 opacity-80">{alert.msg}</p>
          </div>
          <button
            onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
