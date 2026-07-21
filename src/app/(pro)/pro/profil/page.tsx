import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import ProProfileForm from '@/components/pro/ProProfileForm';
import ProAddressForm from '@/components/pro/ProAddressForm';

export default async function ProProfilPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/pro/profil');

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id) redirect('/pro');

  const supabaseAdmin = createServiceRoleClient();

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('id, name, type, instagram, facebook_url, website, google_place_url, service_area_radius_km')
    .eq('id', profile.biz_id)
    .maybeSingle();

  const { data: photos } = await supabaseAdmin
    .from('business_photos')
    .select('id, url, sort_order')
    .eq('biz_id', profile.biz_id)
    .order('sort_order', { ascending: true });

  const { data: location } = await supabaseAdmin
    .from('business_locations')
    .select('address, postal_code, address_public')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  if (!business) redirect('/pro');

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white">←</Link>
          <h1 className="text-lg font-semibold text-white">Mon profil public</h1>
        </div>
        <ProProfileForm
          bizId={business.id}
          initialInstagram={business.instagram ?? ''}
          initialFacebook={business.facebook_url ?? ''}
          initialWebsite={business.website ?? ''}
          initialPhotos={(photos ?? []) as { id: string; url: string; sort_order: number }[]}
        />
        <div className="mt-6">
          <ProAddressForm
            bizType={business.type}
            initialAddress={location?.address ?? ''}
            initialPostalCode={location?.postal_code ?? ''}
            initialAddressPublic={location?.address_public ?? null}
            initialRadiusKm={business.service_area_radius_km}
            hasSavedAddress={!!location}
          />
        </div>
      </div>
    </div>
  );
}
