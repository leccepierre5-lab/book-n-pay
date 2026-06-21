'use client';
// src/components/booking/StepService.tsx
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
        <p className="mb-3 text-sm text-white/60">Choisis ton praticien (optionnel)</p>
        <div className="space-y-2">
          <button
            onClick={() => onSelect(selectedService, null)}
            className="w-full rounded-xl bg-navy-900 p-4 text-left hover:bg-navy-800"
          >
            <span className="text-sm text-white">Pas de préférence</span>
          </button>
          {business.staff.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(selectedService, s)}
              className="flex w-full items-center gap-3 rounded-xl bg-navy-900 p-4 text-left hover:bg-navy-800"
            >
              <span className="text-xl">{s.emoji}</span>
              <div>
                <p className="text-sm font-medium text-white">{s.name}</p>
                {s.role && <p className="text-xs text-white/50">{s.role}</p>}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={() => setSelectedService(null)}
          className="mt-3 text-sm text-white/50 hover:text-white"
        >
          ← Changer de prestation
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
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
          className="flex w-full items-center justify-between rounded-xl bg-navy-900 p-4 text-left hover:bg-navy-800"
        >
          <div>
            <p className="text-sm font-medium text-white">{service.name}</p>
            <p className="text-xs text-white/50">{service.duration_minutes} min</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-mint-400">
              {service.price > 0 ? `${service.price}€` : 'Gratuit'}
            </p>
            {service.deposit > 0 && (
              <p className="text-xs text-white/40">dépôt {service.deposit}€</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
