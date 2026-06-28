import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate } from '@/lib/email/send';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'email requis' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://book-n-pay-next.vercel.app';

    // Vérifie que l'email existe (ne pas révéler si un compte existe ou non en prod,
    // mais ici on retourne toujours ok pour éviter l'énumération d'emails)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteUrl}/auth/verify` },
    });

    // Si l'email n'existe pas, Supabase renvoie une erreur — on retourne ok quand même
    if (linkError) {
      console.error('[forgot-password] generateLink error:', linkError.message);
      return NextResponse.json({ ok: true });
    }

    const { hashed_token } = linkData.properties;
    const resetUrl = `${siteUrl}/auth/verify?token_hash=${hashed_token}&type=recovery`;

    await sendEmail({
      to: email,
      subject: "Réinitialise ton mot de passe — Book'nPay",
      html: emailTemplate(`
        <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">Réinitialisation du mot de passe</h2>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
          Tu as demandé à réinitialiser ton mot de passe Book'nPay. Clique sur le bouton ci-dessous
          pour choisir un nouveau mot de passe.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}"
             style="background: linear-gradient(135deg, #34d399, #6ee7b7); color: #0f172a;
                    text-decoration: none; padding: 14px 36px; border-radius: 12px;
                    font-weight: 700; font-size: 15px; display: inline-block;
                    box-shadow: 0 4px 20px rgba(52,211,153,0.35);">
            Réinitialiser mon mot de passe
          </a>
        </div>
        <p style="color: #475569; font-size: 12px; margin: 20px 0 0; text-align: center;">
          Ce lien expire dans 24 heures. Si tu n'as pas fait cette demande, ignore cet email.
        </p>
        <p style="color: #334155; font-size: 11px; margin: 8px 0 0; text-align: center; word-break: break-all;">
          Lien alternatif : <a href="${resetUrl}" style="color: #34d399;">${resetUrl}</a>
        </p>
      `),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[forgot-password]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
