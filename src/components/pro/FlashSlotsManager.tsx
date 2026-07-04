'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { FlashSlot } from '@/lib/database.types';

interface Service {
  id: string;
  name: string;
  deposit: number;
  price: number;
}

export default function FlashSlotsManager({
  bizId,
  services,
  initialSlots,
}: {
  bizId: string;
  services: Service[];
  initialSlots: FlashSlot[];
}) {
  const [slots, setSlots] = useState(initialSlots);
  const [form, setForm] = useState({ service_id: '', date: '', time: '', flash_deposit: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const selectedService = services.find((s) => s.id === form.service_id);

  const handleCreate = async () => {
    if (!form.date || !form.time) { setMsg('Date et heure requis'); return; }
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/flash-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: form.service_id || null,
        service_name: selectedService?.name || null,
        date: form.date,
        time: form.time,
        original_deposit: selectedService?.deposit ?? null,
        flash_deposit: form.flash_deposit ? parseFloat(form.flash_deposit) : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || 'Erreur');
    } else {
      setSlots((prev) => [...prev, data]);
      setForm({ service_id: '', date: '', time: '', flash_deposit: '' });
      setMsg('Créneau flash publié !');
    }
    setSaving(false);
  };

  const handleDeactivate = async (id: string) => {
    setActingId(id);
    await fetch(`/api/flash-slots/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setActingId(null);
  };

  const handleDelete = async (id: string) => {
    setActingId(id);
    await fetch(`/api/flash-slots/${id}`, { method: 'DELETE' });
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setActingId(null);
  };

  return (
    <div className="min-h-dvh p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/pro" className="text-slate-400 hover:text-slate-200 text-sm">← Tableau de bord</Link>
          <h1 className="text-xl font-bold text-white">⚡ Flash Slots</h1>
        </div>

        <p className="text-sm text-slate-400">
          Publiez des créneaux de dernière minute avec une offre flash. Ils apparaissent sur la page de recherche.
        </p>

        <div className="bg-navy-900 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-slate-100">Nouveau créneau flash</h2>

          {services.length > 0 && (
            <select
              value={form.service_id}
              onChange={(e) => setForm((f) => ({ ...f, service_id: e.target.value }))}
              className="w-full rounded-lg bg-navy-800 px-3 py-2 text-sm text-slate-100 outline-none"
            >
              <option value="">— Prestation (optionnel) —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.deposit}€ dépôt habituel)
                </option>
              ))}
            </select>
          )}

          <div className="flex gap-2">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="flex-1 rounded-lg bg-navy-800 px-3 py-2 text-sm text-slate-100 outline-none"
            />
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              className="flex-1 rounded-lg bg-navy-800 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Dépôt flash (€) — laisser vide = dépôt habituel
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.flash_deposit}
              onChange={(e) => setForm((f) => ({ ...f, flash_deposit: e.target.value }))}
              placeholder={selectedService ? `${selectedService.deposit}€ habituel` : '0'}
              className="w-full rounded-lg bg-navy-800 px-3 py-2 text-sm text-slate-100 outline-none"
            />
          </div>

          {msg && <p className="text-sm text-mint-400">{msg}</p>}

          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full rounded-lg bg-mint-500 py-2 text-sm font-semibold text-navy-950 disabled:opacity-50"
          >
            {saving ? 'Publication...' : '⚡ Publier le créneau flash'}
          </button>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold text-slate-100">Créneaux actifs ({slots.length})</h2>
          {slots.length === 0 && (
            <p className="text-sm text-slate-500 py-4 text-center">Aucun créneau flash actif.</p>
          )}
          {slots.map((slot) => (
            <div key={slot.id} className="bg-navy-900 rounded-xl p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-100">
                  {slot.date} à {slot.time.slice(0, 5)}
                </p>
                {slot.service_name && (
                  <p className="text-xs text-slate-400">{slot.service_name}</p>
                )}
                {slot.flash_deposit != null && (
                  <p className="text-xs text-mint-400">
                    ⚡ {slot.flash_deposit}€
                    {slot.original_deposit != null && slot.original_deposit !== slot.flash_deposit && (
                      <span className="line-through text-slate-500 ml-1">{slot.original_deposit}€</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleDeactivate(slot.id)}
                  disabled={actingId === slot.id}
                  className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {actingId === slot.id ? '...' : 'Désactiver'}
                </button>
                <button
                  onClick={() => handleDelete(slot.id)}
                  disabled={actingId === slot.id}
                  className="rounded-lg bg-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {actingId === slot.id ? '...' : 'Supprimer'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
