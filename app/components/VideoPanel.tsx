"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "./icons";

// Full-screen call. Their video fills the frame; yours sits in a small
// rounded tile. Controls float at the bottom in a glass bar.
export default function VideoPanel({
  localStream,
  remoteStream,
  onToggleMic,
  onToggleCamera,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onToggleMic: (enabled: boolean) => void;
  onToggleCamera: (enabled: boolean) => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

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
    <div className="absolute inset-0 z-50 bg-orbit" role="dialog" aria-label="Video call">
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className="h-full w-full object-cover"
      />
      {!remoteStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-mist">
          <span className="ripple relative grid h-14 w-14 place-items-center rounded-full">
            <span className="pulse-dot pointer-events-none" aria-hidden="true" />
          </span>
          <p className="text-sm">Waiting for their camera…</p>
        </div>
      )}

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
