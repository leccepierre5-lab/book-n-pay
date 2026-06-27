import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate } from '@/lib/email/send';

const COMBINING_MARKS = /[̀-ͯ]/g;

function buildCode(firstName: string): string {
  const clean =
    firstName
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'USER';
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `BNP-${clean}${digits}`;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, name, email, referrerCode } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 });

    const supabase = createServiceRoleClient();

    const { data: user } = await supabase
      .from('app_users')
      .select('id, referral_code')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Auto-confirmer l'email — contourne le SMTP Supabase qui est non fiable en prod.
    // Resend (domaine book-n-pay.com vérifié) gère l'email de bienvenue ci-dessous.
    await supabase.auth.admin.updateUserById(userId, { email_confirm: true });

    if (!user.referral_code) {
      // Generate unique referral_code (retry up to 5×)
      let code = '';
      for (let i = 0; i < 5; i++) {
        const candidate = buildCode(name || 'USER');
        const { data: clash } = await supabase
          .from('app_users')
          .select('id')
          .eq('referral_code', candidate)
          .maybeSingle();
        if (!clash) { code = candidate; break; }
      }
      if (!code) code = buildCode((name || 'USER') + Date.now().toString().slice(-4));

      let referredBy: string | null = null;
      if (referrerCode) {
        const { data: referrer } = await supabase
          .from('app_users')
          .select('id')
          .eq('referral_code', referrerCode)
          .maybeSingle();
        if (referrer) referredBy = referrer.id;
      }

      await supabase
        .from('app_users')
        .update({
          referral_code: code,
          ...(referredBy ? { referred_by: referredBy } : {}),
        })
        .eq('id', userId);
    }

    // Email de bienvenue via Resend (domaine vérifié, DKIM OK)
    if (email) {
      const firstName = (name || 'toi').split(' ')[0];
      await sendEmail({
        to: email,
        subject: "Bienvenue sur Book'nPay !",
        html: emailTemplate(`
          <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">Bienvenue, ${firstName} !</h2>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
            Ton compte Book'nPay est prêt. Tu peux maintenant réserver tes premières prestations
            et profiter du programme de fidélité.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="https://book-n-pay-next.vercel.app/recherche"
               style="background: linear-gradient(135deg, #34d399, #6ee7b7); color: #0f172a; text-decoration: none;
                      padding: 14px 32px; border-radius: 12px; font-weight: 700; font-size: 14px; display: inline-block;">
              Découvrir les établissements
            </a>
          </div>
          <p style="color: #475569; font-size: 12px; margin: 16px 0 0;">
            Tu peux te connecter à tout moment depuis <a href="https://book-n-pay-next.vercel.app/connexion" style="color: #34d399;">book-n-pay-next.vercel.app</a>.
          </p>
        `),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, confirmed: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
