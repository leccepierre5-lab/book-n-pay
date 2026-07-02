// src/app/api/cron/verifier-inactivite/route.ts
// Port de base44/functions/verifierInactivite/entry.ts
// Tourne quotidiennement (voir vercel.json) :
// - 45 jours sans RDV honoré → email d'alerte douce
// - 55 jours → email d'urgence
// - 60 jours → déclassement automatique en Standard + email constat
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate, escapeHtml } from '@/lib/email/send';
import { isValidBearerSecret } from '@/lib/constant-time';

const JOURS_ALERTE_DOUCE = 45;
const JOURS_ALERTE_URGENCE = 55;
const JOURS_DECLASSEMENT = 60;
const JOKERS_PAR_STATUT: Record<string, number> = { Standard: 1, Bronze: 1, Argent: 2, Gold: 3 };
const STATUT_EMOJI: Record<string, string> = { Gold: '🏆', Argent: '🥈', Bronze: '🥉' };

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const today = new Date();

  const { data: users } = await supabase
    .from('app_users')
    .select('id, name, statut, derniere_activite')
    .neq('statut', 'Standard')
    .not('derniere_activite', 'is', null);

  let alertesDouces = 0;
  let alertesUrgences = 0;
  let declasses = 0;

  for (const user of users || []) {
    if (!user.derniere_activite) continue;

    const dernier = new Date(user.derniere_activite);
    const joursInactivite = Math.floor((today.getTime() - dernier.getTime()) / (1000 * 60 * 60 * 24));
    // Échappé une fois ici — réutilisé tel quel dans les 3 templates HTML
    // ci-dessous (nom saisi librement à l'inscription).
    const prenom = escapeHtml(user.name?.split(' ')[0] || user.name || 'Client');

    const { data: authUser } = await supabase.auth.admin.getUserById(user.id);
    const email = authUser.user?.email;

    if (joursInactivite >= JOURS_DECLASSEMENT) {
      const ancienStatut = user.statut;
      await supabase
        .from('app_users')
        .update({ statut: 'Standard', rdv_honores: 0, jokers_disponibles: 1, jokers_utilises: 0 })
        .eq('id', user.id);
      declasses++;
      console.log(`[Inactivité] Déclassement ${user.name}: ${ancienStatut} → Standard (${joursInactivite}j)`);

      if (email) {
        await sendEmail({
          to: email,
          subject: "📋 Mise à jour de votre statut Book'nPay",
          html: emailTemplate(`
            <h2 style="color: #f8fafc; font-size: 20px; margin: 0 0 16px;">Mise à jour de votre statut Book'nPay</h2>
            <p style="color: #94a3b8; line-height: 1.7; margin: 0 0 16px;">Bonjour ${prenom}, conformément à nos Conditions Générales d'Utilisation, votre statut a été mis à jour suite à une période d'inactivité de 60 jours.</p>
            <div style="background: #1e293b; border-radius: 12px; padding: 16px; margin: 20px 0; border-left: 4px solid #64748b;">
              <p style="color: #94a3b8; font-size: 13px; margin: 0 0 4px;">Votre statut actuel</p>
              <p style="color: #f8fafc; font-size: 20px; font-weight: bold; margin: 0;">Standard</p>
            </div>
            <p style="color: #94a3b8; line-height: 1.7; margin: 0 0 24px;">Pas de panique : vous pouvez commencer à cumuler à nouveau des rendez-vous dès aujourd'hui pour remonter rapidement dans les paliers !</p>
          `),
        });
      }
      continue;
    }

    if (joursInactivite >= JOURS_ALERTE_URGENCE) {
      alertesUrgences++;
      if (email) {
        const joursRestants = JOURS_DECLASSEMENT - joursInactivite;
        await sendEmail({
          to: email,
          subject: `⚠️ Plus que ${joursRestants} jours pour conserver votre statut !`,
          html: emailTemplate(`
            <div style="background: #7f1d1d; border-radius: 12px; padding: 16px; margin: 0 0 24px; text-align: center;">
              <p style="color: #fca5a5; font-size: 28px; margin: 0 0 4px;">⚠️</p>
              <p style="color: #fca5a5; font-weight: bold; font-size: 16px; margin: 0;">Action requise sous ${joursRestants} jours</p>
            </div>
            <p style="color: #94a3b8; line-height: 1.7; margin: 0 0 16px;">Attention ${prenom}, votre statut <strong style="color: #f8fafc;">${user.statut}</strong> est sur le point d'être réinitialisé.</p>
            <p style="color: #94a3b8; line-height: 1.7;">Si aucune réservation n'est effectuée dans les <strong style="color: #fca5a5;">${joursRestants} prochains jours</strong>, votre compte repassera automatiquement au statut Standard.</p>
          `),
        });
      }
      continue;
    }

    if (joursInactivite >= JOURS_ALERTE_DOUCE) {
      alertesDouces++;
      const joursRestants = JOURS_DECLASSEMENT - joursInactivite;
      const nbJokers = JOKERS_PAR_STATUT[user.statut] || 1;

      if (email) {
        await sendEmail({
          to: email,
          subject: '🌟 Gardez vos avantages Sérénité !',
          html: emailTemplate(`
            <div style="background: #1e293b; border-radius: 12px; padding: 16px; margin: 0 0 24px; text-align: center;">
              <p style="color: #fbbf24; font-size: 28px; margin: 0 0 4px;">${STATUT_EMOJI[user.statut] || '🥉'}</p>
              <p style="color: #fbbf24; font-weight: bold; font-size: 16px; margin: 0;">Statut ${user.statut} actif</p>
            </div>
            <p style="color: #94a3b8; line-height: 1.7; margin: 0 0 16px;">Bonjour ${prenom}, cela fait un petit moment que nous n'avons pas eu le plaisir de vous voir chez nos partenaires.</p>
            <p style="color: #94a3b8; line-height: 1.7;">Il ne vous reste que <strong style="color: #f8fafc;">${joursRestants} jours</strong> pour réserver et conserver vos <strong style="color: #f8fafc;">${nbJokers} Joker${nbJokers > 1 ? 's' : ''}</strong> !</p>
          `),
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    alertesDouces,
    alertesUrgences,
    declasses,
    total: users?.length || 0,
  });
}
