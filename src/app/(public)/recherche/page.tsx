import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Recherche' };
import { searchBusinesses, CATEGORIES, type SearchFilters } from '@/lib/queries/catalog';
import type { FlashSlot } from '@/lib/database.types';
import { SortSelect } from './_components/SortSelect';

const CAT_EMOJI: Record<string, string> = {
  beaute: '✂️',
  'bien-etre': '🧖',
  sport: '🏄',
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
  autre: 'from-slate-500/20 to-gray-500/10',
  // Catégories héritées
  enfants: 'from-yellow-500/20 to-amber-500/10',
  food: 'from-orange-500/20 to-red-500/10',
  education: 'from-indigo-500/20 to-blue-500/10',
  creatif: 'from-pink-500/20 to-fuchsia-500/10',
  services: 'from-slate-500/20 to-gray-500/10',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;

  const filters: SearchFilters = {
    query: params.q,
    category: params.category || 'all',
    city: params.city,
    sortBy: (params.sort as SearchFilters['sortBy']) || 'default',
    maxPrice: params.maxPrice ? Number(params.maxPrice) : undefined,
    minRating: params.minRating ? Number(params.minRating) : undefined,
  };

  const today = new Date().toISOString().split('T')[0];
  const serviceRole = createServiceRoleClient();

  const [businesses, { data: flashSlots }] = await Promise.all([
    searchBusinesses(filters),
    serviceRole
      .from('flash_slots')
      .select('*')
      .eq('active', true)
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(5),
  ]);

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
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                name="q"
                defaultValue={params.q}
                placeholder="Coiffeur, barbier, massage..."
                className="w-full rounded-xl bg-navy-900 border border-white/[0.08] pl-10 pr-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-mint-500 px-4 py-3 text-sm font-semibold text-navy-950 shadow-[0_0_16px_rgba(52,211,153,0.3)] hover:shadow-[0_0_20px_rgba(52,211,153,0.45)] transition-all duration-200"
            >
              Chercher
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/recherche?${new URLSearchParams({ ...params, category: cat.id }).toString()}`}
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
        </form>

        {/* Flash slots */}
        {flashSlots && flashSlots.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold tracking-widest text-mint-400/80 uppercase mb-3">⚡ Créneaux flash</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {(flashSlots as FlashSlot[]).map((slot) => (
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

        {/* Results count + sort */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">
            {businesses.length} établissement{businesses.length > 1 ? 's' : ''}
            {filters.category !== 'all' && ` · ${CATEGORIES.find(c => c.id === filters.category)?.label}`}
          </p>
          <SortSelect />
        </div>

        {/* Business cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {businesses.map((biz) => {
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
    </div>
  );
}
