"use client";

import { useEffect, useRef } from "react";

// A request that needs an answer: "someone wants to talk" or "they'd like
// to turn on video". Sits low on the screen (thumb reach on phones) without
// hiding the globe, with a rippling light so it reads as a live person.
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  timeoutMs,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  timeoutMs?: number; // shows a draining bar when the request will expire
  onAccept: () => void;
  onDecline: () => void;
}) {
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    acceptRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecline();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDecline]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6">
      <div
        role="alertdialog"
        aria-labelledby="prompt-title"
        aria-describedby={subtitle ? "prompt-subtitle" : undefined}
        className="glass rise pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-3xl p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-4">
          <span className="ripple relative grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <span className="pulse-dot pointer-events-none" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="prompt-title" className="text-base font-semibold text-moon">
              {title}
            </h2>
            {subtitle && (
              <p id="prompt-subtitle" className="mt-0.5 text-sm text-mist">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            onClick={onDecline}
            className="h-11 rounded-full border border-hairline px-4 text-sm font-medium text-moon transition hover:bg-white/5"
          >
            {declineLabel}
          </button>
          <button
            ref={acceptRef}
            onClick={onAccept}
            className="h-11 rounded-full bg-amber px-4 text-sm font-semibold text-orbit transition hover:bg-[#ffc37a] active:scale-[0.98]"
          >
            {acceptLabel}
          </button>
        </div>

        {timeoutMs ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-amber/70"
            style={{ animation: `drain ${timeoutMs}ms linear forwards` }}
          />
        ) : null}
      </div>
      <style>{`@keyframes drain { from { transform: scaleX(1) } to { transform: scaleX(0) } }`}</style>
    </div>
  );
}
