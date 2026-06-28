'use client';
import { useState } from 'react';
import type { Service } from '@/lib/database.types';

type GenreValue = '' | 'homme' | 'femme' | 'enfants' | 'garcon' | 'fille';

const GENRE_OPTIONS: { value: GenreValue; label: string; group?: string }[] = [
  { value: '', label: 'Tous genres (non filtré)' },
  { value: 'homme', label: 'Homme' },
  { value: 'femme', label: 'Femme' },
  { value: 'enfants', label: 'Enfants — Tous' },
  { value: 'garcon', label: 'Enfants — Garçon' },
  { value: 'fille', label: 'Enfants — Fille' },
];

const GENRE_BADGE: Record<string, string> = {
  homme: 'bg-blue-500/12 text-blue-300 border-blue-500/20',
  femme: 'bg-pink-500/12 text-pink-300 border-pink-500/20',
  enfants: 'bg-amber-500/12 text-amber-300 border-amber-500/20',
  garcon: 'bg-cyan-500/12 text-cyan-300 border-cyan-500/20',
  fille: 'bg-purple-500/12 text-purple-300 border-purple-500/20',
};

const GENRE_LABEL: Record<string, string> = {
  homme: 'Homme',
  femme: 'Femme',
  enfants: 'Enfants',
  garcon: 'Garçon',
  fille: 'Fille',
};

interface FormState {
  name: string;
  genre: GenreValue;
  duration_minutes: string;
  price: string;
  deposit: string;
  max_persons: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  genre: '',
  duration_minutes: '30',
  price: '',
  deposit: '0',
  max_persons: '',
};

function serviceToForm(s: Service): FormState {
  return {
    name: s.name,
    genre: (s.genre as GenreValue) || '',
    duration_minutes: String(s.duration_minutes),
    price: String(s.price),
    deposit: String(s.deposit),
    max_persons: s.max_persons != null ? String(s.max_persons) : '',
  };
}

export default function PrestationsManager({ initial }: { initial: Service[] }) {
  const [services, setServices] = useState<Service[]>(initial);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const inputClass =
    'w-full rounded-xl bg-navy-950 border border-white/[0.08] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-mint-500/40 focus:ring-1 focus:ring-mint-500/15 transition-all';

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (s: Service) => {
    setEditingId(s.id);
    setForm(serviceToForm(s));
    setError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name.trim(),
      genre: form.genre || null,
      duration_minutes: Number(form.duration_minutes),
      price: Number(form.price),
      deposit: Number(form.deposit || 0),
      max_persons: form.max_persons ? Number(form.max_persons) : null,
    };

    const res = await fetch('/api/pro/services', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Erreur');
      setLoading(false);
      return;
    }

    if (editingId) {
      setServices((prev) => prev.map((s) => (s.id === editingId ? data : s)));
    } else {
      setServices((prev) => [...prev, data]);
    }
    closeForm();
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette prestation ?')) return;
    setDeletingId(id);
    const res = await fetch('/api/pro/services', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setServices((prev) => prev.filter((s) => s.id !== id));
    }
    setDeletingId(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-bold text-mint-500/60 uppercase tracking-widest mb-0.5">Espace Pro</p>
          <h1 className="text-lg font-bold text-white">Mes prestations</h1>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-navy-950 transition-all hover:scale-[1.02]"
          style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 16px rgba(52,211,153,0.3)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Ajouter
        </button>
      </div>

      {/* Liste */}
      {services.length === 0 && !showForm && (
        <div className="py-12 text-center rounded-2xl bg-navy-900 border border-white/[0.06]">
          <p className="text-2xl mb-2">✂️</p>
          <p className="text-slate-400 text-sm">Aucune prestation pour l'instant.</p>
          <p className="text-slate-600 text-xs mt-1">Clique sur "Ajouter" pour commencer.</p>
        </div>
      )}

      <div className="space-y-2.5 mb-5">
        {services.map((s) => (
          <div
            key={s.id}
            className="rounded-2xl bg-navy-900 border border-white/[0.08] p-4 flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-white">{s.name}</p>
                {s.genre && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${GENRE_BADGE[s.genre] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>
                    {GENRE_LABEL[s.genre] ?? s.genre}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {s.duration_minutes} min
                </span>
                <span className="text-mint-400 font-medium">{s.price > 0 ? `${s.price}€` : 'Gratuit'}</span>
                {s.deposit > 0 && <span>acompte {s.deposit}€</span>}
                {s.max_persons && <span>max {s.max_persons} pers.</span>}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => openEdit(s)}
                className="rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/[0.10] transition-all"
              >
                Modifier
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                disabled={deletingId === s.id}
                className="rounded-xl bg-red-500/8 border border-red-500/15 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/15 transition-all disabled:opacity-40"
              >
                {deletingId === s.id ? '...' : 'Supprimer'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-2xl bg-navy-900 border border-mint-500/20 p-5">
          <p className="text-sm font-semibold text-white mb-4">
            {editingId ? 'Modifier la prestation' : 'Nouvelle prestation'}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Nom *</label>
              <input
                type="text"
                placeholder="Ex : Coupe homme, Soin visage..."
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Genre</label>
              <select
                value={form.genre}
                onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value as GenreValue }))}
                className={inputClass}
              >
                {GENRE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-600 mt-1">
                Permet aux clients de filtrer par genre dans l'onglet de réservation.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Durée (min) *</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  placeholder="30"
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Prix (€) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Acompte (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={form.deposit}
                  onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Max personnes</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Illimité"
                  value={form.max_persons}
                  onChange={(e) => setForm((f) => ({ ...f, max_persons: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-navy-950 transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 16px rgba(52,211,153,0.25)' }}
              >
                {loading ? '...' : editingId ? 'Enregistrer' : 'Ajouter la prestation'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
