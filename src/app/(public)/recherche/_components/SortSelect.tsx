'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const SORT_OPTIONS = [
  { value: 'default', label: 'Pertinence' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'rating', label: 'Mieux notés' },
  { value: 'name', label: 'Nom (A-Z)' },
];

export function SortSelect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      value={searchParams.get('sort') || 'default'}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value === 'default') {
          params.delete('sort');
        } else {
          params.set('sort', e.target.value);
        }
        router.push(`/recherche?${params.toString()}`);
      }}
      className="rounded-xl bg-navy-900 border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-300 outline-none focus:border-mint-500/40 transition-colors"
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          Trier : {o.label}
        </option>
      ))}
    </select>
  );
}
