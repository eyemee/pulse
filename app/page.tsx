"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap, { type ArcState, type CameraCommand } from "./components/WorldMap";
import SearchBox from "./components/SearchBox";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { block, join, leave, newSessionSecret, onlineCount, poll, sendSignal } from "@/lib/api";
import { distanceKm, formatDistance, type LatLng } from "@/lib/geo";
import { LinkIcon, LocateIcon, NextIcon } from "./components/icons";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { startTicker } from "@/lib/ticker";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;

const noopSubscribe = () => () => {};
function readTestPlace(): string | null {
  const at = new URLSearchParams(window.location.search).get("at")?.trim();
  return at ? at.slice(0, 80) : null;
}

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  // Private session key: never shown to anyone, only sent in POST bodies.
  // The public id peers see is sha256(secret), computed by the server.
  const [secret] = useState(() => newSessionSecret());
  // Our own public id, as returned by /api/join.
  const myIdRef = useRef<string | null>(null);
  const [peers, setPeers] = useState<PeerDot[]>([]);
  // Other people's live conversations (id pairs), drawn as arcs.
  const [pairs, setPairs] = useState<[string, string][]>([]);
  // People you blocked this session: hidden immediately, before the server's
  // next poll confirms it.
  const blockedRef = useRef<Set<string>>(new Set());
  const [camera, setCamera] = useState<CameraCommand | null>(null);
  const cameraKey = useRef(0);
  const nextIndex = useRef(0);
  // They've unblurred your video (reveal-to-see).
  const [theyRevealed, setTheyRevealed] = useState(false);
  // ?at=Place test mode. Read from the URL on the client; the server render
  // sees null and React swaps in the real value after hydration.
  const testPlace = useSyncExternalStore(
    noopSubscribe,
    () => readTestPlace(),
    () => null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  // Our public position (privacy-offset), as everyone else sees it.
  const [me, setMe] = useState<LatLng | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  // Raw location kept in memory only, so we can re-join if we get reaped.
  const myLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive polls in which our current peer was missing from presence.
  const missingPolls = useRef(0);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  // `notifyPeerId`: send an "end" so the server frees our busy flag. Needed
  // when the other side vanished without hanging up (closed tab, network
  // drop), otherwise we stay "busy" and nobody can request us again.
  function teardown(message?: string, notifyPeerId?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    if (notifyPeerId) void sendSignal(secret, notifyPeerId, "end");
    missingPolls.current = 0;
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setTheyRevealed(false);
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(secret, peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed" && peerRef.current === ps) {
          teardown("Lost the connection to the stranger.", peerId);
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => {
        if (peerRef.current === ps) teardown("Stranger disconnected.", peerId);
      },
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        setTheyRevealed(false);
        break;
      case "video-revealed":
        if (videoRef.current === "active") setTheyRevealed(true);
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(secret, peerId, "request").then((ok) => {
      // Rate-limited (too many requests) or rejected by the server.
      const c = connRef.current;
      if (!ok && c.kind === "requesting" && c.peerId === peerId) {
        teardown("Couldn't send the request. Try again in a moment.");
      }
    });
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(secret, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(secret, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    setConn({ kind: "connecting", peerId });
    void sendSignal(secret, peerId, "accept").then((ok) => {
      // Rejected when they cancelled or timed out just before we clicked.
      const c = connRef.current;
      if (!ok && c.kind === "connecting" && c.peerId === peerId) {
        teardown("They're no longer waiting.");
      }
    });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(secret, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(secret, c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setTheyRevealed(false);
  }

  // Block: end whatever is happening with this person and hide you from each
  // other for the rest of the session (server-enforced, see /api/block).
  function blockPeer(peerId: string) {
    blockedRef.current.add(peerId);
    setPeers((prev) => prev.filter((p) => p.id !== peerId));
    teardown("Blocked. You won't see each other again this session.");
    void block(secret, peerId).then((ok) => {
      if (!ok) showNotice("Couldn't block right now. They're hidden on your map anyway.");
    });
  }

  function flyTo(lng: number, lat: number, zoom: number) {
    setCamera({ key: ++cameraKey.current, kind: "fly", lng, lat, zoom });
  }

  // "Next light": hop between people, nearest first, available before busy.
  function nextLight() {
    if (peers.length === 0) return;
    const sorted = [...peers].sort((a, b) => {
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      return me ? distanceKm(me, a) - distanceKm(me, b) : 0;
    });
    const p = sorted[nextIndex.current % sorted.length];
    nextIndex.current += 1;
    flyTo(p.lng, p.lat, 4.5);
  }

  // "N online": zoom out to show everyone, you included.
  function showEveryone() {
    const points = [...peers.map((p) => ({ lat: p.lat, lng: p.lng })), ...(me ? [me] : [])];
    setCamera({ key: ++cameraKey.current, kind: "fit", points });
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(secret, sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  // Backstop for a peer that disappeared without an "end" (tab closed, the
  // beacon lost, laptop slept). Their presence row is reaped after STALE_MS;
  // two missed polls in a row avoids reacting to a single slow request.
  function checkPeerPresent(peers: PeerDot[]) {
    const c = connRef.current;
    if (c.kind === "idle") return;
    if (peers.some((p) => p.id === c.peerId)) {
      missingPolls.current = 0;
      return;
    }
    missingPolls.current += 1;
    if (missingPolls.current < 2) return;
    if (c.kind === "incoming") {
      missingPolls.current = 0;
      setConn({ kind: "idle" });
    } else if (c.kind === "requesting") {
      teardown("They left before answering.", c.peerId);
    } else {
      teardown("Stranger disconnected.", c.peerId);
    }
  }

  const processSignalRef = useRef(processSignal);
  const checkPeerPresentRef = useRef(checkPeerPresent);
  useEffect(() => {
    processSignalRef.current = processSignal;
    checkPeerPresentRef.current = checkPeerPresent;
  });

  useEffect(() => {
    if (phase !== "live" || !secret) return;
    let active = true;
    let inFlight = false;

    const tick = async () => {
      // A slow poll must not overlap the next one (ordering of signals).
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await poll(secret);
        if (!active) return;
        if (!data.present && myLocationRef.current) {
          const { lat, lng } = myLocationRef.current;
          await join(secret, lat, lng);
        }
        const visible = data.peers.filter((p) => !blockedRef.current.has(p.id));
        setPeers(visible);
        setPairs(data.pairs ?? []);
        for (const s of data.signals) processSignalRef.current(s);
        checkPeerPresentRef.current(visible);
      } catch {
      } finally {
        inFlight = false;
      }
    };
    void tick();
    // Worker-driven so a hidden tab keeps heartbeating (see lib/ticker.ts).
    const stop = startTicker(POLL_INTERVAL_MS, () => void tick());
    // Catch up immediately when the tab comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, secret]);

  // If a request arrives while the tab is in the background, say so in the
  // tab title; the prompt itself is invisible until they switch back.
  useEffect(() => {
    if (conn.kind !== "incoming") return;
    const original = document.title;
    let on = false;
    const id = window.setInterval(() => {
      on = !on;
      document.title = on ? "● Someone wants to connect" : original;
    }, 1000);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [conn.kind]);

  useEffect(() => {
    if (!secret || phase !== "live") return;
    const onLeave = () => leave(secret);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [secret, phase]);

  async function handleReady(lat: number, lng: number) {
    myLocationRef.current = { lat, lng };
    const joined = await join(secret, lat, lng);
    myIdRef.current = joined.id;
    setMe({ lat: joined.lat, lng: joined.lng });
    setPhase("live");
  }

  // Entry screen: show that the map is alive before joining.
  useEffect(() => {
    if (phase !== "gate") return;
    let active = true;
    const load = async () => {
      const n = await onlineCount();
      if (active && n !== null) setOnline(n);
    };
    void load();
    const id = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [phase]);

  const live = phase === "live";
  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const activePeerId = conn.kind === "idle" ? null : conn.peerId;
  const activePeer = activePeerId ? peers.find((p) => p.id === activePeerId) : undefined;
  const distanceLabel = me && activePeer ? formatDistance(distanceKm(me, activePeer)) : null;
  const arc: ArcState =
    conn.kind === "requesting" || conn.kind === "incoming" || conn.kind === "connecting"
      ? "calling"
      : conn.kind === "connected"
        ? "connected"
        : "none";
  const showEmpty = live && conn.kind === "idle" && peers.length === 0;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      showNotice("Couldn't copy. The address bar has the link.");
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-orbit">
      <WorldMap
        peers={peers}
        me={me}
        live={live}
        activePeerId={activePeerId}
        arc={arc}
        canConnect={conn.kind === "idle"}
        recenterKey={recenterKey}
        camera={camera}
        pairs={pairs}
        onPeerClick={requestConnection}
      />

      {!live && <EntryGate online={online} testPlace={testPlace} onReady={handleReady} />}

      {live && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="glass rise pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5">
            <span className="text-base font-semibold tracking-tight text-moon">pulse</span>
            <span className="h-4 w-px bg-hairline" aria-hidden="true" />
            <button
              onClick={showEveryone}
              title="Show everyone who's online"
              className="flex h-8 items-center gap-2 rounded-full px-2.5 text-sm text-mist transition hover:bg-white/10 hover:text-moon"
              aria-live="polite"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_8px_2px_rgba(255,180,92,0.7)]" />
              {peers.length + 1} online
            </button>
          </div>
          <div className={`rise flex items-start gap-2 ${inChat ? "sm:mr-[396px]" : ""}`}>
            <SearchBox onPick={(p) => flyTo(p.lng, p.lat, p.zoom)} />
            {peers.length > 0 && (
              <button
                onClick={nextLight}
                aria-label="Go to the next light"
                title="Go to the next light"
                className="glass pointer-events-auto grid h-11 w-11 place-items-center rounded-full text-amber transition hover:bg-white/10"
              >
                <NextIcon />
              </button>
            )}
            <button
              onClick={() => setRecenterKey((k) => k + 1)}
              aria-label="Back to my light"
              title="Back to my light"
              className="glass pointer-events-auto grid h-11 w-11 place-items-center rounded-full text-aurora transition hover:bg-white/10"
            >
              <LocateIcon />
            </button>
          </div>
        </header>
      )}

      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-50 flex justify-center px-4">
          <p role="status" className="glass rise rounded-full px-4 py-2.5 text-sm text-moon shadow-lg">
            {notice}
          </p>
        </div>
      )}

      {showEmpty && (
        <section className="glass rise absolute bottom-4 left-4 right-4 z-20 rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:right-auto sm:max-w-sm">
          <h2 className="font-semibold text-moon">You&rsquo;re the only light on right now.</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-mist">
            Open Pulse in a second window to try it, or send the link to someone. Their light
            appears here as soon as they join.
          </p>
          <button
            onClick={copyLink}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-full border border-hairline px-4 text-sm font-medium text-moon transition hover:bg-white/5"
          >
            <LinkIcon width={16} height={16} />
            {linkCopied ? "Link copied" : "Copy link"}
          </button>
        </section>
      )}

      {conn.kind === "requesting" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6">
          <div className="glass rise pointer-events-auto flex w-full max-w-sm items-center gap-4 rounded-full py-2.5 pl-3 pr-2.5">
            <span className="ripple relative grid h-10 w-10 shrink-0 place-items-center rounded-full">
              <span className="pulse-dot pointer-events-none" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1" role="status">
              <p className="text-sm font-semibold text-moon">Asking to connect…</p>
              {distanceLabel && <p className="truncate text-xs text-mist">{distanceLabel}</p>}
            </div>
            <button
              onClick={cancelRequest}
              className="h-10 rounded-full border border-hairline px-4 text-sm font-medium text-moon transition hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="Someone wants to talk"
          subtitle={distanceLabel ?? "A stranger on the map"}
          acceptLabel="Accept"
          declineLabel="Decline"
          timeoutMs={REQUEST_TIMEOUT_MS}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
          onBlock={() => blockPeer(conn.peerId)}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          distanceLabel={distanceLabel}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onBlock={() => blockPeer(conn.peerId)}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-4">
          <p role="status" className="glass rise rounded-full px-4 py-2.5 text-sm text-moon">
            Waiting for them to turn on video…
          </p>
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="They'd like to turn on video"
          subtitle="Your camera and mic turn on only if you accept."
          acceptLabel="Accept"
          declineLabel="Not now"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          theyRevealed={theyRevealed}
          onReveal={() => peerRef.current?.sendControl("video-revealed")}
          onBlock={() => activePeerId && blockPeer(activePeerId)}
          onToggleMic={(on) => peerRef.current?.setMicEnabled(on)}
          onToggleCamera={(on) => peerRef.current?.setCameraEnabled(on)}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
