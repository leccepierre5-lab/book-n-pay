import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

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

export default async function MesFavorisPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/mes-favoris');

  const { data: favorites } = await supabase
    .from('favorites')
    .select('*, businesses(id, slug, name, city, category, type, frozen, business_reviews(rating))')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  const bizList = (favorites || []).map((f: any) => f.businesses).filter(Boolean);

  return (
    <div className="min-h-dvh">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/recherche"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Recherche
          </Link>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <h1 className="text-lg font-bold text-white">Mes favoris</h1>
          <span className="text-red-400">❤️</span>
          {bizList.length > 0 && (
            <span className="text-xs text-slate-500 bg-navy-900 border border-white/[0.08] rounded-full px-2 py-0.5">
              {bizList.length}
            </span>
          )}
        </div>

        {bizList.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-4xl mb-4">💔</p>
            <p className="text-slate-400 text-sm mb-2">Aucun favori pour l'instant.</p>
            <p className="text-slate-600 text-xs mb-6">Appuyez sur le ❤️ sur la page d'un établissement pour l'ajouter.</p>
            <Link
              href="/recherche"
              className="inline-flex items-center gap-2 rounded-2xl py-3 px-6 text-sm font-semibold text-navy-950 transition-all"
              style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 20px rgba(52,211,153,0.35)' }}
            >
              Découvrir des établissements →
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {bizList.map((biz: any) => {
            const emoji = CAT_EMOJI[biz.category] || '🏢';
            return (
              <Link
                key={biz.id}
                href={`/etablissement/${biz.slug}`}
                className="flex items-center gap-3 rounded-2xl bg-navy-900 border border-white/[0.08] p-4 hover:border-white/12 hover:bg-navy-800/60 transition-all duration-200 group"
              >
                <div className="w-10 h-10 rounded-xl bg-navy-800 border border-white/[0.06] flex items-center justify-center text-lg shrink-0">
                  {emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-100 truncate text-sm group-hover:text-white transition-colors">{biz.name}</h3>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{biz.type} · {biz.city}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {biz.business_reviews?.rating && (
                    <span className="text-xs text-mint-400 font-semibold">★ {biz.business_reviews.rating.toFixed(1)}</span>
                  )}
                  {biz.frozen && <span className="text-[11px] text-slate-600 bg-navy-800 rounded px-1.5 py-0.5">⏸ Indispo</span>}
                  <svg className="w-4 h-4 text-slate-700 group-hover:text-slate-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
