'use client';
import { useEffect, useRef, useState } from 'react';
import { searchAddress, type AddressSuggestion } from '@/lib/address-search';

interface Props {
  // Défaut au 1er enregistrement uniquement (beaute-domicile → privée par
  // défaut) — au-delà, l'état vient de initialAddressPublic et le pro reste
  // libre de le changer quel que soit son type (voir migration 0037).
  bizType: string;
  initialAddress: string;
  initialPostalCode: string;
  initialAddressPublic: boolean | null;
  initialRadiusKm: number | null;
  hasSavedAddress: boolean;
}

export default function ProAddressForm({
  bizType,
  initialAddress,
  initialPostalCode,
  initialAddressPublic,
  initialRadiusKm,
  hasSavedAddress,
}: Props) {
  const [query, setQuery] = useState(initialAddress);
  const [postalCode, setPostalCode] = useState(initialPostalCode);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressPublic, setAddressPublic] = useState(
    initialAddressPublic ?? bizType !== 'beaute-domicile'
  );
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ? String(initialRadiusKm) : '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Adresse déjà choisie via une suggestion : ne pas relancer une recherche
    // tant qu'elle n'est pas retouchée par le pro (évite un aller-retour API
    // inutile juste après la sélection).
    if (coords) return;
    debounceRef.current = setTimeout(async () => {
      const results = await searchAddress(query);
      setSuggestions(results);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleSelect = (s: AddressSuggestion) => {
    setQuery(s.label);
    setPostalCode(s.postcode);
    setCoords({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSave = async () => {
    if (!coords) {
      setError('Choisis une adresse dans la liste de suggestions.');
      return;
    }
    if (!addressPublic && (!radiusKm || Number(radiusKm) <= 0)) {
      setError('Indique un rayon d’intervention (km) pour la zone affichée publiquement.');
      return;
    }
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const res = await fetch('/api/pro/update-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: query,
          postal_code: postalCode,
          lat: coords.lat,
          lng: coords.lng,
          address_public: addressPublic,
          service_area_radius_km: addressPublic ? null : Number(radiusKm),
        }),
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

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-navy-900/60 px-5 py-5">
      <h2 className="text-sm font-semibold text-white mb-1">Adresse</h2>
      <p className="text-[11px] text-slate-600 mb-4">
        Toujours enregistrée en interne (nécessaire au référencement local),
        affichée publiquement seulement si tu l&apos;autorises ci-dessous.
      </p>

      <div className="relative">
        <label className="block text-xs text-slate-400 mb-1">Adresse</label>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCoords(null);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder="12 rue de la Paix, 64100 Bayonne"
          className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-xl border border-white/[0.08] bg-navy-800 shadow-lg overflow-hidden">
            {suggestions.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => handleSelect(s)}
                  className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {coords && (
          <p className="mt-1 text-[11px] text-mint-400">Adresse localisée ✓</p>
        )}
      </div>

      <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={addressPublic}
          onChange={(e) => setAddressPublic(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-mint-500"
        />
        <span className="text-xs text-slate-300">
          Afficher mon adresse publiquement (fiche + carte). Sinon, seule ta
          ville et un rayon d&apos;intervention sont visibles — recommandé
          pour une activité à domicile.
        </span>
      </label>

      {!addressPublic && (
        <div className="mt-3">
          <label className="block text-xs text-slate-400 mb-1">Rayon d&apos;intervention (km)</label>
          <input
            type="number"
            min={1}
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            placeholder="15"
            className="w-28 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-mint-500/40"
          />
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {savedMsg && <p className="mt-3 text-xs text-mint-400">{savedMsg}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 w-full rounded-xl bg-mint-500 py-2.5 text-sm font-semibold text-navy-950 hover:bg-mint-400 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Enregistrement...' : hasSavedAddress ? 'Mettre à jour l’adresse' : 'Enregistrer l’adresse'}
      </button>
    </div>
  );
}
