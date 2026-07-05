'use client';

import { useId, useRef, useState } from 'react';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const MAX_SUGGESTIONS = 8;

export function CityAutocomplete({
  cities,
  defaultValue,
}: {
  cities: string[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const suggestions =
    value.trim().length > 0
      ? cities.filter((c) => normalize(c).includes(normalize(value))).slice(0, MAX_SUGGESTIONS)
      : [];
  const showNoResults = open && value.trim().length > 0 && suggestions.length === 0;

  const selectCity = (city: string) => {
    setValue(city);
    setOpen(false);
    setActiveIndex(-1);
    // Une suggestion cliquée/validée lance la recherche directement, comme les
    // autres filtres (catégorie) qui naviguent immédiatement. On force la valeur
    // DOM avant de soumettre : setValue() ne committe qu'au prochain rendu React,
    // trop tard pour que requestSubmit() la voie de façon fiable.
    if (inputRef.current) {
      inputRef.current.value = city;
      inputRef.current.form?.requestSubmit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1 >= suggestions.length ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i - 1 < 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        selectCity(suggestions[activeIndex]);
      }
      // Sinon : laisse le comportement natif soumettre le formulaire tel quel
      // (recherche libre sur le texte saisi, y compris sans suggestion correspondante).
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/>
      </svg>
      <input
        ref={inputRef}
        type="text"
        name="city"
        aria-label="Filtrer par ville"
        role="combobox"
        aria-expanded={open && (suggestions.length > 0 || showNoResults)}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => value.trim().length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Filtrer par ville..."
        className="w-full rounded-xl bg-navy-900 border border-white/[0.08] pl-10 pr-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200"
      />
      {open && (suggestions.length > 0 || showNoResults) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl bg-navy-900 border border-white/[0.08] shadow-lg py-1"
        >
          {suggestions.map((city, i) => (
            <li
              key={city}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectCity(city)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3.5 py-2 text-sm cursor-pointer transition-colors ${
                i === activeIndex ? 'bg-mint-500/15 text-mint-300' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {city}
            </li>
          ))}
          {showNoResults && (
            <li role="presentation" className="px-3.5 py-2 text-sm text-slate-500">
              Aucune ville trouvée — Entrée lance quand même la recherche sur ce texte
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
