// src/app/api/admin/applications/route.ts
// Approbation / rejet d'une candidature partenaire.
// Approbation : génère un lien d'invitation (generateLink type='invite'), crée le business,
// met à jour app_users (upsert — le trigger handle_new_user a déjà inséré la ligne),
// crée business_settings, envoie UN email Resend avec le lien + les détails du plan.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate } from '@/lib/email/send';
import { getPlanConfig, getEngagementEndDate } from '@/lib/plans-config';

function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type Creneau = { jour: string; ouverture: string; fermeture: string };

const JOUR_TO_INDEX: Record<string, number> = {
  dimanche: 0, dim: 0,
  lundi: 1, lun: 1,
  mardi: 2, mar: 2,
  mercredi: 3, mer: 3,
  jeudi: 4, jeu: 4,
  vendredi: 5, ven: 5,
  samedi: 6, sam: 6,
};

function deriveOpenDays(creneaux: Creneau[] | null): number[] {
  if (!creneaux?.length) return [1, 2, 3, 4, 5];
  return [...new Set(
    creneaux
      .map((c) => JOUR_TO_INDEX[c.jour?.toLowerCase()] ?? -1)
      .filter((d) => d >= 0)
  )].sort();
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth admin ──────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role')
      .eq('id', authData.user.id)
      .single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Accès réservé aux admins' }, { status: 403 });
    }

    const { applicationId, status, planKey, adminNote } = await req.json();
    if (!applicationId || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'applicationId et status (approved|rejected) requis' }, { status: 400 });
    }

    const service = createServiceRoleClient();

    // ── Charger la candidature ──────────────────────────────────────────────
    const { data: app, error: appError } = await service
      .from('partner_applications')
      .select('*')
      .eq('id', applicationId)
      .maybeSingle();

    if (appError || !app) return NextResponse.json({ error: 'Candidature introuvable' }, { status: 404 });
    if (app.status !== 'pending') {
      return NextResponse.json({ error: 'Candidature déjà traitée' }, { status: 409 });
    }

    // ── Rejet ───────────────────────────────────────────────────────────────
    if (status === 'rejected') {
      await service
        .from('partner_applications')
        .update({ status: 'rejected', admin_note: adminNote ?? null })
        .eq('id', applicationId);
      return NextResponse.json({ ok: true });
    }

    // ── Approbation ─────────────────────────────────────────────────────────
    if (!planKey || !['starter', 'business', 'scale'].includes(planKey)) {
      return NextResponse.json({ error: 'planKey invalide (starter|business|scale)' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app';

    // 1. Générer le lien d'invitation — crée l'utilisateur dans auth.users sans envoyer
    //    d'email Supabase (on envoie un seul email via Resend avec notre template).
    //    Le trigger handle_new_user insère app_users(role='client') synchroniquement.
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: 'invite',
      email: app.email,
      options: {
        data: { name: app.gerant, role: 'pro' },
        redirectTo: `${siteUrl}/pro/dashboard`,
      },
    });
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 });

    const proUserId = linkData.user.id;
    const inviteUrl = linkData.properties.action_link;

    // ── Rollback (supprime l'utilisateur Auth si une étape suivante échoue) ──
    const rollback = async (msg: string) => {
      await service.auth.admin.deleteUser(proUserId).catch(() => {});
      console.error('[AdminApplications] Rollback —', msg);
    };

    // 2. Slug unique dérivé du nom d'établissement
    const baseSlug = slugify(app.etablissement) || 'etablissement';
    let slug = baseSlug;
    for (let i = 1; i <= 20; i++) {
      const { data: clash } = await service
        .from('businesses')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${baseSlug}-${i}`;
    }

    // 3. Créer le business (non publié — le pro finalise via l'onboarding)
    const { data: biz, error: bizError } = await service
      .from('businesses')
      .insert({
        name: app.etablissement,
        slug,
        // Pour 'autre', category_label décrit le secteur → businesses.type
        category: app.category,
        city: '',
        type: app.category === 'autre' ? (app.category_label || '') : '',
        owner_id: proUserId,
        is_published: false,
        frozen: false,
        instagram: app.instagram ?? null,
        website: app.website ?? null,
        phone: app.phone ?? null,
        google_place_url: app.google_maps_url ?? null,
        open_days: deriveOpenDays(app.creneaux as Creneau[] | null),
      })
      .select('id')
      .single();

    if (bizError || !biz) {
      await rollback(bizError?.message ?? 'Échec création business');
      return NextResponse.json({ error: bizError?.message ?? 'Erreur création établissement' }, { status: 500 });
    }

    // 4. Mettre à jour app_users : le trigger a déjà créé la ligne (role='client'),
    //    on la corrige en role='pro' avec biz_id.
    const { error: userError } = await service
      .from('app_users')
      .upsert({ id: proUserId, name: app.gerant, role: 'pro', biz_id: biz.id });

    if (userError) {
      await rollback(userError.message);
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    // 5. Créer business_settings avec le plan
    const now = new Date();
    const engagementEnd = getEngagementEndDate(now, planKey);
    const { error: settingsError } = await service.from('business_settings').upsert({
      biz_id: biz.id,
      plan_key: planKey,
      subscription_status: 'pending',
      subscription_start_date: now.toISOString(),
      engagement_end_date: engagementEnd.toISOString(),
      next_billing_date: null,
      stripe_onboarding_complete: false,
      stripe_account_id: null,
      stripe_onboarding_url: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_payment_method_id: null,
      payment_method_type: null,
      notification_prefs: {},
      monthly_bookings_count: 0,
      bookings_count_reset_at: now.toISOString(),
    });

    if (settingsError) {
      await rollback(settingsError.message);
      return NextResponse.json({ error: settingsError.message }, { status: 500 });
    }

    // 6. Marquer la candidature approuvée
    const { error: updateError } = await service
      .from('partner_applications')
      .update({ status: 'approved', approved_at: now.toISOString(), admin_note: adminNote ?? null })
      .eq('id', applicationId);

    if (updateError) {
      await rollback(updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 7. Email Resend — UN seul email avec le lien d'invitation + détails du plan
    const plan = getPlanConfig(planKey);
    const firstName = app.gerant.trim().split(' ')[0] || app.gerant;
    const quotaLabel = plan?.quota != null ? `${plan.quota} réservations / mois` : 'illimitées';
    await sendEmail({
      to: app.email,
      subject: `✅ Bienvenue sur Book'nPay — ${app.etablissement}`,
      html: emailTemplate(`
        <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">
          Félicitations, ${firstName} !
        </h2>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          Votre candidature pour <strong style="color:white">${app.etablissement}</strong>
          a été approuvée. Cliquez sur le bouton ci-dessous pour définir votre mot de passe
          et accéder à votre espace pro.
        </p>
        ${plan ? `
        <div style="background:#1e293b; border-radius:12px; padding:16px; margin:0 0 20px;">
          <p style="color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; margin:0 0 4px;">Votre plan</p>
          <p style="color:#f1f5f9; font-size:18px; font-weight:700; margin:0 0 2px;">${plan.label}</p>
          <p style="color:#64748b; font-size:13px; margin:0;">
            ${plan.priceHT}&nbsp;€ HT&nbsp;/&nbsp;mois · engagement ${plan.engagementMonths}&nbsp;mois · ${quotaLabel}
          </p>
        </div>
        ` : ''}
        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}"
             style="background: linear-gradient(135deg, #34d399, #6ee7b7); color: #0f172a;
                    text-decoration: none; padding: 14px 36px; border-radius: 12px;
                    font-weight: 700; font-size: 15px; display: inline-block;
                    box-shadow: 0 4px 20px rgba(52,211,153,0.35);">
            Configurer mon compte →
          </a>
        </div>
        <p style="color: #475569; font-size: 12px; margin: 20px 0 0; text-align: center;">
          Ce lien expire dans 24 heures. Contactez-nous si vous avez besoin d'un nouveau lien.
        </p>
        <p style="color: #334155; font-size: 11px; margin: 8px 0 0; text-align: center; word-break: break-all;">
          Lien alternatif : <a href="${inviteUrl}" style="color: #34d399;">${inviteUrl}</a>
        </p>
      `),
    });

    console.log(`[AdminApplications] ${app.etablissement} approuvé — bizId=${biz.id} plan=${planKey}`);
    return NextResponse.json({ ok: true, bizId: biz.id, proUserId });
  } catch (err: any) {
    console.error('[AdminApplications]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
