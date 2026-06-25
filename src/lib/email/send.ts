// src/lib/email/send.ts
import nodemailer from 'nodemailer';

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('[Email] (non envoyé — GMAIL_USER/GMAIL_APP_PASSWORD absents) →', to, subject);
    return { sent: false };
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `Book'nPay <${user}>`,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (e: any) {
    console.warn('[Email] Erreur envoi:', e.message);
    return { sent: false };
  }
}

// Template HTML de base — port du style emailBase() de verifierInactivite/entry.ts
export function emailTemplate(content: string): string {
  return `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 520px; margin: auto; background: #0f172a; border-radius: 20px; overflow: hidden; border: 1px solid #1e293b;">
      <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 28px 32px; text-align: center;">
        <p style="color: white; font-size: 22px; font-weight: bold; margin: 0;">Book'nPay</p>
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 4px 0 0;">Sérénité &amp; Fidélité</p>
      </div>
      <div style="padding: 32px;">
        ${content}
      </div>
      <div style="padding: 16px 32px; border-top: 1px solid #1e293b; text-align: center;">
        <p style="color: #475569; font-size: 11px; margin: 0;">Book'nPay — votre fidélité est votre assurance.</p>
      </div>
    </div>
  `;
}
