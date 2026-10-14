"use client";

import { useState } from "react";
import { searchPlaces } from "@/lib/places";

// The entry screen sits over the live globe (which idles and spins behind
// it), so the first thing anyone sees is the world, not a form.
// Test mode: ?at=Tokyo (or ?at=35.68,139.69) joins as if you were there,
// skipping the location prompt. Handy for one person playing several users
// in different windows. It doesn't change what's trustworthy: a browser's
// reported location can be faked with DevTools anyway.
function parseCoords(at: string): { lat: number; lng: number } | null {
  const m = at.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export default function EntryGate({
  online,
  testPlace,
  onReady,
}: {
  online: number | null; // people on right now, or null while unknown
  testPlace: string | null; // from ?at=
  onReady: (lat: number, lng: number) => Promise<void> | void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  async function enterAt(place: string) {
    setStatus("locating");
    try {
      const coords = parseCoords(place) ?? (await searchPlaces(place))[0];
      if (!coords) {
        setStatus("error");
        setError(`Couldn't find "${place}". Try a city name, or remove ?at= to use your real location.`);
        return;
      }
      await onReady(coords.lat, coords.lng);
    } catch {
      setStatus("error");
      setError("Couldn't reach Pulse. Check your connection and try again.");
    }
  }

  function enter() {
    if (testPlace) {
      void enterAt(testPlace);
      return;
    }
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("This browser can't share a location, which Pulse needs to place your light.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        Promise.resolve(onReady(pos.coords.latitude, pos.coords.longitude)).catch(() => {
          setStatus("error");
          setError("Couldn't reach Pulse. Check your connection and try again.");
        });
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this site. Allow it in the address bar, then try again."
            : "Couldn't find your location. Try again, or check that location services are on.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const countLine =
    online === null
      ? null
      : online === 0
        ? "No one's on right now. Yours could be the first light."
        : online === 1
          ? "1 light is on right now."
          : `${online.toLocaleString("en-US")} lights are on right now.`;

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-[radial-gradient(120%_90%_at_0%_100%,rgba(8,17,40,0.95)_20%,rgba(8,17,40,0.55)_55%,rgba(8,17,40,0.1)_100%)] sm:items-center">
      <section className="rise w-full max-w-xl px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-14 sm:pb-0">
        <p className="mb-10 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-moon">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="pulse-dot pointer-events-none !h-2.5 !w-2.5" aria-hidden="true" />
          </span>
          pulse
        </p>

        <h1 className="text-[2.6rem] font-light leading-[1.05] tracking-[-0.02em] text-moon sm:text-6xl">
          Strangers, lit up across the night.
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed text-mist sm:text-lg">
          Every light is someone online right now. Tap one to ask for a chat. If they say yes, you
          talk by text or video, and nothing is kept.
        </p>

        {countLine && (
          <p className="mt-6 flex items-start gap-2 text-sm leading-5 text-moon" aria-live="polite">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber shadow-[0_0_8px_2px_rgba(255,180,92,0.7)]" />
            {countLine}
          </p>
        )}

        <button
          onClick={enter}
          disabled={status === "locating"}
          className="mt-8 inline-flex h-13 items-center justify-center rounded-full bg-amber px-8 text-base font-semibold text-orbit shadow-[0_0_32px_rgba(255,180,92,0.35)] transition hover:bg-[#ffc37a] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
        >
          {status === "locating" ? "Finding you…" : "Put me on the map"}
        </button>

        {testPlace && (
          <p className="mt-3 max-w-md text-sm text-aurora">
            Test mode: you&rsquo;ll join near {testPlace}. Remove <code>?at=</code> from the address
            to use your real location.
          </p>
        )}

        {status === "error" && (
          <p role="alert" className="mt-4 max-w-md text-sm leading-relaxed text-signal">
            {error}
          </p>
        )}

        <p className="mt-8 max-w-sm text-xs leading-relaxed text-mist/80">
          Your light is placed 1–3 km from where you are, in a new spot every visit. No account, no
          history. Close the tab and you&rsquo;re gone.
        </p>
      </section>
    </div>
  );
}
