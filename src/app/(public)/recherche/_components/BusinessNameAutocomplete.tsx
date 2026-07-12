'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BusinessWithDetails } from '@/lib/queries/catalog';

type Suggestion =
  | { kind: 'business'; name: string; slug: string }
  | { kind: 'prestation'; name: string };

const MIN_CHARS = 2;
const MAX_PER_GROUP = 5;

export function BusinessNameAutocomplete({
  defaultValue,
  businesses,
}: {
  defaultValue?: string;
  businesses: BusinessWithDetails[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const trimmedLower = value.trim().toLowerCase();

  // Filtre pur sur les données déjà chargées par la page (page.tsx passe le
  // même `businesses` que SearchResults reçoit déjà — aucune requête réseau
  // supplémentaire ici, recalculé à chaque frappe via useMemo). Le scope suit
  // volontairement les filtres actifs (catégorie/ville/q déjà appliqués par
  // searchBusinesses côté serveur) plutôt que tout le catalogue.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (trimmedLower.length < MIN_CHARS) return [];

    const businessMatches: Suggestion[] = businesses
      .filter((b) => b.name.toLowerCase().startsWith(trimmedLower))
      .slice(0, MAX_PER_GROUP)
      .map((b) => ({ kind: 'business', name: b.name, slug: b.slug }));

    const seen = new Set<string>();
    const prestationMatches: Suggestion[] = [];
    outer: for (const b of businesses) {
      for (const s of b.services ?? []) {
        const key = s.name.toLowerCase();
        if (key.startsWith(trimmedLower) && !seen.has(key)) {
          seen.add(key);
          prestationMatches.push({ kind: 'prestation', name: s.name });
          if (prestationMatches.length >= MAX_PER_GROUP) break outer;
        }
      }
    }

    return [...businessMatches, ...prestationMatches];
  }, [businesses, trimmedLower]);

  const showNoResults = trimmedLower.length >= MIN_CHARS && suggestions.length === 0;
  const showPanel = open && trimmedLower.length >= MIN_CHARS && (suggestions.length > 0 || showNoResults);

  const selectSuggestion = (s: Suggestion) => {
    setOpen(false);
    setActiveIndex(-1);
    if (s.kind === 'business') {
      router.push(`/business/${s.slug}`);
    } else {
      router.push(`/recherche?q=${encodeURIComponent(s.name)}`);
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
        selectSuggestion(suggestions[activeIndex]);
      }
      // Sinon : laisse le comportement natif soumettre le formulaire (recherche
      // mixte name/city/type existante, préservée pour qui ne choisit aucune
      // suggestion).
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
      className="relative flex-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        ref={inputRef}
        type="text"
        name="q"
        aria-label="Recherche un professionnel"
        role="combobox"
        aria-expanded={showPanel}
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
        onFocus={() => trimmedLower.length >= MIN_CHARS && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Recherche un professionnel"
        className="w-full rounded-xl bg-navy-900 border border-white/[0.08] pl-10 pr-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200"
      />
      {showPanel && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl bg-navy-900 border border-white/[0.08] shadow-lg py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.kind === 'business' ? `b-${s.slug}` : `p-${s.name}`}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3.5 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                i === activeIndex ? 'bg-mint-500/15 text-mint-300' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className="text-xs opacity-60">{s.kind === 'business' ? '🏢' : '✨'}</span>
              {s.name}
            </li>
          ))}
          {showNoResults && (
            <li role="presentation" className="px-3.5 py-2 text-sm text-slate-500">
              Aucun résultat — Entrée lance quand même la recherche sur ce texte
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
