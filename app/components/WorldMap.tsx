"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { distanceKm, formatDistance, greatCircle, type LatLng } from "@/lib/geo";

// No fallback: a placeholder token just fails with a 401 and a blank map,
// hiding the "set NEXT_PUBLIC_MAPBOX_TOKEN" hint rendered below.
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || "";

export type ArcState = "none" | "calling" | "connected";

// Camera moves requested by the UI (search, "next light", "show everyone").
// `key` changes on every request so repeating the same move still fires.
export type CameraCommand =
  | { key: number; kind: "fly"; lng: number; lat: number; zoom: number }
  | { key: number; kind: "fit"; points: LatLng[] };

// Stable 0–3s offset per id so each light breathes on its own rhythm.
function breathDelay(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${(Math.abs(h) % 3000) / 1000}s`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};
const EMPTY_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Wide screens: while the entry screen is up, push the globe right so it
// sits beside the headline instead of behind it.
function entryPadding(): { left: number; right: number; top: number; bottom: number } {
  const w = typeof window !== "undefined" ? window.innerWidth : 0;
  return { left: w >= 1024 ? Math.round(w * 0.42) : 0, right: 0, top: 0, bottom: 0 };
}

export default function WorldMap({
  peers,
  pairs,
  me,
  live,
  activePeerId,
  arc,
  canConnect,
  recenterKey,
  camera,
  onPeerClick,
}: {
  peers: PeerDot[];
  pairs: [string, string][]; // other people's live conversations
  me: LatLng | null; // public (offset) position, once joined
  live: boolean; // false while the entry screen is up: globe idles and spins
  activePeerId: string | null; // the person being called / talked to
  arc: ArcState;
  canConnect: boolean;
  recenterKey: number; // bump to fly back to "me"
  camera: CameraCommand | null;
  onPeerClick: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Marker click handlers are bound once; read live values through refs.
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // ---- Initialise the globe once ----
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const narrow = window.innerWidth < 640;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        center: [118, 14],
        zoom: narrow ? 0.9 : 1.55,
        attributionControl: false,
        // Bottom-left: the chat panel and video controls live bottom-right.
        logoPosition: "bottom-left",
      });
      map.setPadding(entryPadding());
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
      map.on("error", (e) => {
        // A bad / restricted token surfaces here; show a real message.
        const status = (e?.error as { status?: number } | undefined)?.status;
        if (status === 401 || status === 403) setFailed(true);
      });

      map.on("style.load", () => {
        // Earth from orbit at night: navy atmosphere, faint stars.
        map.setFog({
          color: "rgb(16, 30, 64)",
          "high-color": "rgb(30, 54, 110)",
          "horizon-blend": 0.06,
          "space-color": "rgb(4, 8, 20)",
          "star-intensity": 0.5,
        });
        styleBasemap(map);

        // Other people's live conversations: faint arcs, so the globe shows
        // connection happening, not just dots.
        map.addSource("pairs", { type: "geojson", data: EMPTY_COLLECTION });
        map.addLayer({
          id: "pairs-glow",
          type: "line",
          source: "pairs",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#ffb45c", "line-width": 6, "line-blur": 6, "line-opacity": 0.18 },
        });
        map.addLayer({
          id: "pairs-core",
          type: "line",
          source: "pairs",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#ffd29a", "line-width": 1, "line-opacity": 0.55 },
        });

        // The arc between you and the person you're calling / talking to.
        map.addSource("arc", { type: "geojson", data: EMPTY_LINE });
        map.addLayer({
          id: "arc-glow",
          type: "line",
          source: "arc",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#ffb45c", "line-width": 9, "line-blur": 7, "line-opacity": 0.35 },
        });
        map.addLayer({
          id: "arc-core",
          type: "line",
          source: "arc",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#ffe2bd", "line-width": 1.6, "line-opacity": 0.95 },
        });
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- Entry screen: idle spin, globe offset beside the headline ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (live) {
      map.easeTo({ padding: { left: 0, right: 0, top: 0, bottom: 0 }, duration: 600 });
      return;
    }
    const onResize = () => map.setPadding(entryPadding());
    window.addEventListener("resize", onResize);
    if (prefersReducedMotion()) return () => window.removeEventListener("resize", onResize);
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const c = map.getCenter();
      map.setCenter([c.lng - dt * 0.004, c.lat]); // ~4°/s westward drift
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [ready, live]);

  // ---- "You": place the beacon and fly in the first time ----
  const flewInRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You. This is where others see you.";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", "You. This is where others see you.");
        // A small "You" label for the first few seconds, so the teal-vs-amber
        // distinction is learnt without explanation.
        const label = document.createElement("span");
        label.className = "pulse-me-label";
        label.textContent = "You";
        el.appendChild(label);
        meMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
        window.setTimeout(() => label.classList.add("is-hidden"), 7000);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
      if (!flewInRef.current) {
        flewInRef.current = true;
        map.flyTo({
          center: [me.lng, me.lat],
          zoom: 3.2,
          padding: { left: 0, right: 0, top: 0, bottom: 0 },
          duration: prefersReducedMotion() ? 0 : 2800,
          curve: 1.6,
          essential: true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // ---- Recenter on request ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me || recenterKey === 0) return;
    map.flyTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 3.2), essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // ---- Camera commands (search, next light, show everyone) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !camera) return;
    // Only pass duration when overriding it: an explicit `duration: undefined`
    // replaces Mapbox's default and turns the camera into NaN.
    const motion = prefersReducedMotion() ? { duration: 0 } : {};
    if (camera.kind === "fly") {
      map.flyTo({ center: [camera.lng, camera.lat], zoom: camera.zoom, ...motion, essential: true });
      return;
    }
    if (camera.points.length === 0) return;
    if (camera.points.length === 1) {
      const p = camera.points[0];
      map.flyTo({ center: [p.lng, p.lat], zoom: 3.2, ...motion, essential: true });
      return;
    }
    const lngs = camera.points.map((p) => p.lng);
    const lats = camera.points.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 90, maxZoom: 5, ...motion },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.key, ready]);

  // ---- Strangers' lights ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "pulse-dot";
          el.style.setProperty("--delay", breathDelay(peer.id));
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (el.dataset.busy === "true") return;
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });
          marker = new mapboxgl.Marker({ element: el }).setLngLat([peer.lng, peer.lat]).addTo(map);
          markers.set(peer.id, marker);
        } else {
          const at = marker.getLngLat();
          if (at.lng !== peer.lng || at.lat !== peer.lat) marker.setLngLat([peer.lng, peer.lat]);
        }
        const el = marker.getElement() as HTMLButtonElement;
        const active = peer.id === activePeerId;
        el.dataset.busy = String(peer.busy && !active);
        el.dataset.active = String(active);
        const where = me ? formatDistance(distanceKm(me, peer)) : "Somewhere";
        const label = peer.busy && !active ? `${where}, in a conversation` : `${where}. Tap to connect`;
        el.title = label;
        el.setAttribute("aria-label", `Stranger. ${label}`);
        el.disabled = !live;
      }

      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready, activePeerId, me, live]);

  // ---- Other people's conversations: arcs, drawn in when they start ----
  const knownPairsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("pairs") as GeoJSONSource | undefined;
    if (!source) return;

    const byId = new Map(peers.map((p) => [p.id, p]));
    const lines: { key: string; points: [number, number][]; ends: [string, string] }[] = [];
    for (const [a, b] of pairs) {
      const pa = byId.get(a);
      const pb = byId.get(b);
      if (!pa || !pb) continue;
      lines.push({ key: pairKey(a, b), points: greatCircle(pa, pb, 64), ends: [a, b] });
    }

    const fresh = lines.filter((l) => !knownPairsRef.current.has(l.key));
    knownPairsRef.current = new Set(lines.map((l) => l.key));

    // A spark on both lights when a new conversation starts.
    for (const l of fresh) {
      for (const id of l.ends) {
        const el = markersRef.current.get(id)?.getElement();
        if (!el) continue;
        el.classList.remove("spark");
        void el.offsetWidth; // restart the animation
        el.classList.add("spark");
      }
    }

    const render = (progress: number) => {
      source.setData({
        type: "FeatureCollection",
        features: lines.map((l) => {
          const n = fresh.includes(l) ? Math.max(2, Math.ceil(l.points.length * progress)) : l.points.length;
          return {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: l.points.slice(0, n) },
          };
        }),
      });
    };

    if (fresh.length === 0 || prefersReducedMotion()) {
      render(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      render(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pairs, peers, ready]);

  // ---- Your arc: drawn on when a call starts, solid once connected ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("arc") as GeoJSONSource | undefined;
    if (!source) return;

    const peer = activePeerId ? peers.find((p) => p.id === activePeerId) : undefined;
    if (arc === "none" || !me || !peer) {
      source.setData(EMPTY_LINE);
      return;
    }

    map.setPaintProperty("arc-core", "line-dasharray", arc === "calling" ? [1.5, 2] : [1, 0]);
    map.setPaintProperty("arc-glow", "line-opacity", arc === "calling" ? 0.25 : 0.45);

    const points = greatCircle(me, peer);
    const setLine = (coords: [number, number][]) =>
      source.setData({ ...EMPTY_LINE, geometry: { type: "LineString", coordinates: coords } });

    if (prefersReducedMotion()) {
      setLine(points);
      return;
    }
    // Draw from you toward them over ~0.9s.
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setLine(points.slice(0, Math.max(2, Math.ceil(points.length * eased))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Positions of `me`/peer don't change mid-call; redraw on state change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arc, activePeerId, ready, me]);

  return (
    <div className="absolute inset-0 bg-orbit">
      <div ref={containerRef} className="h-full w-full" />

      {(!TOKEN || failed) && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="glass max-w-md rounded-2xl px-5 py-4 text-sm leading-relaxed text-moon">
            {failed ? "Mapbox rejected the token. " : "The map needs a Mapbox token. "}
            Set <code className="text-aurora">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> (or in your Vercel project settings) and restart.
          </p>
        </div>
      )}
    </div>
  );
}

// Pull Mapbox's dark style toward the night-side palette. Layer ids come
// from dark-v11; every change is guarded so a style update can't break the
// app, it just looks a little less tuned.
function styleBasemap(map: MapboxMap) {
  const tryRun = (fn: () => void) => {
    try {
      fn();
    } catch {}
  };
  // Land a touch lighter than the ocean so continents read at a glance.
  tryRun(() => map.setPaintProperty("land", "background-color", "#15264c"));
  tryRun(() => map.setPaintProperty("water", "fill-color", "#070f26"));

  // A faint glow along coastlines, drawn from the water layer's own source.
  tryRun(() => {
    const water = map.getLayer("water") as { source?: string; sourceLayer?: string } | undefined;
    if (!water?.source) return;
    // Insert directly above the water fill (below roads, borders, labels).
    const ids = (map.getStyle()?.layers ?? []).map((l) => l.id);
    const above = ids[ids.indexOf("water") + 1];
    map.addLayer(
      {
        id: "coast-glow",
        type: "line",
        source: water.source,
        "source-layer": water.sourceLayer ?? "water",
        paint: {
          "line-color": "rgba(140, 180, 255, 0.28)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 5, 1.2],
          "line-blur": 1.2,
        },
      },
      above,
    );
  });

  // Fewer labels when zoomed out: the lights should be the main thing on the
  // globe. Countries appear from zoom 2.4, cities and regions from 4.
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    const id = layer.id;
    let minzoom: number | null = null;
    if (id.startsWith("country-label")) minzoom = 2.4;
    else if (id.startsWith("continent-label")) minzoom = 1;
    else if (id.startsWith("settlement") || id.startsWith("state-label")) minzoom = 4;
    else if (id.startsWith("water-") || id.includes("natural")) minzoom = 4.5;
    if (minzoom !== null) {
      const m = minzoom;
      tryRun(() => map.setLayerZoomRange(id, m, 24));
    }
  }
}
