import { describe, expect, it } from 'vitest';
import { Projection } from '../src/core/geo';
import { Game } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { chooseGeocode, loadFromOsm, overpassQuery, overpassToArea, type OsmElement } from '../src/data/osm';
import { findBundled, normalizeName, slugify } from '../src/data/areas';

const C: [number, number] = [29.03, 40.98];
const proj = new Projection(C);
const g = (x: number, y: number) => {
  const [lon, lat] = proj.toLonLat({ x, y });
  return { lat, lon };
};
const square = (r: number) => [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([x, y]) => {
  const p = g(x, y);
  return [p.lon, p.lat];
});

const nominatim = [
  { lat: '40.98', lon: '29.03', name: 'Moda Caddesi', display_name: 'Moda Caddesi, Kadıköy', addresstype: 'road', geojson: { type: 'LineString', coordinates: [] } },
  { lat: '40.98', lon: '29.03', name: 'Moda', display_name: 'Moda, Kadıköy, İstanbul, Türkiye', addresstype: 'suburb', geojson: { type: 'Polygon', coordinates: [square(300)] } },
];

function grid(): OsmElement[] {
  const els: OsmElement[] = [];
  let id = 1;
  // a properly noded 5x5 street grid (OSM shares nodes at intersections)
  const ticks = [-250, -200, -100, 0, 100, 200, 250];
  for (let i = -2; i <= 2; i++) {
    els.push({ type: 'way', id: id++, tags: { highway: 'residential', name: `Sokak ${i}` }, geometry: ticks.map((t) => g(i * 100, t)) });
    els.push({ type: 'way', id: id++, tags: { highway: 'residential', name: `Cadde ${i}` }, geometry: ticks.map((t) => g(t, i * 100)) });
  }
  els.push({ type: 'way', id: id++, tags: { highway: 'motorway' }, geometry: [g(-300, 0), g(300, 0)] });
  els.push({ type: 'way', id: id++, tags: { highway: 'residential', tunnel: 'yes' }, geometry: [g(-50, -50), g(50, 50)] });
  els.push({ type: 'way', id: id++, tags: { highway: 'service', service: 'driveway' }, geometry: [g(10, 10), g(20, 20)] });
  els.push({ type: 'way', id: id++, tags: { highway: 'residential' }, geometry: [g(5000, 0), g(5100, 0)] });
  els.push({ type: 'way', id: id++, tags: { building: 'apartments', 'building:levels': '6' }, geometry: [g(20, 20), g(60, 20), g(60, 60), g(20, 60), g(20, 20)] });
  els.push({ type: 'relation', id: id++, tags: { building: 'yes', type: 'multipolygon' }, members: [{ type: 'way', role: 'outer', geometry: [g(-60, 20), g(-20, 20), g(-20, 60), g(-60, 60), g(-60, 20)] }] });
  els.push({ type: 'way', id: id++, tags: { leisure: 'park', name: 'Moda Parkı' }, geometry: [g(120, 120), g(180, 120), g(180, 180), g(120, 180), g(120, 120)] });
  els.push({ type: 'node', id: id++, lat: g(30, 5).lat, lon: g(30, 5).lon, tags: { shop: 'bakery', name: 'Moda Fırını' } });
  els.push({ type: 'node', id: id++, lat: g(-30, 5).lat, lon: g(-30, 5).lon, tags: { amenity: 'cafe', name: 'Kahve Durağı' } });
  els.push({ type: 'way', id: id++, center: g(100, 5), tags: { amenity: 'place_of_worship', religion: 'muslim', name: 'Moda Camii' } });
  els.push({ type: 'node', id: id++, lat: g(0, 105).lat, lon: g(0, 105).lon, tags: { highway: 'bus_stop' } });
  els.push({ type: 'node', id: id++, lat: g(0, 105).lat, lon: g(0, 105).lon, tags: { highway: 'bus_stop' } });
  els.push({ type: 'node', id: id++, lat: g(5000, 5).lat, lon: g(5000, 5).lon, tags: { amenity: 'cafe', name: 'Uzak Kafe' } });
  els.push({ type: 'node', id: id++, lat: g(10, 10).lat, lon: g(10, 10).lon, tags: { shop: 'clothes' } });
  return els;
}

