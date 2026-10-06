import { centroid, distToRing, pointInPolygon, polygonArea, Projection } from '../core/geo';
import type { AreaData, AreaPoi, AreaPolygon, AreaStreet, AreaType, LonLat, PoiType, StreetKind, Vec2 } from '../core/types';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Areas larger than this (bounding-box diagonal, metres) are cut to a circle around the centre. */
export const MAX_DIAGONAL = 3200;
export const CIRCLE_RADIUS = 1000;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeocodeResult {
  name: string;
  displayName: string;
  center: LonLat;
  boundary: LonLat[];
}

interface NominatimItem {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  class?: string;
  geojson?: { type: string; coordinates: unknown };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function circle(center: LonLat, radius: number, n = 48): LonLat[] {
  const proj = new Projection(center);
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ll = proj.toLonLat({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    out.push([r6(ll[0]), r6(ll[1])]);
  }
  return out;
}

function largestRing(geojson: NominatimItem['geojson']): LonLat[] | null {
  if (!geojson) return null;
  let rings: LonLat[][] = [];
  if (geojson.type === 'Polygon') rings = [(geojson.coordinates as LonLat[][])[0]];
  else if (geojson.type === 'MultiPolygon') rings = (geojson.coordinates as LonLat[][][]).map((p) => p[0]);
  else return null;
  let best: LonLat[] | null = null;
  let bestA = 0;
  for (const r of rings) {
    const proj = new Projection(r[0]);
    const a = Math.abs(polygonArea(r.map((p) => proj.toLocal(p))));
    if (a > bestA) {
      bestA = a;
      best = r;
    }
  }
  if (best && best.length > 1 && best[0][0] === best[best.length - 1][0] && best[0][1] === best[best.length - 1][1]) best = best.slice(0, -1);
  return best;
}

const PREFERRED = ['neighbourhood', 'suburb', 'quarter', 'city_district', 'village', 'town', 'borough', 'hamlet', 'district'];

/** Picks the best Nominatim result and turns it into a playable boundary. */
export function chooseGeocode(items: NominatimItem[]): GeocodeResult | null {
  if (!items.length) return null;
  const scored = items.map((it, i) => {
    const ring = largestRing(it.geojson);
    const at = it.addresstype ?? it.type ?? '';
    let score = -i;
    if (ring) score += 10;
    const pi = PREFERRED.indexOf(at);
    if (pi >= 0) score += 8 - pi * 0.5;
    return { it, ring, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const { it, ring } = scored[0];
  let center: LonLat = [r6(parseFloat(it.lon)), r6(parseFloat(it.lat))];
  let boundary = ring;
  if (boundary) {
    const proj = new Projection(center);
    const pts = boundary.map((p) => proj.toLocal(p));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    if (Math.hypot(x1 - x0, y1 - y0) > MAX_DIAGONAL) boundary = null;
    else {
      const c = proj.toLonLat(centroid(pts));
      center = [r6(c[0]), r6(c[1])];
    }
  }
  if (!boundary) boundary = circle(center, CIRCLE_RADIUS);
  return { name: it.name || it.display_name.split(',')[0], displayName: it.display_name, center, boundary };
}

export async function geocode(query: string, fetchFn: FetchFn = fetch): Promise<GeocodeResult | null> {
  for (const cc of ['tr', '']) {
    const params = new URLSearchParams({ format: 'jsonv2', polygon_geojson: '1', polygon_threshold: '0.00003', limit: '8', 'accept-language': 'tr', q: query });
    if (cc) params.set('countrycodes', cc);
    const res = await fetchFn(`${NOMINATIM}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Konum arama başarısız (${res.status})`);
    const r = chooseGeocode((await res.json()) as NominatimItem[]);
    if (r) return r;
  }
  return null;
}

export function overpassQuery(s: number, w: number, n: number, e: number): string {
  const b = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  return `[out:json][timeout:90];
(
  way["highway"]${b};
  way["building"]${b};
  relation["building"]["type"="multipolygon"]${b};
  way["leisure"~"^(park|garden|playground|pitch)$"]${b};
  way["landuse"~"^(grass|recreation_ground|meadow|cemetery|religious|village_green)$"]${b};
);
out geom qt;
(
  nwr["amenity"~"^(cafe|restaurant|fast_food|pharmacy|school|kindergarten|place_of_worship|veterinary)$"]${b};
  nwr["shop"]${b};
  node["highway"="bus_stop"]${b};
  nwr["railway"~"^(station|subway_entrance)$"]${b};
);
out center qt;`;
}

interface OsmGeomPoint {
  lat: number;
  lon: number;
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: OsmGeomPoint;
  tags?: Record<string, string>;
  geometry?: OsmGeomPoint[];
  members?: { type: string; role: string; geometry?: OsmGeomPoint[] }[];
}

const HIGHWAY: Record<string, StreetKind> = {
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'residential',
  living_street: 'residential',
  unclassified: 'residential',
  road: 'minor',
  service: 'service',
  pedestrian: 'pedestrian',
  footway: 'footway',
  path: 'footway',
  cycleway: 'footway',
  track: 'footway',
  bridleway: 'footway',
  steps: 'steps',
};

function poiType(t: Record<string, string>): PoiType | null {
  const name = (t.name ?? '').toLocaleLowerCase('tr-TR');
  if (t.railway === 'station' && (t.station === 'subway' || t.subway === 'yes' || t.station === 'light_rail')) return 'metro';
  if (t.railway === 'subway_entrance') return 'metro';
  if (t.highway === 'bus_stop') return 'bus';
  if (t.shop === 'bakery' || t.shop === 'pastry' || /fırın|simit|unlu|pastane|börek/.test(name)) return 'bakery';
  if (t.amenity === 'cafe') return 'cafe';
  if (t.amenity === 'restaurant' || t.amenity === 'fast_food') return 'food';
  if (['supermarket', 'convenience', 'greengrocer', 'butcher', 'deli', 'kiosk'].includes(t.shop ?? '')) return 'market';
  if (t.amenity === 'place_of_worship' && (t.religion === 'muslim' || /cami/.test(name))) return 'mosque';
  if (t.amenity === 'school' || t.amenity === 'kindergarten') return 'school';
  if (t.amenity === 'pharmacy') return 'pharmacy';
  if (t.shop === 'pet' || t.amenity === 'veterinary') return 'pet';
  if (t.shop) return 'shop';
  return null;
}

const ll = (p: OsmGeomPoint): LonLat => [r6(p.lon), r6(p.lat)];

/** Converts an Overpass `out geom` / `out center` response into the game's area format. */
export function overpassToArea(elements: OsmElement[], geo: GeocodeResult): AreaData {
  const proj = new Projection(geo.center);
  const ring: Vec2[] = geo.boundary.map((p) => proj.toLocal(p));
  const within = (p: Vec2, buf: number) => pointInPolygon(p, ring) || distToRing(p, ring) <= buf;
  const streets: AreaStreet[] = [];
  const buildings: AreaData['buildings'] = [];
  const areas: AreaPolygon[] = [];
  const pois: AreaPoi[] = [];
  const seenPoi = new Set<string>();

  const addBuilding = (geom: OsmGeomPoint[], t: Record<string, string>) => {
    if (geom.length < 4) return;
    const c = geom.map(ll);
    if (c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
    const local = c.map((p) => proj.toLocal(p));
    if (Math.abs(polygonArea(local)) < 4 || !within(centroid(local), 160)) return;
    const b: AreaData['buildings'][number] = { c };
    const lv = parseInt(t['building:levels'] ?? '', 10);
    if (lv > 0 && lv < 80) b.f = lv;
    const h = parseFloat(t.height ?? '');
    if (h > 0 && h < 400) b.h = Math.round(h * 10) / 10;
    buildings.push(b);
  };

  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'way' && el.geometry && t.highway) {
      const kind = HIGHWAY[t.highway];
      if (!kind) continue;
      if (t.tunnel && t.tunnel !== 'no') continue;
      if (parseInt(t.layer ?? '0', 10) < 0) continue;
      if (t.access === 'private' || t.access === 'no' || t.area === 'yes') continue;
      if (t.service === 'driveway' || t.service === 'parking_aisle') continue;
      const c = el.geometry.map(ll);
      if (!c.some((p) => within(proj.toLocal(p), 60))) continue;
      const st: AreaStreet = { n: t.name ?? null, k: kind, c };
      if (t.bridge && t.bridge !== 'no') st.b = 1;
      streets.push(st);
      continue;
    }
    if (el.type === 'way' && el.geometry && t.building && t.building !== 'no') {
      addBuilding(el.geometry, t);
      continue;
    }
    if (el.type === 'relation' && t.building && el.members) {
      for (const m of el.members) if (m.role === 'outer' && m.geometry) addBuilding(m.geometry, t);
      continue;
    }
    if (el.type === 'way' && el.geometry && (t.leisure || t.landuse)) {
      const v = t.leisure ?? t.landuse;
      const map: Record<string, AreaType> = {
        park: 'park', garden: 'park', playground: 'park', village_green: 'grass', pitch: 'pitch',
        grass: 'grass', recreation_ground: 'grass', meadow: 'grass', cemetery: 'grass', religious: 'religious',
      };
      const at = map[v];
      if (!at) continue;
      const c = el.geometry.map(ll);
      if (c.length > 1 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
      if (c.length < 3) continue;
      if (!c.some((p) => within(proj.toLocal(p), 160))) continue;
      areas.push({ t: at, c });
      continue;
    }
    // POIs (from the `out center` block)
    const pt = el.type === 'node' && el.lat !== undefined ? { lat: el.lat, lon: el.lon! } : el.center;
    if (!pt) continue;
    const type = poiType(t);
    if (!type) continue;
    const name = t.name ?? (type === 'bus' ? 'Otobüs Durağı' : null);
    if (!name) continue;
    const p = ll(pt);
    if (!within(proj.toLocal(p), type === 'metro' ? 160 : 60)) continue;
    const key = `${name.toLocaleLowerCase('tr-TR')}|${type}|${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    if (seenPoi.has(key)) continue;
    seenPoi.add(key);
    pois.push({ n: name, t: type, p });
  }

  return {
    version: 1,
    name: geo.name,
    fullName: geo.displayName.split(',').slice(0, 3).join(',').trim(),
    source: '© OpenStreetMap katkıcıları (ODbL), Overpass API',
    center: geo.center,
    boundary: geo.boundary,
    streets,
    buildings,
    pois,
    areas,
  };
}

export function boundaryBBox(boundary: LonLat[], center: LonLat, buffer: number): [number, number, number, number] {
  const proj = new Projection(center);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of boundary) {
    const v = proj.toLocal(p);
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
  }
  const sw = proj.toLonLat({ x: x0 - buffer, y: y0 - buffer });
  const ne = proj.toLonLat({ x: x1 + buffer, y: y1 + buffer });
  return [sw[1], sw[0], ne[1], ne[0]];
}

export interface OsmLoadOptions {
  fetchFn?: FetchFn;
  onProgress?: (msg: string) => void;
  endpoints?: string[];
}

export async function loadFromOsm(query: string, opts: OsmLoadOptions = {}): Promise<AreaData> {
  const fetchFn = opts.fetchFn ?? ((i: string, init?: RequestInit) => fetch(i, init));
  opts.onProgress?.(`"${query}" aranıyor…`);
  const geo = await geocode(query, fetchFn);
  if (!geo) throw new Error(`"${query}" bulunamadı. Semt adını "Moda, Kadıköy" gibi ilçeyle birlikte yazmayı dene.`);
  opts.onProgress?.(`${geo.name}: sokaklar ve binalar indiriliyor…`);
  const [s, w, n, e] = boundaryBBox(geo.boundary, geo.center, 170);
  const body = `data=${encodeURIComponent(overpassQuery(s, w, n, e))}`;
  let lastErr: unknown = null;
  for (const ep of opts.endpoints ?? OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchFn(ep, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OsmElement[] };
      opts.onProgress?.('Harita hazırlanıyor…');
      const area = overpassToArea(json.elements ?? [], geo);
      if (area.streets.length < 5) throw new Error('Bu bölgede yürünebilir sokak bulunamadı.');
      return area;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Harita verisi indirilemedi.');
}
