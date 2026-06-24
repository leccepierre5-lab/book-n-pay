import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function MesFavorisPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/mes-favoris');

  const { data: favorites } = await supabase
    .from('favorites')
    .select('*, businesses(id, slug, name, city, category, type, frozen, business_reviews(rating))')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  const bizList = (favorites || [])
    .map((f: any) => f.businesses)
    .filter(Boolean);

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/mes-reservations" className="text-slate-400 hover:text-slate-200 text-sm">
            ← Mes réservations
          </Link>
          <h1 className="text-xl font-bold text-white">❤️ Mes favoris</h1>
        </div>

        {bizList.length === 0 && (
          <div className="py-16 text-center text-slate-500">
            <p className="text-2xl mb-2">💔</p>
            <p>Aucun favori pour l'instant.</p>
            <Link href="/recherche" className="mt-4 inline-block text-mint-400 text-sm hover:underline">
              Découvrir des établissements →
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {bizList.map((biz: any) => (
            <Link
              key={biz.id}
              href={`/etablissement/${biz.slug}`}
              className="block rounded-xl bg-navy-900 p-4 hover:bg-navy-800 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100">{biz.name}</h3>
                  <p className="text-sm text-slate-400">{biz.type} · {biz.city}</p>
                </div>
                <div className="flex items-center gap-2">
                  {biz.business_reviews?.rating && (
                    <span className="text-sm text-mint-400">
                      ⭐ {biz.business_reviews.rating.toFixed(1)}
                    </span>
                  )}
                  {biz.frozen && <span className="text-xs text-slate-500">⏸️</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
