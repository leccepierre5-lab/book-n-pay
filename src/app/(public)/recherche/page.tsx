import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Recherche' };
export const revalidate = 60;
import {
  searchBusinesses,
  getAvailableCities,
  getActiveFlashSlots,
  CATEGORIES,
  type SearchFilters,
} from '@/lib/queries/catalog';
import { SearchResults } from './_components/SearchResults';
import { CityAutocomplete } from './_components/CityAutocomplete';
import { BusinessNameAutocomplete } from './_components/BusinessNameAutocomplete';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const { type: _droppedType, ...paramsWithoutTypeRaw } = params;
  const paramsWithoutType = paramsWithoutTypeRaw as Record<string, string>;

  // Changer de catégorie = nouvelle intention de recherche : on garde q (nom
  // cherché) mais on purge type/maxPrice/minRating pour éviter un 0-résultat
  // muet dû à des filtres hérités de l'ancienne catégorie.
  const catBaseParams = (() => {
    const { type: _t, maxPrice: _mp, minRating: _mr, ...rest } = params as Record<string, string | undefined>;
    return Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v != null)
    ) as Record<string, string>;
  })();

  const filters: SearchFilters = {
    query: params.q,
    category: params.category || 'all',
    city: params.city,
    sortBy: (params.sort as SearchFilters['sortBy']) || 'default',
    maxPrice: params.maxPrice ? Number(params.maxPrice) : undefined,
    minRating: params.minRating ? Number(params.minRating) : undefined,
  };

  const [businesses, flashSlots, cities] = await Promise.all([
    searchBusinesses(filters),
    getActiveFlashSlots(),
    getAvailableCities(),
  ]);

  // Sous-catégories : dérivées des résultats déjà filtrés par catégorie (pas de requête
  // supplémentaire), pour rester cohérentes avec ce qui existe réellement en base.
  const availableTypes =
    filters.category !== 'all'
      ? Array.from(
          new Set(businesses.map((b) => b.type?.trim()).filter((t): t is string => Boolean(t)))
        ).sort((a, b) => a.localeCompare(b))
      : [];
  const selectedType = filters.category !== 'all' ? params.type : undefined;
  const displayedBusinesses = selectedType
    ? businesses.filter((b) => b.type === selectedType)
    : businesses;
  const formatType = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  return (
    <div className="min-h-dvh">
      <div className="max-w-5xl mx-auto px-4 py-6">

        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-4">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Accueil
        </Link>

        {/* Search bar */}
        <form className="mb-5 space-y-3" action="/recherche" method="get">
          <div className="flex gap-2">
            <BusinessNameAutocomplete defaultValue={params.q} businesses={businesses} />
            <button
              type="submit"
              className="rounded-xl bg-mint-500 px-4 py-3 text-sm font-semibold text-navy-950 shadow-[0_0_16px_rgba(52,211,153,0.3)] hover:shadow-[0_0_20px_rgba(52,211,153,0.45)] transition-all duration-200"
            >
              Chercher
            </button>
          </div>

          <CityAutocomplete cities={cities} defaultValue={params.city} />

          <div className="flex gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/recherche?${new URLSearchParams({ ...catBaseParams, category: cat.id }).toString()}`}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                  filters.category === cat.id
                    ? 'bg-mint-500 text-navy-950 shadow-[0_0_12px_rgba(52,211,153,0.35)]'
                    : 'bg-navy-900 border border-white/[0.08] text-slate-400 hover:border-white/15 hover:text-white'
                }`}
              >
                {cat.label}
              </Link>
            ))}
          </div>

          {availableTypes.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Link
                href={`/recherche?${new URLSearchParams(paramsWithoutType).toString()}`}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 ${
                  !selectedType
                    ? 'bg-white/10 text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Toutes
              </Link>
              {availableTypes.map((t) => (
                <Link
                  key={t}
                  href={`/recherche?${new URLSearchParams({ ...paramsWithoutType, type: t }).toString()}`}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 ${
                    selectedType === t
                      ? 'bg-white/10 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {formatType(t)}
                </Link>
              ))}
            </div>
          )}
        </form>

        {/* Flash slots */}
        {flashSlots && flashSlots.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold tracking-widest text-mint-400/80 uppercase mb-3">⚡ Créneaux flash</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {flashSlots.map((slot) => (
                <div
                  key={slot.id}
                  className="shrink-0 rounded-xl bg-navy-900 border border-mint-500/25 p-3.5 min-w-[170px]"
                  style={{ boxShadow: '0 0 16px rgba(52,211,153,0.08)' }}
                >
                  <p className="text-[10px] font-bold text-mint-400 tracking-widest uppercase mb-1">⚡ Flash</p>
                  <p className="text-sm font-semibold text-slate-100 truncate">{slot.biz_name}</p>
                  {slot.service_name && (
                    <p className="text-xs text-slate-400 truncate mt-0.5">{slot.service_name}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-2">
                    {slot.date} · {slot.time.slice(0, 5)}
                  </p>
                  {slot.flash_deposit != null && (
                    <p className="text-sm font-bold text-mint-400 mt-0.5">
                      {slot.flash_deposit}€
                      {slot.original_deposit != null && slot.original_deposit !== slot.flash_deposit && (
                        <span className="line-through text-slate-600 ml-1.5 text-xs font-normal">{slot.original_deposit}€</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results count */}
        <div className="mb-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">
            {displayedBusinesses.length} établissement{displayedBusinesses.length > 1 ? 's' : ''}
            {filters.category !== 'all' && ` · ${CATEGORIES.find(c => c.id === filters.category)?.label}`}
            {selectedType && ` · ${formatType(selectedType)}`}
          </p>
        </div>

        <SearchResults businesses={displayedBusinesses} />
      </div>
    </div>
  );
}
