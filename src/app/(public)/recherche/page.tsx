import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Recherche' };
import { searchBusinesses, CATEGORIES, type SearchFilters } from '@/lib/queries/catalog';
import type { FlashSlot } from '@/lib/database.types';

const CAT_EMOJI: Record<string, string> = {
  beaute: '✂️',
  'bien-etre': '🧖',
  sport: '🏄',
  enfants: '👶',
  food: '🍽️',
  education: '📚',
  creatif: '🎨',
  services: '🔧',
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
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <form className="mb-4 space-y-3" action="/recherche" method="get">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={params.q}
              placeholder="Rechercher un établissement..."
              className="flex-1 rounded-lg bg-navy-900 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-mint-500"
            />
            <button
              type="button"
              className="rounded-lg bg-navy-900 px-4 py-3 text-sm text-slate-300 whitespace-nowrap border border-white/5 hover:bg-navy-800 transition-colors"
            >
              ≡ Filtres
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/recherche?${new URLSearchParams({ ...params, category: cat.id }).toString()}`}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${
                  filters.category === cat.id
                    ? 'bg-mint-500 text-navy-950'
                    : 'bg-navy-900 text-slate-300'
                }`}
              >
                {cat.label}
              </Link>
            ))}
          </div>
        </form>

        {flashSlots && flashSlots.length > 0 && (
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-mint-400 mb-2">⚡ Créneaux flash</h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(flashSlots as FlashSlot[]).map((slot) => (
                <div
                  key={slot.id}
                  className="shrink-0 rounded-xl bg-navy-900 border border-mint-500/30 p-3 min-w-[160px]"
                >
                  <p className="text-xs text-mint-400 font-semibold">⚡ Flash</p>
                  <p className="text-sm font-medium text-slate-100 truncate">{slot.biz_name}</p>
                  {slot.service_name && (
                    <p className="text-xs text-slate-400 truncate">{slot.service_name}</p>
                  )}
                  <p className="text-xs text-slate-300 mt-1">
                    {slot.date} · {slot.time.slice(0, 5)}
                  </p>
                  {slot.flash_deposit != null && (
                    <p className="text-xs text-mint-400 mt-0.5">
                      {slot.flash_deposit}€
                      {slot.original_deposit != null && slot.original_deposit !== slot.flash_deposit && (
                        <span className="line-through text-slate-500 ml-1">{slot.original_deposit}€</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mb-3 text-sm text-slate-400">
          {businesses.length} établissement{businesses.length > 1 ? 's' : ''} trouvé
          {businesses.length > 1 ? 's' : ''}
        </p>

        <div className="space-y-3">
          {businesses.map((biz) => {
            const prices = (biz.services ?? []).filter((s) => s.price > 0).map((s) => s.price);
            const minPrice = prices.length ? Math.min(...prices) : null;
            const serviceCount = biz.services?.length ?? 0;
            const emoji = CAT_EMOJI[biz.category] || '🏢';
            const hours =
              biz.open_time && biz.close_time
                ? ` · ${biz.open_time.slice(0, 5)}–${biz.close_time.slice(0, 5)}`
                : '';

            return (
              <Link
                key={biz.id}
                href={`/etablissement/${biz.slug}`}
                className="block rounded-xl bg-navy-900 p-4 hover:bg-navy-800 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-100 truncate">
                      {emoji} {biz.name}
                    </h3>
                    <p className="text-sm text-slate-400 truncate mt-0.5">
                      {biz.type} · {biz.city}{hours}
                    </p>
                    {(minPrice !== null || serviceCount > 0) && (
                      <p className="text-sm text-slate-300 mt-1">
                        {minPrice !== null && `dès ${minPrice}€`}
                        {minPrice !== null && serviceCount > 0 && ' · '}
                        {serviceCount > 0 && `${serviceCount} prestation${serviceCount > 1 ? 's' : ''}`}
                      </p>
                    )}
                  </div>
                  {biz.business_reviews?.rating && (
                    <span
                      className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                        biz.business_reviews.rating >= 4.5 ? 'bg-emerald-500/20 text-emerald-400' :
                        biz.business_reviews.rating >= 4.0 ? 'bg-mint-500/20 text-mint-400' :
                        biz.business_reviews.rating >= 3.5 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {biz.business_reviews.rating.toFixed(1)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}

          {businesses.length === 0 && (
            <p className="py-10 text-center text-slate-500">
              Aucun établissement ne correspond à ta recherche.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
