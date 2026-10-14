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

export default function WorldMap({
  peers,
  me,
  live,
  activePeerId,
  arc,
  canConnect,
  recenterKey,
  onPeerClick,
}: {
  peers: PeerDot[];
  me: LatLng | null; // public (offset) position, once joined
  live: boolean; // false while the entry screen is up: globe idles and spins
  activePeerId: string | null; // the person being called / talked to
  arc: ArcState;
  canConnect: boolean;
  recenterKey: number; // bump to fly back to "me"
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
  const liveRef = useRef(live);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
    liveRef.current = live;
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
        logoPosition: "bottom-right",
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
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
          "horizon-blend": 0.05,
          "space-color": "rgb(4, 8, 20)",
          "star-intensity": 0.5,
        });
        // Pull the basemap toward the palette. Layer ids are from dark-v11;
        // wrapped so a style change can't break the app.
        try {
          map.setPaintProperty("land", "background-color", "#101b36");
        } catch {}
        try {
          map.setPaintProperty("water", "fill-color", "#0a1430");
        } catch {}

        // The arc between you and the person you're calling / talking to.
        map.addSource("arc", { type: "geojson", data: EMPTY_LINE });
        map.addLayer({
          id: "arc-glow",
          type: "line",
          source: "arc",
          layout: { "line-cap": "round" },
          paint: {
            "line-color": "#ffb45c",
            "line-width": 9,
            "line-blur": 7,
            "line-opacity": 0.35,
          },
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

  // ---- Idle spin while the entry screen is up ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || live || prefersReducedMotion()) return;
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
    return () => cancelAnimationFrame(raf);
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
        el.setAttribute("aria-hidden", "true");
        meMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
      if (!flewInRef.current) {
        flewInRef.current = true;
        map.flyTo({
          center: [me.lng, me.lat],
          zoom: 3.6,
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
    map.flyTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 3.6), essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

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

  // ---- The arc: drawn on when a call starts, solid once connected ----
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
