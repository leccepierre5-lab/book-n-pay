'use client';
import { useState } from 'react';

const JOURS = [
  { label: 'Dim', value: 0 },
  { label: 'Lun', value: 1 },
  { label: 'Mar', value: 2 },
  { label: 'Mer', value: 3 },
  { label: 'Jeu', value: 4 },
  { label: 'Ven', value: 5 },
  { label: 'Sam', value: 6 },
];

interface StaffMember {
  id: string;
  name: string;
  role: string | null;
  emoji: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  created_at: string;
}

interface Schedule {
  day_of_week: number;
  open_time: string;
  close_time: string;
}

type Panel = 'none' | 'add' | { type: 'edit'; staff: StaffMember } | { type: 'schedule'; staff: StaffMember };

export default function EquipeManager({
  bizId: _bizId,
  initialStaff,
}: {
  bizId: string;
  initialStaff: StaffMember[];
}) {
  const [staffList, setStaffList] = useState<StaffMember[]>(initialStaff);
  const [panel, setPanel] = useState<Panel>('none');
  const [error, setError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Formulaire ajout
  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState('');
  const [addEmoji, setAddEmoji] = useState('');
  const [adding, setAdding] = useState(false);

  // Formulaire édition
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [saving, setSaving] = useState(false);

  // Formulaire horaires
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesSaving, setSchedulesSaving] = useState(false);

  const openAdd = () => {
    setAddName(''); setAddRole(''); setAddEmoji('');
    setError('');
    setPanel('add');
  };

  const openEdit = (s: StaffMember) => {
    setEditName(s.name);
    setEditRole(s.role ?? '');
    setEditEmoji(s.emoji ?? '');
    setError('');
    setPanel({ type: 'edit', staff: s });
  };

  const openSchedule = async (s: StaffMember) => {
    setPanel({ type: 'schedule', staff: s });
    setSchedulesLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/pro/staff/${s.id}/schedule`);
      const data = await res.json();
      setSchedules(data.schedules ?? []);
    } catch { setError('Impossible de charger les horaires'); }
    finally { setSchedulesLoading(false); }
  };

  const handleAdd = async () => {
    if (!addName.trim()) { setError('Le nom est requis'); return; }
    setAdding(true); setError('');
    try {
      const res = await fetch('/api/pro/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), role: addRole.trim() || null, emoji: addEmoji.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setStaffList((prev) => [...prev, data.staff]);
      setPanel('none');
    } catch { setError('Erreur réseau'); }
    finally { setAdding(false); }
  };

  const handleEdit = async (staffId: string) => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/pro/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), role: editRole.trim() || null, emoji: editEmoji.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setStaffList((prev) => prev.map((s) => s.id === staffId ? { ...s, ...data.staff } : s));
      setPanel('none');
    } catch { setError('Erreur réseau'); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (staffId: string) => {
    if (!confirm('Désactiver ce praticien ? Il ne sera plus proposé aux clients, mais ses réservations passées restent accessibles.')) return;
    setError('');
    setTogglingId(staffId);
    try {
      const res = await fetch(`/api/pro/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deactivate: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setStaffList((prev) => prev.map((s) => s.id === staffId ? { ...s, ...data.staff } : s));
      setPanel('none');
    } catch { setError('Erreur réseau'); } finally { setTogglingId(null); }
  };

  const handleReactivate = async (staffId: string) => {
    setError('');
    setTogglingId(staffId);
    try {
      const res = await fetch(`/api/pro/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivate: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setStaffList((prev) => prev.map((s) => s.id === staffId ? { ...s, ...data.staff } : s));
    } catch { setError('Erreur réseau'); } finally { setTogglingId(null); }
  };

  const toggleScheduleDay = (day: number) => {
    setSchedules((prev) => {
      const exists = prev.find((s) => s.day_of_week === day);
      if (exists) return prev.filter((s) => s.day_of_week !== day);
      return [...prev, { day_of_week: day, open_time: '09:00', close_time: '18:00' }];
    });
  };

  // Cible une plage précise par son index dans schedules (pas par day_of_week
  // seul, qui n'identifie plus une plage unique depuis les horaires coupés).
  const updateScheduleTime = (index: number, field: 'open_time' | 'close_time', value: string) => {
    setSchedules((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  // Ajoute une 2e (ou 3e...) plage pour un jour déjà actif — ex. pause
  // déjeuner. Défaut volontairement distinct de la 1ère plage (09:00 par
  // défaut) pour ne pas créer un chevauchement immédiat que le pro devrait
  // corriger avant de pouvoir enregistrer quoi que ce soit.
  const addScheduleRange = (day: number) => {
    setSchedules((prev) => [...prev, { day_of_week: day, open_time: '14:00', close_time: '18:00' }]);
  };

  const removeScheduleRange = (index: number) => {
    setSchedules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveSchedules = async (staffId: string) => {
    setSchedulesSaving(true); setError('');
    for (const s of schedules) {
      if (s.open_time >= s.close_time) {
        setError(`Horaires invalides pour ${JOURS.find((j) => j.value === s.day_of_week)?.label}`);
        setSchedulesSaving(false);
        return;
      }
    }
    try {
      const res = await fetch(`/api/pro/staff/${staffId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur serveur'); return; }
      setPanel('none');
    } catch { setError('Erreur réseau'); }
    finally { setSchedulesSaving(false); }
  };

  const activeStaff = staffList.filter((s) => s.is_active);
  const inactiveStaff = staffList.filter((s) => !s.is_active);

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Gérez vos praticiens. Les clients pourront choisir un praticien précis ou "sans préférence" lors de la réservation.
      </p>

      {/* Liste praticiens actifs */}
      <div className="space-y-2">
        {activeStaff.length === 0 && panel !== 'add' && (
          <div className="rounded-2xl border border-dashed border-white/[0.10] px-5 py-8 text-center text-slate-500 text-sm">
            Aucun praticien — vous travaillez seul ou ajoutez-en un.
          </div>
        )}
        {activeStaff.map((s) => (
          <div key={s.id} className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-mint-500/15 flex items-center justify-center text-base flex-shrink-0">
              {s.emoji || '👤'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{s.name}</p>
              {s.role && <p className="text-xs text-slate-500 truncate">{s.role}</p>}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => openSchedule(s)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                title="Horaires"
              >
                🕐
              </button>
              <button
                onClick={() => openEdit(s)}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Modifier
              </button>
              <button
                onClick={() => handleDeactivate(s.id)}
                disabled={togglingId === s.id}
                className="px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {togglingId === s.id ? '...' : 'Désactiver'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bouton ajouter */}
      {panel === 'none' && (
        <button
          onClick={openAdd}
          className="w-full rounded-xl border border-dashed border-white/[0.12] py-2.5 text-sm text-slate-400 hover:text-white hover:border-white/20 transition-colors"
        >
          + Ajouter un praticien
        </button>
      )}

      {/* Panneau ajout */}
      {panel === 'add' && (
        <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Nouveau praticien</h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Prénom / Nom <span className="text-red-400">*</span></label>
            <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Ex : Julien" className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Rôle (optionnel)</label>
            <input type="text" value={addRole} onChange={(e) => setAddRole(e.target.value)} placeholder="Ex : Barbier" className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Emoji (optionnel)</label>
            <input type="text" value={addEmoji} onChange={(e) => setAddEmoji(e.target.value)} placeholder="✂️" maxLength={2} className="w-24 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setPanel('none'); setError(''); }} className="flex-1 rounded-xl border border-white/[0.08] py-2 text-sm text-slate-400 hover:text-white transition-colors">Annuler</button>
            <button onClick={handleAdd} disabled={adding} className="flex-1 rounded-xl bg-mint-500 py-2 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors">
              {adding ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </div>
      )}

      {/* Panneau édition */}
      {panel !== 'none' && panel !== 'add' && panel.type === 'edit' && (
        <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Modifier {panel.staff.name}</h3>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Prénom / Nom <span className="text-red-400">*</span></label>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Rôle</label>
            <input type="text" value={editRole} onChange={(e) => setEditRole(e.target.value)} className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Emoji</label>
            <input type="text" value={editEmoji} onChange={(e) => setEditEmoji(e.target.value)} maxLength={2} className="w-24 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setPanel('none'); setError(''); }} className="flex-1 rounded-xl border border-white/[0.08] py-2 text-sm text-slate-400 hover:text-white transition-colors">Annuler</button>
            <button onClick={() => handleEdit(panel.staff.id)} disabled={saving} className="flex-1 rounded-xl bg-mint-500 py-2 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors">
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Panneau horaires */}
      {panel !== 'none' && panel !== 'add' && panel.type === 'schedule' && (
        <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Horaires de {panel.staff.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Sélectionnez les jours travaillés et leurs horaires. Si vide, les horaires de l'établissement s'appliquent.</p>
          </div>
          {schedulesLoading ? (
            <p className="text-sm text-slate-500 text-center py-4">Chargement…</p>
          ) : (
            <div className="space-y-3">
              {/* Sélection des jours */}
              <div className="flex gap-2 flex-wrap">
                {JOURS.map(({ label, value }) => {
                  const active = schedules.some((s) => s.day_of_week === value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleScheduleDay(value)}
                      className={`w-11 h-11 rounded-xl text-xs font-semibold transition-all ${
                        active ? 'bg-mint-500 text-navy-950' : 'bg-white/[0.06] text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Horaires par jour — plusieurs plages possibles (ex. horaires coupés) */}
              {JOURS.filter(({ value }) => schedules.some((s) => s.day_of_week === value)).map(({ label, value }) => {
                // Trié par heure de début à l'affichage, indépendamment de
                // l'ordre de saisie (le pro peut ajouter 14h-18h avant 9h-12h).
                const dayRanges = schedules
                  .map((s, index) => ({ ...s, index }))
                  .filter((s) => s.day_of_week === value)
                  .sort((a, b) => a.open_time.localeCompare(b.open_time));
                return (
                  <div key={value} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{label}</span>
                      <button
                        type="button"
                        onClick={() => addScheduleRange(value)}
                        className="text-xs text-mint-400 hover:text-mint-300 transition-colors"
                      >
                        + Ajouter une plage
                      </button>
                    </div>
                    {dayRanges.map((r) => (
                      <div key={r.index} className="flex items-center gap-3">
                        <input type="time" value={r.open_time} onChange={(e) => updateScheduleTime(r.index, 'open_time', e.target.value)} className="flex-1 rounded-xl bg-white/[0.06] border border-white/[0.08] px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
                        <span className="text-slate-600 text-xs">→</span>
                        <input type="time" value={r.close_time} onChange={(e) => updateScheduleTime(r.index, 'close_time', e.target.value)} className="flex-1 rounded-xl bg-white/[0.06] border border-white/[0.08] px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-mint-500/40" />
                        <button
                          type="button"
                          onClick={() => removeScheduleRange(r.index)}
                          className="px-1.5 text-red-400 hover:text-red-300 text-xs transition-colors"
                          title="Supprimer cette plage"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setPanel('none'); setError(''); }} className="flex-1 rounded-xl border border-white/[0.08] py-2 text-sm text-slate-400 hover:text-white transition-colors">Annuler</button>
            <button onClick={() => handleSaveSchedules(panel.staff.id)} disabled={schedulesSaving || schedulesLoading} className="flex-1 rounded-xl bg-mint-500 py-2 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors">
              {schedulesSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Praticiens inactifs */}
      {inactiveStaff.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs text-slate-600 uppercase tracking-wide font-medium px-1">Inactifs</p>
          {inactiveStaff.map((s) => (
            <div key={s.id} className="rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3 flex items-center gap-3 opacity-50">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                {s.emoji || '👤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-400 truncate line-through">{s.name}</p>
                {s.role && <p className="text-xs text-slate-600 truncate">{s.role}</p>}
              </div>
              <button
                onClick={() => handleReactivate(s.id)}
                disabled={togglingId === s.id}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-mint-400 hover:bg-mint-500/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {togglingId === s.id ? '...' : 'Réactiver'}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && panel === 'none' && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
