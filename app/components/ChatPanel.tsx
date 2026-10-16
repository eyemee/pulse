"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_CHARS } from "@/lib/webrtc";
import { BlockIcon, SendIcon, VideoIcon } from "./icons";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

// Floating glass panel on the right on desktop; a bottom sheet on phones so
// the globe (and the arc to the other person) stays visible above it.
export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  distanceLabel,
  onSend,
  onStartVideo,
  onBlock,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  distanceLabel: string | null;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onBlock: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (connected) inputRef.current?.focus({ preventScroll: true });
  }, [connected]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <aside
      aria-label="Chat with stranger"
      className="glass-solid slide-in absolute inset-x-0 bottom-0 z-30 flex h-[min(70dvh,calc(100dvh-140px))] flex-col rounded-t-3xl shadow-[0_-20px_60px_rgba(0,0,0,0.45)] sm:inset-x-auto sm:inset-y-4 sm:right-4 sm:h-auto sm:w-[380px] sm:rounded-3xl"
    >
      <header className="flex items-center gap-1.5 border-b border-hairline py-3 pl-3 pr-2.5 sm:gap-2 sm:py-4 sm:pl-4 sm:pr-3">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5">
          <span className="pulse-dot pointer-events-none" data-active="true" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-moon">Stranger</p>
          {/* One line: on a phone there's ~130px beside the buttons, and the
              distance used to wrap the header to three lines. */}
          <p className="truncate text-xs text-mist">
            <span className={connected ? "text-aurora" : undefined}>
              {connected ? "Connected" : "Connecting…"}
            </span>
            {distanceLabel && <span title={distanceLabel}> · {distanceLabel.replace(/^About /, "~").replace(/ away$/, "")}</span>}
          </p>
        </div>
        <button
          onClick={onStartVideo}
          disabled={!connected || videoBusy}
          aria-label="Start video"
          title="Start video"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-hairline text-moon sm:h-10 sm:w-10 transition hover:bg-white/5 disabled:opacity-35"
        >
          <VideoIcon />
        </button>
        <button
          onClick={onBlock}
          aria-label="Block this person"
          title="Block: ends the chat and you won't see each other again"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-hairline text-mist sm:h-10 sm:w-10 transition hover:border-signal/40 hover:text-signal"
        >
          <BlockIcon />
        </button>
        <button
          onClick={onEnd}
          className="h-9 shrink-0 rounded-full border border-signal/40 px-3 sm:h-10 sm:px-3.5 text-sm font-medium text-signal transition hover:bg-signal/10"
        >
          End chat
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.length === 0 && (
          <p className="mx-auto mt-6 max-w-[16rem] text-center text-sm leading-relaxed text-mist">
            {connected
              ? "You're connected. Messages go straight to them and aren't saved anywhere."
              : "Opening a direct line to their browser…"}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <span
              className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[0.94rem] leading-snug ${
                m.mine
                  ? "rounded-br-md bg-amber text-orbit"
                  : "rounded-bl-md bg-white/[0.07] text-moon"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-hairline p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_CHARS}
          autoComplete="off"
          placeholder={connected ? "Say something…" : "Connecting…"}
          disabled={!connected}
          className="h-11 flex-1 rounded-full bg-white/[0.06] px-4 text-[0.94rem] text-moon outline-none placeholder:text-mist/70 focus:bg-white/[0.09] focus:ring-1 focus:ring-aurora/60 focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!connected || !draft.trim()}
          className="grid h-11 w-11 place-items-center rounded-full bg-amber text-orbit transition hover:bg-[#ffc37a] disabled:opacity-35"
        >
          <SendIcon />
        </button>
      </form>
    </aside>
  );
}
