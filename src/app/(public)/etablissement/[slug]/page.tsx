import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBusinessBySlug } from '@/lib/queries/catalog';
import BookingFlow from '@/components/booking/BookingFlow';
import FavoriteButton from '@/components/public/FavoriteButton';

const CATEGORY_ICONS: Record<string, string> = {
  beaute: '✂️',
  'bien-etre': '🧖',
  sport: '🏄',
  enfants: '👶',
  food: '🍽️',
  education: '📚',
  creatif: '🎨',
  services: '🔧',
};

export default async function EtablissementPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);

  if (!business) notFound();

  if (business.frozen) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="mb-2 text-2xl">⏸️</p>
          <h1 className="mb-2 text-lg font-semibold text-white">{business.name}</h1>
          <p className="text-sm text-white/50">
            Cet établissement est temporairement indisponible. Reviens plus tard.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  let isFavorited = false;
  if (authData.user) {
    const { data: fav } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', authData.user.id)
      .eq('biz_id', business.id)
      .maybeSingle();
    isFavorited = !!fav;
  }

  return (
    <div className="relative">
      {authData.user && (
        <div className="absolute top-4 right-4 z-10">
          <FavoriteButton bizId={business.id} initialFavorited={isFavorited} />
        </div>
      )}
      <BookingFlow business={business} icon={CATEGORY_ICONS[business.category] || '🏢'} />
    </div>
  );
}
