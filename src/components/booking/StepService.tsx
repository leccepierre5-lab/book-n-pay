'use client';
import { useState } from 'react';
import type { BusinessWithDetails } from '@/lib/queries/catalog';
import type { Service, Staff } from '@/lib/database.types';

export default function StepService({
  business,
  onSelect,
}: {
  business: BusinessWithDetails;
  onSelect: (service: Service, staff: Staff | null) => void;
}) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);

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

  return (
    <div className="space-y-2.5">
      {business.services.map((service) => (
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
              <p className="text-[10px] text-slate-600 mt-0.5">acompte {service.deposit}€</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