describe('geocode selection', () => {
  it('prefers polygons of neighbourhood-like results', () => {
    const r = chooseGeocode(nominatim)!;
    expect(r.name).toBe('Moda');
    expect(r.boundary.length).toBe(4);
  });
  it('falls back to a circle when there is no polygon', () => {
    const r = chooseGeocode([{ lat: '41', lon: '29', name: 'X', display_name: 'X', addresstype: 'suburb' }])!;
    expect(r.boundary.length).toBe(48);
  });
  it('cuts huge areas to a circle', () => {
    const r = chooseGeocode([{ lat: '40.98', lon: '29.03', name: 'Big', display_name: 'Big', addresstype: 'city', geojson: { type: 'Polygon', coordinates: [square(5000)] } }])!;
    expect(r.boundary.length).toBe(48);
  });
  it('returns null for no results', () => {
    expect(chooseGeocode([])).toBeNull();
  });
});

describe('overpass conversion', () => {
  const geo = chooseGeocode(nominatim)!;
  const area = overpassToArea(grid(), geo);

  it('keeps walkable streets only', () => {
    expect(area.streets.length).toBe(10);
    expect(area.streets.every((s) => s.k === 'residential')).toBe(true);
  });
  it('keeps buildings with levels, including multipolygons', () => {
    expect(area.buildings.length).toBe(2);
    expect(area.buildings.some((b) => b.f === 6)).toBe(true);
    expect(area.buildings[0].c.length).toBe(4);
  });
  it('maps POIs, dedupes and drops far / unnamed ones', () => {
    const types = area.pois.map((p) => p.t).sort();
    expect(types).toEqual(['bakery', 'bus', 'cafe', 'mosque']);
  });
  it('maps parks', () => {
    expect(area.areas).toEqual([expect.objectContaining({ t: 'park' })]);
  });
  it('is playable', () => {
    const game = new Game(area, { rng: mulberry32(1) });
    expect(game.net.totalLength).toBeGreaterThan(2000);
    expect(game.items.length).toBeGreaterThan(10);
  });
  it('builds a bounded overpass query', () => {
    const q = overpassQuery(40.9, 29.0, 41.0, 29.1);
    expect(q).toContain('(40.900000,29.000000,41.000000,29.100000)');
    expect(q).toContain('out geom qt;');
    expect(q).toContain('out center qt;');
  });
});

describe('loadFromOsm', () => {
  it('geocodes then fetches overpass, falling back between endpoints', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://nominatim')) return new Response(JSON.stringify(nominatim));
      if (url.includes('bad')) return new Response('busy', { status: 429 });
      return new Response(JSON.stringify({ elements: grid() }));
    };
    const msgs: string[] = [];
    const area = await loadFromOsm('Moda', { fetchFn, endpoints: ['https://bad.example/api', 'https://good.example/api'], onProgress: (m) => msgs.push(m) });
    expect(area.name).toBe('Moda');
    expect(calls.length).toBe(3);
    expect(msgs.length).toBeGreaterThan(1);
  });
  it('reports unknown places', async () => {
    const fetchFn = async () => new Response('[]');
    await expect(loadFromOsm('Yokböyleyer', { fetchFn })).rejects.toThrow(/bulunamadı/);
  });
});

describe('bundled area names', () => {
  it('normalises Turkish names', () => {
    expect(normalizeName('YENİSAHRA Mahallesi, Ataşehir')).toBe('yenisahra');
    expect(findBundled('Yenisahra mah.')?.slug).toBe('yenisahra');
    expect(findBundled('Moda')?.slug).toBe('caferaga');
    expect(findBundled('Bostancı')).toBeNull();
    expect(slugify('Kozyatağı, Kadıköy')).toBe('kozyatagi');
  });
});
