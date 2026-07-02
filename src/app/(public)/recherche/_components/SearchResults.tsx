'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCityCoordinates, haversineKm } from '@/lib/cityCoordinates';
import type { BusinessWithDetails } from '@/lib/queries/catalog';

const CAT_EMOJI: Record<string, string> = {
  beaute: '✂️',
  'bien-etre': '🧖',
  sport: '🏄',
  sante: '🌿',
  'soins-corps': '🛁',
  'coiffure-barber': '💇',
  'tatouage-piercing': '🪡',
  coaching: '🧠',
  animaux: '🐾',
  'beaute-domicile': '💅',
  photographie: '📷',
  autre: '🔮',
  // Catégories héritées — affichées sur les cartes si présentes en DB
  enfants: '👶',
  food: '🍽️',
  education: '📚',
  creatif: '🎨',
  services: '🔧',
};

const CAT_COLOR: Record<string, string> = {
  beaute: 'from-pink-500/20 to-rose-500/10',
  'bien-etre': 'from-violet-500/20 to-purple-500/10',
  sport: 'from-blue-500/20 to-cyan-500/10',
  sante: 'from-emerald-500/20 to-green-500/10',
  'soins-corps': 'from-teal-500/20 to-cyan-500/10',
  'coiffure-barber': 'from-stone-500/20 to-neutral-500/10',
  'tatouage-piercing': 'from-zinc-600/20 to-neutral-600/10',
  coaching: 'from-sky-500/20 to-indigo-500/10',
  animaux: 'from-lime-500/20 to-yellow-500/10',
  'beaute-domicile': 'from-rose-400/20 to-fuchsia-400/10',
  photographie: 'from-slate-600/20 to-gray-500/10',
  autre: 'from-slate-500/20 to-gray-500/10',
  // Catégories héritées
  enfants: 'from-yellow-500/20 to-amber-500/10',
  food: 'from-orange-500/20 to-red-500/10',
  education: 'from-indigo-500/20 to-blue-500/10',
  creatif: 'from-pink-500/20 to-fuchsia-500/10',
  services: 'from-slate-500/20 to-gray-500/10',
};

const SORT_OPTIONS = [
  { value: 'default', label: 'Pertinence' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'rating', label: 'Mieux notés' },
  { value: 'name', label: 'Nom (A-Z)' },
  { value: 'near', label: 'Près de moi' },
];

type NearStatus = 'idle' | 'loading' | 'active' | 'denied';

interface Coords {
  lat: number;
  lng: number;
}

function formatDistance(km: number): string {
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}

export function SearchResults({ businesses }: { businesses: BusinessWithDetails[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [nearStatus, setNearStatus] = useState<NearStatus>('idle');
  const [userCoords, setUserCoords] = useState<Coords | null>(null);

  const displayList = useMemo(() => {
    if (nearStatus !== 'active' || !userCoords) {
      return businesses.map((biz) => ({ biz, distanceKm: null as number | null }));
    }
    return businesses
      .map((biz) => {
        const cityCoords = getCityCoordinates(biz.city);
        const distanceKm = cityCoords ? haversineKm(userCoords, cityCoords) : null;
        return { biz, distanceKm };
      })
      .sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return 0;
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });
  }, [businesses, nearStatus, userCoords]);

  const selectValue =
    nearStatus === 'active' || nearStatus === 'loading' ? 'near' : searchParams.get('sort') || 'default';

  const handleSortChange = (value: string) => {
    if (value === 'near') {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        setNearStatus('denied');
        return;
      }
      setNearStatus('loading');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setNearStatus('active');
        },
        () => {
          setUserCoords(null);
          setNearStatus('denied');
        },
        { timeout: 10000 }
      );
      return;
    }

    setNearStatus('idle');
    setUserCoords(null);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'default') {
      params.delete('sort');
    } else {
      params.set('sort', value);
    }
    router.push(`/recherche?${params.toString()}`);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-3">
        <select
          value={selectValue}
          onChange={(e) => handleSortChange(e.target.value)}
          className="rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-300 outline-none focus:border-mint-500/40 transition-colors"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Trier : {o.label}
            </option>
          ))}
        </select>
      </div>

      {nearStatus === 'denied' && (
        <p className="mb-3 text-xs text-slate-500">
          Géolocalisation indisponible ou refusée — tri par défaut appliqué.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {displayList.map(({ biz, distanceKm }) => {
          const prices = (biz.services ?? []).filter((s) => s.price > 0).map((s) => s.price);
          const minPrice = prices.length ? Math.min(...prices) : null;
          const serviceCount = biz.services?.length ?? 0;
          const emoji = CAT_EMOJI[biz.category] || '🏢';
          const gradientClass = CAT_COLOR[biz.category] || 'from-slate-500/10 to-slate-500/5';
          const hours =
            biz.open_time && biz.close_time
              ? `${biz.open_time.slice(0, 5)}–${biz.close_time.slice(0, 5)}`
              : null;

          return (
            <Link
              key={biz.id}
              href={`/etablissement/${biz.slug}`}
              className="block rounded-2xl bg-navy-900 border border-white/[0.06] overflow-hidden hover:border-white/12 hover:bg-navy-800/60 transition-all duration-200 group"
            >
              <div className="flex items-stretch">
                {/* Category accent bar */}
                <div className={`w-1 shrink-0 bg-gradient-to-b ${gradientClass} opacity-80`} />

                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gradient-to-br ${gradientClass}`}>
                        {emoji}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-100 truncate text-sm group-hover:text-white transition-colors">
                          {biz.name}
                        </h3>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {biz.type} · {biz.city}
                          {hours && <span className="text-slate-600"> · {hours}</span>}
                        </p>
                        {(minPrice !== null || serviceCount > 0) && (
                          <div className="flex items-center gap-2 mt-1.5">
                            {minPrice !== null && (
                              <span className="text-xs text-mint-400 font-medium">dès {minPrice}€</span>
                            )}
                            {minPrice !== null && serviceCount > 0 && (
                              <span className="w-1 h-1 rounded-full bg-slate-700 inline-block" />
                            )}
                            {serviceCount > 0 && (
                              <span className="text-xs text-slate-500">
                                {serviceCount} prestation{serviceCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {biz.business_reviews?.rating && (
                        <span
                          className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold ${
                            biz.business_reviews.rating >= 4.5 ? 'bg-emerald-500/15 text-emerald-400' :
                            biz.business_reviews.rating >= 4.0 ? 'bg-mint-500/15 text-mint-400' :
                            biz.business_reviews.rating >= 3.5 ? 'bg-amber-500/15 text-amber-400' :
                            'bg-red-500/15 text-red-400'
                          }`}
                        >
                          ★ {biz.business_reviews.rating.toFixed(1)}
                        </span>
                      )}
                      {nearStatus === 'active' && distanceKm != null && (
                        <span className="text-[11px] font-medium text-slate-400">
                          📍 {formatDistance(distanceKm)}
                        </span>
                      )}
                      <svg className="w-4 h-4 text-slate-700 group-hover:text-slate-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}

        {businesses.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-4xl mb-4">🔍</p>
            <p className="text-slate-400 text-sm">Aucun établissement ne correspond.</p>
            <Link href="/recherche" className="mt-3 inline-block text-mint-400 text-xs hover:underline">
              Voir tous les établissements →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
