'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const CATEGORIES = [
  { value: 'beaute', label: 'Beauté', sub: 'Coiffure, esthétique, barber, onglerie…' },
  { value: 'bien-etre', label: 'Bien-être', sub: 'Massage, yoga, ostéo, méditation…' },
  { value: 'sport', label: 'Sport & fitness', sub: 'Coaching, gym, natation, arts martiaux…' },
  { value: 'autre', label: 'Autre', sub: 'Photographie, tatouage, vétérinaire, alimentation…' },
] as const;

const BOOKINGS_ESTIMATES = [
  { value: '0-80', label: 'Moins de 80 / mois', hint: 'Plan Starter — 79 € HT' },
  { value: '81-300', label: '81 à 300 / mois', hint: 'Plan Business — 139 € HT' },
  { value: '300+', label: 'Plus de 300 / mois', hint: 'Plan Scale — 299 € HT' },
] as const;

export default function PartnerApplicationForm() {
  const [form, setForm] = useState({
    etablissement: '',
    gerant: '',
    email: '',
    phone: '',
    googleMapsUrl: '',
    instagram: '',
    website: '',
  });
  const [category, setCategory] = useState<'beaute' | 'bien-etre' | 'sport' | 'autre' | ''>('');
  const [categoryLabel, setCategoryLabel] = useState('');
  const [bizType, setBizType] = useState('');
  const [bookingsEstimate, setBookingsEstimate] = useState<'0-80' | '81-300' | '300+' | ''>('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) { setError('Sélectionnez votre catégorie d\'activité.'); return; }
    if (category === 'autre' && !categoryLabel.trim()) {
      setError('Décrivez votre secteur d\'activité.');
      return;
    }
    if (!bookingsEstimate) { setError('Sélectionnez votre volume estimé de réservations.'); return; }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from('partner_applications').insert({
      etablissement: form.etablissement,
      gerant: form.gerant,
      email: form.email,
      phone: form.phone || null,
      google_maps_url: form.googleMapsUrl || null,
      instagram: form.instagram || null,
      website: form.website || null,
      category,
      category_label: category === 'autre' ? (categoryLabel.trim() || null) : null,
      type: bizType.trim() || null,
      monthly_bookings_estimate: bookingsEstimate,
    });
    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }
    setSubmitted(true);
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="rounded-2xl bg-navy-900 border border-mint-500/25 p-8 text-center"
        style={{ boxShadow: '0 0 32px rgba(52,211,153,0.08)' }}>
        <div className="w-16 h-16 rounded-2xl bg-mint-500/15 border border-mint-500/25 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Demande envoyée !</h3>
        <p className="text-sm text-slate-400">Notre équipe vous recontacte sous 48h pour configurer votre compte.</p>
      </div>
    );
  }

  const inputClass = "w-full rounded-xl bg-navy-900 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-1">ÉTAPE 1 / 3</p>
        <div className="h-1 rounded-full bg-navy-900 overflow-hidden">
          <div className="h-full w-1/3 rounded-full" style={{ background: 'linear-gradient(90deg, #34d399, #6ee7b7)' }} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Identité</h2>

        <div>
          <input
            placeholder="Nom de l'établissement *"
            value={form.etablissement}
            onChange={(e) => setForm({ ...form, etablissement: e.target.value })}
            required
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] text-slate-600 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/>
            </svg>
            Autocomplétion Google disponible
          </p>
        </div>

        <input placeholder="Nom du gérant *" value={form.gerant} onChange={(e) => setForm({ ...form, gerant: e.target.value })} required className={inputClass} />
        <input type="email" placeholder="Email professionnel *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} />
        <input type="tel" placeholder="Téléphone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required className={inputClass} />
      </section>

      {/* Catégorie — obligatoire */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Votre activité <span className="text-red-400">*</span>
        </h2>
        <div className="space-y-2">
          {CATEGORIES.map(({ value, label, sub }) => (
            <label
              key={value}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-all ${
                category === value
                  ? 'border-mint-500/50 bg-mint-500/10'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/15'
              }`}
            >
              <input
                type="radio"
                name="category"
                value={value}
                checked={category === value}
                onChange={() => setCategory(value)}
                className="mt-0.5 accent-mint-500"
              />
              <div>
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Champs supplémentaires pour la catégorie "Autre" */}
        {category === 'autre' && (
          <div className="space-y-2 pt-1">
            <input
              placeholder="Votre secteur d'activité * (ex : Photographie, Tatouage…)"
              value={categoryLabel}
              onChange={(e) => setCategoryLabel(e.target.value)}
              className={inputClass}
            />
            <input
              placeholder="Type d'établissement (ex : Studio, Indépendant…)"
              value={bizType}
              onChange={(e) => setBizType(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
      </section>

      {/* Volume estimé — obligatoire */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Volume de réservations estimé <span className="text-red-400">*</span>
        </h2>
        <div className="space-y-2">
          {BOOKINGS_ESTIMATES.map(({ value, label, hint }) => (
            <label
              key={value}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 cursor-pointer transition-all ${
                bookingsEstimate === value
                  ? 'border-mint-500/50 bg-mint-500/10'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/15'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="bookings_estimate"
                  value={value}
                  checked={bookingsEstimate === value}
                  onChange={() => setBookingsEstimate(value)}
                  className="accent-mint-500"
                />
                <span className="text-sm text-white">{label}</span>
              </div>
              <span className="text-[11px] text-slate-500">{hint}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Présence en ligne</h2>

        <div>
          <input
            placeholder="Lien Google Maps"
            value={form.googleMapsUrl}
            onChange={(e) => setForm({ ...form, googleMapsUrl: e.target.value })}
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] text-slate-600">Affiche automatiquement votre note et avis Google.</p>
        </div>

        <div className="flex items-center rounded-xl bg-navy-900 border border-white/[0.08] focus-within:border-mint-500/40 focus-within:ring-2 focus-within:ring-mint-500/15 transition-all duration-200">
          <span className="pl-4 text-xs text-slate-500 select-none whitespace-nowrap">instagram.com/</span>
          <input
            placeholder="votre_compte"
            value={form.instagram}
            onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            className="flex-1 bg-transparent px-2 py-3 text-sm text-white outline-none"
          />
        </div>

        <input placeholder="Site web" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className={inputClass} />
      </section>

      {error && (
        <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl py-4 font-semibold text-navy-950 text-sm transition-all duration-200 disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: loading ? '#334155' : 'linear-gradient(135deg, #34d399, #6ee7b7)',
          boxShadow: loading ? 'none' : '0 4px 24px rgba(52,211,153,0.4)',
          color: loading ? '#94a3b8' : undefined,
        }}
      >
        {loading ? 'Envoi...' : 'Continuer →'}
      </button>

      <p className="text-center text-[11px] text-slate-700">
        Progression automatiquement sauvegardée — reprenez à tout moment.
      </p>
    </form>
  );
}
