'use client';
// src/components/partner/PartnerApplicationForm.tsx
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      <div className="rounded-xl bg-navy-900 p-6 text-center">
        <p className="text-mint-400">✓ Demande envoyée !</p>
        <p className="mt-2 text-sm text-white/60">On te recontacte sous peu.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        placeholder="Nom de l'établissement"
        value={form.etablissement}
        onChange={(e) => setForm({ ...form, etablissement: e.target.value })}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        placeholder="Nom du gérant"
        value={form.gerant}
        onChange={(e) => setForm({ ...form, gerant: e.target.value })}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        required
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        type="tel"
        placeholder="Téléphone"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        placeholder="Lien Google Maps (optionnel)"
        value={form.googleMapsUrl}
        onChange={(e) => setForm({ ...form, googleMapsUrl: e.target.value })}
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />
      <input
        placeholder="Instagram (optionnel)"
        value={form.instagram}
        onChange={(e) => setForm({ ...form, instagram: e.target.value })}
        className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-mint-500"
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-mint-500 py-3 font-medium text-navy-950 disabled:opacity-50"
      >
        {loading ? 'Envoi...' : 'Envoyer ma candidature'}
      </button>
    </form>
  );
}
