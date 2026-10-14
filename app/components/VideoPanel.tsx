"use client";

import { useEffect, useRef, useState } from "react";
import { BlockIcon, EyeIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "./icons";

// Full-screen call. Their video fills the frame; yours sits in a small
// rounded tile. Controls float at the bottom in a glass bar.
//
// Reveal-to-see: their video arrives blurred and stays blurred until you
// choose to look. Accepting a video call with a stranger shouldn't mean
// seeing whatever they point the camera at. When you reveal, they're told,
// so both sides know who can see whom.
export default function VideoPanel({
  localStream,
  remoteStream,
  theyRevealed,
  onReveal,
  onToggleMic,
  onToggleCamera,
  onBlock,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  theyRevealed: boolean; // they've unblurred your video
  onReveal: () => void;
  onToggleMic: (enabled: boolean) => void;
  onToggleCamera: (enabled: boolean) => void;
  onBlock: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const ctrl =
    "grid h-12 w-12 place-items-center rounded-full border border-hairline text-moon transition hover:bg-white/10";

  return (
    <div className="absolute inset-0 z-50 overflow-hidden bg-orbit" role="dialog" aria-label="Video call">
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        data-revealed={revealed}
        className={`h-full w-full object-cover transition-[filter,transform] duration-700 ${
          revealed ? "" : "scale-110 blur-[36px] brightness-75"
        }`}
      />

      {!remoteStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-mist">
          <span className="ripple relative grid h-14 w-14 place-items-center rounded-full">
            <span className="pulse-dot pointer-events-none" aria-hidden="true" />
          </span>
          <p className="text-sm">Waiting for their camera…</p>
        </div>
      )}

      {remoteStream && !revealed && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="glass-solid rise max-w-xs rounded-3xl p-5 text-center">
            <p className="font-semibold text-moon">Their video is hidden</p>
            <p className="mt-1.5 text-sm leading-relaxed text-mist">
              It stays blurred until you choose to see it. They&rsquo;ll know when you do.
            </p>
            <button
              onClick={() => {
                setRevealed(true);
                onReveal();
              }}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-amber px-5 text-sm font-semibold text-orbit transition hover:bg-[#ffc37a]"
            >
              <EyeIcon width={18} height={18} />
              Reveal video
            </button>
          </div>
        </div>
      )}

      {/* Who can see whom */}
      <p
        role="status"
        className="glass absolute left-4 top-[max(1rem,env(safe-area-inset-top))] max-w-[60vw] rounded-full px-3.5 py-2 text-xs text-moon"
      >
        <span
          className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${
            theyRevealed ? "bg-aurora" : "bg-mist"
          }`}
        />
        {theyRevealed ? "They can see you" : "You're blurred until they reveal you"}
      </p>

      {/* Your camera */}
      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] h-40 w-28 overflow-hidden rounded-2xl border border-hairline bg-ocean shadow-[0_12px_40px_rgba(0,0,0,0.5)] sm:h-48 sm:w-36">
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full -scale-x-100 object-cover transition-opacity ${camOn ? "opacity-100" : "opacity-0"}`}
        />
        {!camOn && (
          <span className="absolute inset-0 grid place-items-center text-xs text-mist">Camera off</span>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-center p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="glass flex items-center gap-3 rounded-full p-2 pl-3">
          <button
            onClick={() => {
              const next = !micOn;
              setMicOn(next);
              onToggleMic(next);
            }}
            aria-pressed={!micOn}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            title={micOn ? "Mute" : "Unmute"}
            className={`${ctrl} ${micOn ? "" : "bg-white/15"}`}
          >
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </button>
          <button
            onClick={() => {
              const next = !camOn;
              setCamOn(next);
              onToggleCamera(next);
            }}
            aria-pressed={!camOn}
            aria-label={camOn ? "Turn camera off" : "Turn camera on"}
            title={camOn ? "Camera off" : "Camera on"}
            className={`${ctrl} ${camOn ? "" : "bg-white/15"}`}
          >
            {camOn ? <VideoIcon /> : <VideoOffIcon />}
          </button>
          <button
            onClick={onBlock}
            aria-label="Block this person"
            title="Block: ends the call and you won't see each other again"
            className={`${ctrl} text-mist hover:text-signal`}
          >
            <BlockIcon />
          </button>
          <button
            onClick={onEnd}
            className="h-12 rounded-full bg-signal px-6 text-sm font-semibold text-orbit transition hover:brightness-110"
          >
            End video
          </button>
        </div>
      </div>
    </div>
  );
}
