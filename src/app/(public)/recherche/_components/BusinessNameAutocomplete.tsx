'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Suggestion {
  name: string;
  slug: string;
}

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

export function BusinessNameAutocomplete({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  const trimmed = value.trim();

  // Debounce 300ms + annulation de la requête précédente à chaque nouvelle
  // frappe : si une réponse lente arrive après une plus récente a déjà été
  // lancée, elle est abandonnée (AbortError, ignorée) au lieu d'écraser
  // l'état avec un résultat obsolète.
  useEffect(() => {
    abortRef.current?.abort();

    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetch(`/api/search/business-suggestions?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data: Suggestion[]) => {
          setSuggestions(Array.isArray(data) ? data : []);
          setLoading(false);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const showNoResults = !loading && trimmed.length >= MIN_CHARS && suggestions.length === 0;
  const showPanel = open && trimmed.length >= MIN_CHARS && (loading || suggestions.length > 0 || showNoResults);

  const selectSuggestion = (s: Suggestion) => {
    setOpen(false);
    setActiveIndex(-1);
    router.push(`/business/${s.slug}`);
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
        onFocus={() => trimmed.length >= MIN_CHARS && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Recherche un professionnel"
        className="w-full rounded-xl bg-navy-900 border border-white/[0.08] pl-10 pr-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-mint-500/40 focus:ring-2 focus:ring-mint-500/15 transition-all duration-200"
      />
      {showPanel && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl bg-navy-900 border border-white/[0.08] shadow-lg py-1"
        >
          {loading && (
            <li role="presentation" className="px-3.5 py-2 text-sm text-slate-500">
              Recherche…
            </li>
          )}
          {!loading && suggestions.map((s, i) => (
            <li
              key={s.slug}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3.5 py-2 text-sm cursor-pointer transition-colors ${
                i === activeIndex ? 'bg-mint-500/15 text-mint-300' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {s.name}
            </li>
          ))}
          {!loading && showNoResults && (
            <li role="presentation" className="px-3.5 py-2 text-sm text-slate-500">
              Aucun professionnel trouvé — Entrée lance quand même la recherche sur ce texte
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
