'use client';
import { useState, useRef } from 'react';
import Image from 'next/image';

interface Photo { id: string; url: string; sort_order: number }

export default function ProProfileForm({
  initialInstagram,
  initialFacebook,
  initialWebsite,
  initialPhotos,
}: {
  bizId: string;
  initialInstagram: string;
  initialFacebook: string;
  initialWebsite: string;
  initialPhotos: Photo[];
}) {
  const [instagram, setInstagram] = useState(initialInstagram);
  const [facebook, setFacebook] = useState(initialFacebook);
  const [website, setWebsite] = useState(initialWebsite);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSaveLinks = async () => {
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const res = await fetch('/api/pro/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagram, facebook_url: facebook, website }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Erreur serveur');
      } else {
        setSavedMsg('Enregistré ✓');
        setTimeout(() => setSavedMsg(''), 2500);
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (photos.length >= 5) {
      setError('Maximum 5 photos atteint');
      return;
    }
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/pro/photos', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erreur upload');
      } else {
        setPhotos((prev) => [...prev, data.photo]);
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (photoId: string) => {
    setError('');
    const res = await fetch('/api/pro/photos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId }),
    });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } else {
      const d = await res.json();
      setError(d.error || 'Erreur suppression');
    }
  };

  return (
    <div className="space-y-6">
      {/* Liens sociaux */}
      <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5">
        <h2 className="text-sm font-semibold text-white mb-4">Liens & réseaux</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Instagram (ex: @monsalon)</label>
            <input
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@monsalon"
              className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Facebook (URL complète)</label>
            <input
              type="url"
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="https://facebook.com/monsalon"
              className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Site web</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://monsalon.fr"
              className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
            />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {savedMsg && <p className="mt-3 text-xs text-mint-400">{savedMsg}</p>}
        <button
          onClick={handleSaveLinks}
          disabled={saving}
          className="mt-4 w-full rounded-xl bg-mint-500 py-2.5 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer les liens'}
        </button>
      </div>

      {/* Photos */}
      <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Photos ({photos.length}/5)</h2>
          {photos.length < 5 && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-mint-400 hover:text-mint-300 disabled:opacity-50 transition-colors font-medium"
            >
              {uploading ? 'Upload...' : '+ Ajouter une photo'}
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />

        {photos.length === 0 ? (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full h-28 rounded-xl border border-dashed border-white/[0.12] flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className="text-xs">{uploading ? 'Upload en cours...' : 'Ajouter vos photos (max 5 Mo)'}</span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden border border-white/[0.06]">
                <Image src={p.url} alt="" fill className="object-cover" sizes="120px" />
                <button
                  onClick={() => handleDelete(p.id)}
                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  title="Supprimer"
                >
                  <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            ))}
            {photos.length < 5 && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="aspect-square rounded-xl border border-dashed border-white/[0.12] flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors"
              >
                {uploading ? (
                  <span className="text-xs">...</span>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                )}
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <p className="mt-3 text-[11px] text-slate-600">
          Ces photos s'affichent sur votre fiche publique. Formats acceptés : JPG, PNG, WebP — max 5 Mo.
        </p>
      </div>
    </div>
  );
}
