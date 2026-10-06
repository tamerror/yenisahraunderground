import type { QuestState } from './quests';

/** Everything that persists between sessions for one neighbourhood. */
export interface Progress {
  v: 1;
  area: string;
  score: number;
  counts: Record<string, number>;
  mama: number;
  /** cat id -> number of times fed */
  fed: Record<string, number>;
  records: number[];
  visited: Uint8Array;
  sampleCount: number;
  visitedCount: number;
  pois: number[];
  completedStreets: string[];
  badges: string[];
  quests: QuestState[];
  questsDone: number;
  distance: number;
  playTime: number;
  bestCombo: number;
  metro: boolean;
  player: { x: number; y: number; h: number } | null;
}

export function newProgress(area: string, sampleCount: number): Progress {
  return {
    v: 1,
    area,
    score: 0,
    counts: {},
    mama: 0,
    fed: {},
    records: [],
    visited: new Uint8Array(Math.ceil(sampleCount / 8)),
    sampleCount,
    visitedCount: 0,
    pois: [],
    completedStreets: [],
    badges: [],
    quests: [],
    questsDone: 0,
    distance: 0,
    playTime: 0,
    bestCombo: 1,
    metro: false,
    player: null,
  };
}

export function isVisited(p: Progress, sample: number): boolean {
  return (p.visited[sample >> 3] & (1 << (sample & 7))) !== 0;
}

/** Marks a sample visited; returns true if it was new. */
export function markVisited(p: Progress, sample: number): boolean {
  const i = sample >> 3;
  const bit = 1 << (sample & 7);
  if (p.visited[i] & bit) return false;
  p.visited[i] |= bit;
  p.visitedCount++;
  return true;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(p: Progress): string {
  return JSON.stringify({ ...p, visited: toBase64(p.visited) });
}

/** Parses a saved progress string; returns null if it is unusable for this map. */
export function deserialize(json: string, area: string, sampleCount: number): Progress | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || raw.v !== 1 || raw.area !== area) return null;
    const base = newProgress(area, sampleCount);
    const p: Progress = { ...base, ...raw, visited: base.visited };
    if (raw.sampleCount === sampleCount && typeof raw.visited === 'string') {
      const bytes = fromBase64(raw.visited);
      if (bytes.length === base.visited.length) p.visited = bytes;
    } else {
      // the map changed since the save: keep score & collection but restart exploration
      p.visitedCount = 0;
      p.completedStreets = [];
      p.sampleCount = sampleCount;
    }
    let n = 0;
    for (let i = 0; i < sampleCount; i++) if (isVisited(p, i)) n++;
    p.visitedCount = n;
    return p;
  } catch {
    return null;
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const saveKey = (area: string) => `ysu:save:${area}`;

export function loadProgress(store: KeyValueStore | null, area: string, sampleCount: number): Progress {
  try {
    const s = store?.getItem(saveKey(area));
    if (s) {
      const p = deserialize(s, area, sampleCount);
      if (p) return p;
    }
  } catch {
    /* storage unavailable */
  }
  return newProgress(area, sampleCount);
}

export function saveProgress(store: KeyValueStore | null, p: Progress): boolean {
  try {
    store?.setItem(saveKey(p.area), serialize(p));
    return !!store;
  } catch {
    return false;
  }
}

export function safeLocalStorage(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage;
    const k = '__ysu_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}
