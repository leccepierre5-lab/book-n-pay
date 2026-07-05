import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate, escapeHtml } from '@/lib/email/send';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond, logAndRespondAuthError } from '@/lib/api-error';
import { CGU_VERSION } from '@/lib/legal';

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
    // SECURITY_TODO.md #3 — évite le spam de comptes/emails de confirmation.
    const { allowed } = await checkRateLimit(`register:${getClientIp(req)}`, 5, 15 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const { email, password, name, phone, referralCode, cguAccepted } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'email et password requis' }, { status: 400 });
    }
    if (cguAccepted !== true) {
      return NextResponse.json({ error: 'Vous devez accepter les CGU/CGV pour créer un compte.' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://book-n-pay-next.vercel.app';

    // Crée l'utilisateur et génère le token de confirmation en une seule requête.
    // Aucun email n'est envoyé par Supabase — on récupère hashed_token pour l'envoyer
    // nous-mêmes via Resend (domaine vérifié, pas de limite de débit).
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        data: {
          name: (name || '').trim(),
          phone: phone || '',
          role: 'client',
          referrer_code: referralCode || undefined,
        },
        redirectTo: `${siteUrl}/auth/verify`,
      },
    });

    if (linkError) {
      // Si l'email est déjà enregistré et confirmé, on renvoie une erreur claire
      if (linkError.message?.toLowerCase().includes('already registered')) {
        return NextResponse.json({ error: 'Cet email est déjà utilisé.' }, { status: 409 });
      }
      return logAndRespondAuthError('[register] Erreur generateLink:', linkError);
    }

    const { hashed_token } = linkData.properties;
    const userId = linkData.user.id;
    const confirmUrl = `${siteUrl}/auth/verify?token_hash=${hashed_token}&type=signup`;

    // Code de parrainage
    const { data: existingUser } = await supabase
      .from('app_users')
      .select('id, referral_code')
      .eq('id', userId)
      .maybeSingle();

    const userUpdate: Record<string, unknown> = {
      cgu_accepted_at: new Date().toISOString(),
      cgu_version: CGU_VERSION,
    };

    if (existingUser && !existingUser.referral_code) {
      let code = '';
      for (let i = 0; i < 5; i++) {
        const candidate = buildCode((name || 'USER').split(' ')[0]);
        const { data: clash } = await supabase
          .from('app_users')
          .select('id')
          .eq('referral_code', candidate)
          .maybeSingle();
        if (!clash) { code = candidate; break; }
      }
      if (!code) code = buildCode('USER' + Date.now().toString().slice(-4));

      let referredBy: string | null = null;
      if (referralCode) {
        const { data: referrer } = await supabase
          .from('app_users')
          .select('id')
          .eq('referral_code', referralCode)
          .maybeSingle();
        if (referrer) referredBy = referrer.id;
      }

      userUpdate.referral_code = code;
      if (referredBy) userUpdate.referred_by = referredBy;
    }

    await supabase.from('app_users').update(userUpdate).eq('id', userId);

    // Email de confirmation via Resend (domaine book-n-pay.com vérifié, DKIM OK)
    const firstName = ((name || '').trim().split(' ')[0]) || 'toi';
    await sendEmail({
      to: email,
      subject: "Confirme ton adresse email — Book'nPay",
      html: emailTemplate(`
        <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">Bienvenue, ${escapeHtml(firstName)} !</h2>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
          Tu es à un clic de rejoindre Book'nPay. Clique sur le bouton ci-dessous pour confirmer
          ton adresse email et activer ton compte.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${confirmUrl}"
             style="background: linear-gradient(135deg, #34d399, #6ee7b7); color: #0f172a;
                    text-decoration: none; padding: 14px 36px; border-radius: 12px;
                    font-weight: 700; font-size: 15px; display: inline-block;
                    box-shadow: 0 4px 20px rgba(52,211,153,0.35);">
            Confirmer mon email
          </a>
        </div>
        <p style="color: #475569; font-size: 12px; margin: 20px 0 0; text-align: center;">
          Ce lien expire dans 24 heures. Si tu n'as pas créé de compte, ignore cet email.
        </p>
        <p style="color: #334155; font-size: 11px; margin: 8px 0 0; text-align: center; word-break: break-all;">
          Lien alternatif : <a href="${confirmUrl}" style="color: #34d399;">${confirmUrl}</a>
        </p>
      `),
    });

    return NextResponse.json({ ok: true, emailSent: true });
  } catch (err: any) {
    return logAndRespond('[register]', err);
  }
}
