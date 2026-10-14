// Place search for the map (and the ?at= test shortcut), using Mapbox's
// geocoding API with the same public token as the map. Only used to move the
// camera or, in test mode, to pick a starting point; never sent to Pulse's
// own server.

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || "";

export interface Place {
  name: string; // "Tokyo"
  context: string; // "Japan"
  lat: number;
  lng: number;
  zoom: number; // a sensible zoom for this kind of place
}

const ZOOM_BY_TYPE: Record<string, number> = {
  country: 3.4,
  region: 5,
  district: 6,
  place: 7,
  locality: 8,
  neighborhood: 9,
};

interface V6Feature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    feature_type?: string;
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
  };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (!TOKEN || q.length < 2) return [];
  const url =
    "https://api.mapbox.com/search/geocode/v6/forward" +
    `?q=${encodeURIComponent(q)}&limit=5&types=country,region,district,place,locality` +
    `&access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: V6Feature[] };
  return (data.features ?? []).flatMap((f) => {
    const c = f.geometry?.coordinates;
    if (!c) return [];
    const p = f.properties ?? {};
    return [
      {
        name: p.name_preferred || p.name || q,
        context: p.place_formatted ?? "",
        lng: c[0],
        lat: c[1],
        zoom: ZOOM_BY_TYPE[p.feature_type ?? "place"] ?? 6,
      },
    ];
  });
}
