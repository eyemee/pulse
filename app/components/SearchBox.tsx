"use client";

import { useEffect, useRef, useState } from "react";
import { searchPlaces, type Place } from "@/lib/places";
import { CloseIcon, SearchIcon } from "./icons";

// "Fly to a place": type a city or country, the globe flies there so you can
// see who's around. Only moves the camera; your own light never moves.
export default function SearchBox({ onPick }: { onPick: (place: Place) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"idle" | "searching" | "empty">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced lookup as you type (clearing short queries happens in onChange).
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    const ctrl = new AbortController();
    const id = window.setTimeout(async () => {
      setStatus("searching");
      try {
        const found = await searchPlaces(q, ctrl.signal);
        setResults(found);
        setActive(0);
        setStatus(found.length ? "idle" : "empty");
      } catch {
        if (!ctrl.signal.aborted) setStatus("empty");
      }
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [query, open]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setStatus("idle");
  }

  function pick(place: Place | undefined) {
    if (!place) return;
    onPick(place);
    close();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Search for a place"
        title="Search for a place"
        className="glass pointer-events-auto grid h-11 w-11 place-items-center rounded-full text-moon transition hover:bg-white/10"
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-30 sm:static sm:w-80">
      <div className="glass-solid rise relative rounded-3xl">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            pick(results[active]);
          }}
          className="flex items-center gap-2 py-1.5 pl-4 pr-1.5"
        >
          <SearchIcon className="shrink-0 text-mist" width={18} height={18} />
          <label htmlFor="place-search" className="sr-only">
            Search for a place
          </label>
          <input
            id="place-search"
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 2) {
                setResults([]);
                setStatus("idle");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
            }}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="place-results"
            aria-activedescendant={results.length ? `place-${active}` : undefined}
            autoComplete="off"
            placeholder="Fly to a city or country"
            className="h-9 min-w-0 flex-1 bg-transparent text-[0.94rem] text-moon outline-none placeholder:text-mist/70 focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-mist transition hover:bg-white/10 hover:text-moon"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </form>

        {(results.length > 0 || status !== "idle") && (
          <ul
            id="place-results"
            role="listbox"
            className="border-t border-hairline px-1.5 py-1.5"
          >
            {status === "searching" && results.length === 0 && (
              <li className="px-3 py-2 text-sm text-mist">Searching…</li>
            )}
            {status === "empty" && (
              <li className="px-3 py-2 text-sm text-mist">No places match that. Try a city name.</li>
            )}
            {results.map((r, i) => (
              <li key={`${r.name}-${r.lat}-${r.lng}`} id={`place-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r)}
                  className={`flex w-full flex-col items-start rounded-2xl px-3 py-2 text-left transition ${
                    i === active ? "bg-white/[0.08]" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-moon">{r.name}</span>
                  {r.context && <span className="text-xs text-mist">{r.context}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
