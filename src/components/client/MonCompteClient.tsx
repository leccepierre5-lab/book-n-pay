'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { AppUser, EnrichedReferralEvent } from '@/lib/database.types';
import LoyaltyCard from '@/components/loyalty/LoyaltyCard';
import ParrainageCard from '@/components/loyalty/ParrainageCard';

type Section = 'main' | 'password' | 'delete';

const inputClass = "w-full rounded-xl bg-navy-950 border border-white/[0.08] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-mint-500/40 focus:ring-1 focus:ring-mint-500/15 transition-all";

const DELETE_CONFIRM_PHRASE = 'supprimer mon compte';

export default function MonCompteClient({
  profile,
  email,
  referralEvents,
  initialReset,
  upcomingBookingsCount,
}: {
  profile: AppUser;
  email: string;
  referralEvents: EnrichedReferralEvent[];
  initialReset: boolean;
  upcomingBookingsCount: number;
}) {
  const [section, setSection] = useState<Section>(initialReset ? 'password' : 'main');

  // ── Changer le mot de passe ──
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // ── Supprimer le compte ──
  // Un seul écran (plus d'étape 1/2) : le blocage sur RDV à venir remplace
  // l'ancienne étape 1, la saisie du mot de passe + de la phrase de
  // confirmation forment l'unique écran de confirmation restant.
  const [deletePw, setDeletePw] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isDeleteConfirmValid = deleteConfirmText.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwError('Les mots de passe ne correspondent pas.'); return; }
    if (newPw.length < 6) { setPwError('6 caractères minimum.'); return; }
    setPwLoading(true); setPwError(null);

    if (initialReset) {
      // Session recovery déjà établie par verifyOtp — updateUser direct, sans re-auth
      const { error } = await createClient().auth.updateUser({ password: newPw });
      setPwLoading(false);
      if (error) { setPwError(error.message); return; }
      setPwSuccess(true);
      setNewPw(''); setConfirmPw('');
      return;
    }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const d = await res.json().catch(() => ({}));
    setPwLoading(false);
    if (!res.ok) { setPwError(d.error || 'Erreur'); return; }
    setPwSuccess(true);
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true); setDeleteError(null);
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: deletePw }),
    });
    const d = await res.json().catch(() => ({}));
    setDeleteLoading(false);
    if (!res.ok) {
      // 409 upcoming_bookings : course entre le chargement de la page (où
      // upcomingBookingsCount valait 0) et la soumission — un RDV a été pris
      // entre-temps. Le serveur reste l'autorité, le blocage client n'était
      // qu'un raccourci UX.
      setDeleteError(
        d.error === 'upcoming_bookings'
          ? 'Un rendez-vous a été ajouté depuis l’ouverture de cette page — rechargez et réessayez.'
          : d.error || 'Erreur'
      );
      return;
    }
    // Déconnexion côté client puis redirect
    await createClient().auth.signOut();
    window.location.href = '/?compte-supprime=1';
  };

  const handleLogout = async () => {
    await createClient().auth.signOut();
    window.location.href = '/';
  };

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-lg px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-bold text-mint-500/60 uppercase tracking-widest mb-0.5">Profil</p>
            <h1 className="text-xl font-bold text-white">Mon compte</h1>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-xl bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/15 transition-all"
          >
            Déconnexion
          </button>
        </div>

        {/* Tabs */}
        {section !== 'main' && (
          <button onClick={() => setSection('main')} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            Retour
          </button>
        )}

        {/* ── SECTION MAIN ── */}
        {section === 'main' && (
          <div className="space-y-4">
            {/* Données perso */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] divide-y divide-white/[0.05]">
              <div className="px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-0.5">Nom</p>
                <p className="text-sm text-white">{profile.name}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-0.5">Email</p>
                <p className="text-sm text-white">{email}</p>
              </div>
              {profile.phone && (
                <div className="px-4 py-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-0.5">Téléphone</p>
                  <p className="text-sm text-white">{profile.phone}</p>
                </div>
              )}
            </div>

            {/* Statut Sérénité */}
            <LoyaltyCard profile={profile} />

            {/* Parrainage */}
            <ParrainageCard profile={profile} referralEvents={referralEvents} />

            {/* Actions compte */}
            <div className="rounded-2xl bg-navy-900 border border-white/[0.08] divide-y divide-white/[0.05]">
              <button
                onClick={() => { setSection('password'); setPwSuccess(false); setPwError(null); }}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.03] transition-colors text-left"
              >
                Modifier le mot de passe
                <svg className="w-4 h-4 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <a
                href="/api/auth/export-data"
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.03] transition-colors text-left"
              >
                Télécharger mes données
                <svg className="w-4 h-4 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="7 10 12 15 17 10"/><polyline points="12 15 12 3"/></svg>
              </a>
              <button
                onClick={() => { setSection('delete'); setDeleteError(null); setDeletePw(''); setDeleteConfirmText(''); }}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.04] transition-colors text-left"
              >
                Supprimer mon compte
                <svg className="w-4 h-4 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── SECTION CHANGER MDP ── */}
        {section === 'password' && (
          <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
            <p className="text-sm font-semibold text-white mb-4">Modifier le mot de passe</p>
            {pwSuccess ? (
              <div className="text-center py-4">
                <p className="text-mint-400 font-semibold text-sm">Mot de passe mis à jour ✓</p>
                <button onClick={() => { setSection('main'); setPwSuccess(false); }} className="mt-3 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                  ← Retour
                </button>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3">
                {!initialReset && (
                  <input
                    type="password"
                    placeholder="Mot de passe actuel"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                    className={inputClass}
                  />
                )}
                <input
                  type="password"
                  placeholder="Nouveau mot de passe (6 min.)"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  required
                  minLength={6}
                  className={inputClass}
                />
                <input
                  type="password"
                  placeholder="Confirmer le nouveau mot de passe"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  required
                  className={inputClass}
                />
                {pwError && (
                  <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
                    <p className="text-xs text-red-400">{pwError}</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-navy-950 disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg, #34d399, #6ee7b7)', boxShadow: '0 4px 16px rgba(52,211,153,0.25)' }}
                >
                  {pwLoading ? '...' : 'Enregistrer'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ── SECTION SUPPRIMER COMPTE ── */}
        {section === 'delete' && (
          <div className="rounded-2xl bg-navy-900 border border-red-500/20 p-5">
            <p className="text-sm font-semibold text-red-400 mb-1">Supprimer mon compte</p>

            {upcomingBookingsCount > 0 ? (
              <div>
                <p className="text-xs text-slate-400 leading-relaxed mb-5">
                  Vous avez <strong className="text-white">{upcomingBookingsCount} rendez-vous à venir</strong>.{' '}
                  {upcomingBookingsCount > 1
                    ? "Annulez-les d'abord, ou attendez qu'ils soient passés, avant de supprimer votre compte."
                    : "Annulez-le d'abord, ou attendez qu'il soit passé, avant de supprimer votre compte."}
                </p>
                <div className="flex gap-2">
                  <Link
                    href="/mes-reservations"
                    className="flex-1 text-center rounded-xl py-2.5 text-sm font-semibold text-navy-950 bg-mint-500 hover:bg-mint-400 transition-colors"
                  >
                    Voir mes réservations
                  </Link>
                  <button
                    onClick={() => setSection('main')}
                    className="rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    Retour
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Cette action est <strong className="text-white">irréversible</strong> :
                </p>
                <ul className="text-xs text-slate-400 leading-relaxed list-disc pl-4 space-y-1">
                  <li>
                    Vos <strong className="text-white">réservations passées</strong> sont conservées
                    anonymisées (nom et coordonnées effacés) pour nos obligations légales de facturation.
                  </li>
                  <li>
                    Vos <strong className="text-white">favoris</strong> sont définitivement supprimés.
                  </li>
                  <li>
                    Votre <strong className="text-white">compte de connexion</strong> est supprimé — vous ne
                    pourrez plus vous reconnecter avec cet email.
                  </li>
                </ul>

                <input
                  type="password"
                  placeholder="Ton mot de passe"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  className={inputClass}
                />

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    Recopiez <strong className="text-white">« {DELETE_CONFIRM_PHRASE} »</strong> pour confirmer
                  </label>
                  <input
                    type="text"
                    placeholder={DELETE_CONFIRM_PHRASE}
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {deleteError && (
                  <div className="rounded-xl bg-red-950/40 border border-red-500/20 px-3 py-2.5">
                    <p className="text-xs text-red-400">{deleteError}</p>
                  </div>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || !deletePw || !isDeleteConfirmValid}
                  className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 transition-colors"
                >
                  {deleteLoading ? '...' : 'Confirmer la suppression définitive'}
                </button>
                <button onClick={() => setSection('main')} className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors">
                  Annuler
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
