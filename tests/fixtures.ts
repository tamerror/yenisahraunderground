import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AreaData, LonLat } from '../src/core/types';
import { Projection } from '../src/core/geo';

export function loadYenisahra(): AreaData {
  const p = fileURLToPath(new URL('../public/data/yenisahra.json', import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8')) as AreaData;
}

/** A tiny synthetic "plus"-shaped neighbourhood around (29, 41): two crossing 200 m streets. */
export function plusArea(): AreaData {
  const proj = new Projection([29, 41]);
  const ll = (x: number, y: number): LonLat => proj.toLonLat({ x, y });
  return {
    version: 1,
    name: 'Test',
    fullName: 'Test Mahallesi',
    source: 'test',
    center: [29, 41],
    boundary: [ll(-100, -100), ll(100, -100), ll(100, 100), ll(-100, 100)],
    streets: [
      { n: 'Doğu Batı Caddesi', k: 'residential', c: [ll(-100, 0), ll(0, 0), ll(100, 0)] },
      { n: 'Kuzey Sokağı', k: 'residential', c: [ll(0, 0), ll(0, 100)] },
      { n: 'Güney Sokağı', k: 'residential', c: [ll(0, -100), ll(0, 0)] },
      { n: 'Ada Sokağı', k: 'residential', c: [ll(300, 300), ll(320, 300)] },
    ],
    buildings: [{ c: [ll(10, 10), ll(30, 10), ll(30, 30), ll(10, 30)], f: 5 }],
    pois: [
      { n: 'Komşu Fırın', t: 'bakery', p: ll(50, 8) },
      { n: 'Yenisahra', t: 'metro', p: ll(-90, 5) },
    ],
    areas: [],
  };
}

export class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
