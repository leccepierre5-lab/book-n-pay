'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const DELETE_CONFIRM_PHRASE = 'supprimer mon compte';

// Messages adaptés par code d'erreur structuré renvoyé par la route — voir
// api/pro/delete-account/route.ts pour la liste exacte des codes possibles.
// Les codes financiers (pending_charges/pending_overage/stripe_balance)
// restent volontairement génériques côté UI : le détail exact (montant,
// origine) n'a pas besoin d'être exposé ici, contacter le support suffit.
function errorMessageFor(code: string | undefined, count?: number): string {
  switch (code) {
    case 'upcoming_bookings':
      return `Vous avez ${count ?? 'des'} réservation${count && count > 1 ? 's' : ''} à venir non annulée${count && count > 1 ? 's' : ''}. Annulez-les d'abord depuis votre calendrier.`;
    case 'pending_charges':
    case 'pending_overage':
      return 'Des frais restent dus à Book\'nPay sur votre compte. Contactez le support pour régulariser avant de supprimer votre compte.';
    case 'stripe_balance':
      return 'Un solde est encore disponible ou en attente de virement sur votre compte Stripe. Attendez le prochain virement avant de supprimer votre compte.';
    default:
      return '';
  }
}

export default function DeleteProAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isConfirmValid = confirmText.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/pro/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(errorMessageFor(body.error, body.count) || body.error || 'Erreur');
      return;
    }
    await createClient().auth.signOut();
    window.location.href = '/?compte-supprime=1';
  };

  if (!open) {
    return (
      <div className="mt-4 rounded-xl border border-red-500/20 bg-navy-900 p-4">
        <p className="text-[13px] font-semibold text-red-400">Supprimer mon compte</p>
        <p className="mt-1 text-xs text-white/50">
          Ferme définitivement votre établissement et votre compte Book&apos;nPay.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg bg-red-950/40 border border-red-500/20 px-3.5 py-2 text-xs font-semibold text-red-400 hover:bg-red-950/60"
        >
          Supprimer mon compte
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-red-500/20 bg-navy-900 p-4">
      <p className="text-[13px] font-semibold text-red-400">Supprimer mon compte</p>
      <p className="text-xs text-white/60 leading-relaxed">Cette action est irréversible :</p>
      <ul className="text-xs text-white/60 leading-relaxed list-disc pl-4 space-y-1">
        <li>
          Votre <strong className="text-white">abonnement Book&apos;nPay est résilié immédiatement — le mois en
          cours n&apos;est pas remboursé</strong>.
        </li>
        <li>
          Votre <strong className="text-white">fiche établissement</strong> disparaît du public immédiatement.
        </li>
        <li>
          Vos <strong className="text-white">réservations passées</strong> sont conservées anonymisées (nom
          d&apos;établissement et de praticien effacés) pour les obligations légales de facturation.
        </li>
        <li>
          Services, équipe, photos, avis et favoris de votre établissement sont
          <strong className="text-white"> définitivement supprimés</strong>.
        </li>
        <li>
          Votre <strong className="text-white">compte de connexion</strong> est supprimé — vous ne pourrez plus
          vous reconnecter avec cet email.
        </li>
      </ul>

      <input
        type="password"
        placeholder="Ton mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-xl bg-navy-950 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-mint-500/40 focus:ring-1 focus:ring-mint-500/15 transition-all"
      />

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          Recopiez <strong className="text-white">« {DELETE_CONFIRM_PHRASE} »</strong> pour confirmer
        </label>
        <input
          type="text"
          placeholder={DELETE_CONFIRM_PHRASE}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full rounded-xl bg-navy-950 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-mint-500/40 focus:ring-1 focus:ring-mint-500/15 transition-all"
        />
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={handleDelete}
        disabled={loading || !password || !isConfirmValid}
        className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 transition-colors"
      >
        {loading ? '...' : 'Confirmer la suppression définitive'}
      </button>
      <button
        onClick={() => { setOpen(false); setError(null); setPassword(''); setConfirmText(''); }}
        className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors"
      >
        Annuler
      </button>
    </div>
  );
}
