// src/app/(public)/recherche/page.tsx
// Port de src/pages/Search.jsx — Server Component avec filtres en query params.
import Link from 'next/link';
import { searchBusinesses, CATEGORIES, type SearchFilters } from '@/lib/queries/catalog';

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

  const businesses = await searchBusinesses(filters);

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <form className="mb-4 space-y-3" action="/recherche" method="get">
          <input
            type="text"
            name="q"
            defaultValue={params.q}
            placeholder="Rechercher un établissement..."
            className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-mint-500"
          />

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

        <p className="mb-3 text-sm text-slate-400">
          {businesses.length} établissement{businesses.length > 1 ? 's' : ''} trouvé
          {businesses.length > 1 ? 's' : ''}
        </p>

        <div className="space-y-3">
          {businesses.map((biz) => {
            const minPrice = Math.min(
              ...(biz.services ?? []).filter((s) => s.price > 0).map((s) => s.price),
              Infinity
            );
            return (
              <Link
                key={biz.id}
                href={`/etablissement/${biz.slug}`}
                className="block rounded-xl bg-navy-900 p-4 hover:bg-navy-800 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-100">{biz.name}</h3>
                    <p className="text-sm text-slate-400">
                      {biz.type} · {biz.city}
                    </p>
                  </div>
                  {biz.business_reviews?.rating && (
                    <span className="flex items-center gap-1 text-sm text-mint-400">
                      ⭐ {biz.business_reviews.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                {minPrice !== Infinity && (
                  <p className="mt-2 text-sm text-slate-300">à partir de {minPrice}€</p>
                )}
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
