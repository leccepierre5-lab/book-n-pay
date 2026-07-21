import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBusinessBySlug, isNonRealBusiness, CATEGORIES } from '@/lib/queries/catalog';
import { isDemoTesterEmail, isProAccount, PRO_CANNOT_BOOK_MESSAGE } from '@/lib/demo-mode';
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

const formatType = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

// Convention day_of_week (0=Dim, 1=Lun…6=Sam, JS getDay()) — voir database.types.ts.
// Affiché en ordre de lecture Lun→Dim, cohérent avec StepDateTime.tsx/ProCalendar.tsx.
const DAY_LABELS: Record<number, string> = { 0: 'Dim', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam' };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

  // Pas un vrai business (owner_id NULL : jamais passé par le vrai flux
  // d'approbation partenaire — seed de démo ou anciennes fiches vitrine, voir
  // isNonRealBusiness) ou fiche gelée par l'admin (répond en 200 mais n'affiche
  // plus le contenu réel, cf. plus bas) : jamais indexable. Un vrai business
  // (owner_id non-null, publié, non gelé) reste indexable par défaut, sans
  // condition à ajouter le jour où un vrai pro s'inscrit.
  const robots =
    isNonRealBusiness(business) || business.frozen ? { index: false, follow: false } : undefined;

  const categoryLabel = CATEGORIES.find((c) => c.id === business.category)?.label;
  const activity = business.type?.trim() ? formatType(business.type) : categoryLabel;
  const city = business.city?.trim() || undefined;

  const titleSuffix = activity && city ? `${activity} à ${city}` : activity || city;
  const title = titleSuffix ? `${business.name} — ${titleSuffix}` : business.name;

  const descSuffix =
    activity && city ? `${lowerFirst(activity)} à ${city}`
    : activity ? lowerFirst(activity)
    : city ? `à ${city}`
    : null;
  const description = descSuffix
    ? `Réservez en ligne chez ${business.name}, ${descSuffix}. Paiement sécurisé, confirmation instantanée sur Book'nPay.`
    : `Réservez en ligne chez ${business.name} sur Book'nPay. Paiement sécurisé, confirmation instantanée.`;

  // Fiches fictives (isNonRealBusiness) exclues de l'index et jamais censées
  // être partagées : og:image générique, pas la peine de soigner le partage
  // de contenu de démo. Sur une vraie fiche, la 1ère photo par sort_order
  // (même convention que la galerie ci-dessous) sert de couverture ; à
  // défaut, repli sur la bannière statique du site.
  const coverPhoto = !isNonRealBusiness(business)
    ? [...(business.business_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
    : undefined;
  const ogImage = coverPhoto?.url || '/og-default.png';

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      type: 'website',
      locale: 'fr_FR',
      images: [{ url: ogImage, alt: business.name }],
    },
  };
}

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
      <div className="flex min-h-dvh items-center justify-center px-4 text-center">
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
  const isDemoTester = isDemoTesterEmail(authData.user?.email);
  // Masquage confort seulement — le rejet dur vit dans bookings/create[-group]
  // (voir lib/demo-mode.ts). Requêté uniquement pour une fiche réelle : sur
  // une fiche démo, seul isDemoTester compte, pas la peine d'interroger le
  // rôle pour rien.
  const isProBlocked =
    !isNonRealBusiness(business) && authData.user
      ? await isProAccount(supabase, authData.user.id)
      : false;

  const photos = (business.business_photos ?? []).sort((a, b) => a.sort_order - b.sort_order);
  const hasSocial =
    business.instagram || business.facebook_url || business.website || business.google_place_url;

  return (
    <div className="relative">
      <div className="px-4 pt-4">
        <Link href="/recherche" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Recherche
        </Link>
      </div>
      {authData.user && (
        <div className="absolute top-4 right-4 z-10">
          <FavoriteButton bizId={business.id} initialFavorited={isFavorited} />
        </div>
      )}

      <div className="max-w-4xl mx-auto">
      {/* Galerie photos horizontale */}
      {photos.length > 0 && (
        <div className="overflow-x-auto flex gap-2 px-4 pt-4 pb-1 scrollbar-hide">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative flex-none w-56 h-36 rounded-xl overflow-hidden border border-white/[0.06]"
            >
              <Image src={p.url} alt={business.name} fill className="object-cover" sizes="224px" />
            </div>
          ))}
        </div>
      )}

      {/* Localisation + contact */}
      {(business.city || business.phone || (business.business_reviews?.rating != null && business.business_reviews.review_count > 0)) && (
        <div className="px-4 pt-3 pb-1 flex flex-wrap items-center gap-2">
          {business.business_reviews?.rating != null && business.business_reviews.review_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-amber-300 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]">
              ⭐ {business.business_reviews.rating.toFixed(1)} ({business.business_reviews.review_count} avis)
            </span>
          )}
          {business.city && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]">
              📍 {business.city}
            </span>
          )}
          {business.city && (
            <>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(`${business.name}, ${business.city}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
              >
                🗺️ Itinéraire (Maps)
              </a>
              <a
                href={`https://waze.com/ul?q=${encodeURIComponent(`${business.name}, ${business.city}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
              >
                🚗 Itinéraire (Waze)
              </a>
            </>
          )}
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
            >
              📞 {business.phone}
            </a>
          )}
        </div>
      )}

      {/* Horaires — n'affiche que si open_time/close_time renseignés ; open_days
          peut être vide (time sans days) sans casser le rendu, la liste de
          jours est alors simplement omise. */}
      {business.open_time && business.close_time && (
        <div className="px-4 pt-3 pb-1 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08]">
            🕐 {business.open_time.slice(0, 5)}–{business.close_time.slice(0, 5)}
            {business.open_days.length > 0 && (
              <span className="text-slate-500">
                {' '}· {WEEK_ORDER.filter((d) => business.open_days.includes(d)).map((d) => DAY_LABELS[d]).join(', ')}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Liens sociaux + Google */}
      {hasSocial && (
        <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
          {business.instagram && (
            <a
              href={`https://instagram.com/${business.instagram.replace(/^@/, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              @{business.instagram.replace(/^@/, '')}
            </a>
          )}
          {business.facebook_url && (
            <a
              href={business.facebook_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Facebook
            </a>
          )}
          {business.website && (
            <a
              href={business.website.startsWith('http') ? business.website : `https://${business.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              Site web
            </a>
          )}
          {business.google_place_url && (
            <a
              href={business.google_place_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Voir les avis Google
            </a>
          )}
        </div>
      )}

      </div>
      {isNonRealBusiness(business) && !isDemoTester ? (
        // Couche 1 (confort) du garde-fou démo — les couches dures sont
        // bookings/create[-group] et stripe/checkout, qui rejettent déjà la
        // réservation même via un appel direct. Ici on évite juste de faire
        // cliquer un vrai visiteur sur un CTA qui échouerait de toute façon,
        // et on explique pourquoi plutôt que de faire disparaître la fiche
        // (le catalogue vitrine reste voulu — supabase/seed/demo_businesses.sql).
        <div className="max-w-4xl mx-auto px-4 pb-8">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 text-center">
            <p className="mb-1 text-xl">🏗️</p>
            <p className="text-sm font-semibold text-white mb-1">Fiche de démonstration</p>
            <p className="text-xs text-slate-500">
              Cet établissement illustre notre catalogue mais n&apos;a pas encore de compte actif — la réservation n&apos;est pas disponible ici.
            </p>
          </div>
        </div>
      ) : isProBlocked ? (
        <div className="max-w-4xl mx-auto px-4 pb-8">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 text-center">
            <p className="mb-1 text-xl">🔒</p>
            <p className="text-sm font-semibold text-white mb-1">Compte professionnel</p>
            <p className="text-xs text-slate-500 mb-3">{PRO_CANNOT_BOOK_MESSAGE}</p>
            <Link
              href="/inscription"
              className="inline-block text-xs font-medium text-mint-400 hover:text-mint-300 transition-colors"
            >
              Créer un compte client →
            </Link>
          </div>
        </div>
      ) : (
        <>
          {isNonRealBusiness(business) && isDemoTester && (
            <div className="max-w-4xl mx-auto px-4 pt-3">
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-center">
                <p className="text-xs font-semibold text-amber-300 mb-0.5">🧪 Mode démo — testeur</p>
                <p className="text-xs text-amber-200/80">
                  Fiche sans compte pro actif. Le paiement se fait en carte de test Stripe (4242 4242 4242 4242),
                  aucun euro réel ne bouge, et rien n&apos;est enregistré côté réservation.
                </p>
              </div>
            </div>
          )}
          <BookingFlow business={business} icon={CATEGORY_ICONS[business.category] || '🏢'} />
        </>
      )}
    </div>
  );
}
