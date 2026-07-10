'use client';
import { useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';

type GenreTab = 'all' | 'homme' | 'femme' | 'enfants';
type EnfantsSubTab = 'all' | 'garcon' | 'fille';

const ENFANTS_GENRES = ['enfants', 'garcon', 'fille'];

function filterServices(
  services: Service[],
  tab: GenreTab,
  subTab: EnfantsSubTab,
): Service[] {
  if (tab === 'all') return services;
  if (tab === 'homme') return services.filter((s) => s.genre === 'homme');
  if (tab === 'femme') return services.filter((s) => s.genre === 'femme');
  if (tab === 'enfants') {
    const base = services.filter((s) => s.genre && ENFANTS_GENRES.includes(s.genre));
    if (subTab === 'all') return base;
    if (subTab === 'garcon') return base.filter((s) => s.genre === 'garcon' || s.genre === 'enfants');
    if (subTab === 'fille') return base.filter((s) => s.genre === 'fille' || s.genre === 'enfants');
  }
  return services;
}

export default function StepService({
  business,
  onSelect,
}: {
  business: BusinessWithDetails;
  onSelect: (service: Service, staff: Staff | null) => void;
}) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [activeTab, setActiveTab] = useState<GenreTab>('all');
  const [enfantsSubTab, setEnfantsSubTab] = useState<EnfantsSubTab>('all');

  const services = business.services;

  const hasHomme = services.some((s) => s.genre === 'homme');
  const hasFemme = services.some((s) => s.genre === 'femme');
  const hasEnfants = services.some((s) => s.genre && ENFANTS_GENRES.includes(s.genre));
  const hasAnyGenre = hasHomme || hasFemme || hasEnfants;

  const hasGarcon = services.some((s) => s.genre === 'garcon');
  const hasFille = services.some((s) => s.genre === 'fille');
  const showEnfantsSub = activeTab === 'enfants' && (hasGarcon || hasFille);

  const visible = filterServices(services, activeTab, enfantsSubTab);

  // ── Sélection praticien ─────────────────────────────────────────────────────
  if (selectedService && business.staff.length > 0) {
    return (
      <div>
        <p className="mb-3 text-xs text-slate-500 font-medium uppercase tracking-widest">Choisir un praticien</p>
        <div className="space-y-2">
          <button
            onClick={() => onSelect(selectedService, null)}
            className="w-full flex items-center gap-3 rounded-2xl bg-navy-900 border border-white/[0.08] p-4 text-left hover:bg-navy-800/80 hover:border-white/12 transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-700/40 border border-white/[0.06] flex items-center justify-center text-lg">
              🎲
            </div>
            <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Pas de préférence</span>
          </button>
          {business.staff.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(selectedService, s)}
              className="flex w-full items-center gap-3 rounded-2xl bg-navy-900 border border-white/[0.08] p-4 text-left hover:bg-navy-800/80 hover:border-white/12 transition-all duration-200 group"
            >
              <div className="w-10 h-10 rounded-xl bg-navy-800 border border-white/[0.06] flex items-center justify-center text-lg">
                {s.emoji}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{s.name}</p>
                {s.role && <p className="text-xs text-slate-500 mt-0.5">{s.role}</p>}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={() => setSelectedService(null)}
          className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Changer de prestation
        </button>
      </div>
    );
  }

  // ── Liste des prestations ────────────────────────────────────────────────────
  return (
    <div>
      {/* Onglets genre */}
      {hasAnyGenre && (
        <div className="mb-4 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
            {[
              { id: 'all' as GenreTab, label: 'Tout' },
              ...(hasHomme ? [{ id: 'homme' as GenreTab, label: 'Homme' }] : []),
              ...(hasFemme ? [{ id: 'femme' as GenreTab, label: 'Femme' }] : []),
              ...(hasEnfants ? [{ id: 'enfants' as GenreTab, label: 'Enfants' }] : []),
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setEnfantsSubTab('all');
                }}
                className={`flex-none px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                  activeTab === tab.id
                    ? 'bg-mint-500 text-navy-950'
                    : 'bg-white/[0.06] text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sous-onglets Enfants */}
          {showEnfantsSub && (
            <div className="flex gap-1.5 ml-1">
              {[
                { id: 'all' as EnfantsSubTab, label: 'Tous' },
                ...(hasGarcon ? [{ id: 'garcon' as EnfantsSubTab, label: 'Garçon' }] : []),
                ...(hasFille ? [{ id: 'fille' as EnfantsSubTab, label: 'Fille' }] : []),
              ].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setEnfantsSubTab(sub.id)}
                  className={`flex-none px-3 py-1 rounded-full text-[11px] font-medium transition-all duration-150 ${
                    enfantsSubTab === sub.id
                      ? 'bg-mint-500/20 text-mint-300 ring-1 ring-mint-500/30'
                      : 'bg-white/[0.04] text-slate-500 hover:text-slate-300 hover:bg-white/[0.08]'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Liste */}
      {visible.length === 0 ? (
        <p className="text-center text-sm text-slate-500 py-8">Aucune prestation dans cette catégorie.</p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((service) => (
            <button
              key={service.id}
              onClick={() => {
                if (business.staff.length > 0) {
                  setSelectedService(service);
                } else {
                  onSelect(service, null);
                }
              }}
              className="flex w-full items-center justify-between rounded-2xl bg-navy-900 border border-white/[0.08] p-4 text-left hover:bg-navy-800/80 hover:border-mint-500/20 transition-all duration-200 group"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white group-hover:text-mint-100 transition-colors">{service.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {service.duration_minutes} min
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className={`text-sm font-bold ${service.price > 0 ? 'text-mint-400' : 'text-slate-400'}`}>
                  {service.price > 0 ? `${service.price}€` : 'Gratuit'}
                </p>
                {service.deposit > 0 && (
                  <p className="text-[10px] text-slate-600 mt-0.5">frais résa {service.deposit}€</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
