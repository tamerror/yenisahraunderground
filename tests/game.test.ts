import { describe, expect, it } from 'vitest';
import { CATS, comboMultiplier, ITEM_BY_ID, levelFor, MAX_MAMA, RECORD_TITLES } from '../src/core/content';
import { CONFIG_3D, Game, type GameEvent } from '../src/core/game';
import { deserialize, newProgress, serialize, markVisited } from '../src/core/progress';
import { mulberry32 } from '../src/core/rng';
import { loadYenisahra, MemoryStore, plusArea } from './fixtures';

const FWD = { forward: 1, turn: 0, run: false };

function collectEvents(g: Game): GameEvent[] {
  const ev: GameEvent[] = [];
  g.on((e) => ev.push(e));
  return ev;
}

describe('content helpers', () => {
  it('combo multiplier grows with chain length', () => {
    expect([1, 2, 3, 6, 10, 15, 40].map(comboMultiplier)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });
  it('levels', () => {
    expect(levelFor(0).title).toBe('Yabancı');
    expect(levelFor(800).title).toBe('Komşu');
    expect(levelFor(1e9).next).toBeNull();
  });
});

describe('progress serialisation', () => {
  it('round-trips including the visited bitset', () => {
    const p = newProgress('X', 100);
    markVisited(p, 3);
    markVisited(p, 99);
    p.score = 42;
    const q = deserialize(serialize(p), 'X', 100)!;
    expect(q.score).toBe(42);
    expect(q.visitedCount).toBe(2);
    expect(Array.from(q.visited)).toEqual(Array.from(p.visited));
  });
  it('resets exploration when the map changed but keeps score', () => {
    const p = newProgress('X', 100);
    markVisited(p, 3);
    p.score = 7;
    const q = deserialize(serialize(p), 'X', 120)!;
    expect(q.score).toBe(7);
    expect(q.visitedCount).toBe(0);
  });
  it('rejects garbage and other areas', () => {
    expect(deserialize('{nope', 'X', 1)).toBeNull();
    expect(deserialize(serialize(newProgress('Y', 1)), 'X', 1)).toBeNull();
  });
});

describe('Game on synthetic map', () => {
  const make = (store = new MemoryStore()) => new Game(plusArea(), { rng: mulberry32(7), store });

  it('starts on the network with items, cats, records and quests', () => {
    const g = make();
    expect(g.net.inCorridor(g.player)).toBe(true);
    expect(g.items.length).toBeGreaterThan(5);
    expect(g.cats.length).toBe(CATS.length);
    expect(g.items.filter((i) => i.def.id === 'plak').length).toBe(RECORD_TITLES.length);
    expect(g.progress.quests.length).toBe(3);
  });

  it('walking explores samples and awards points', () => {
    const g = make();
    const ev = collectEvents(g);
    for (let i = 0; i < 60; i++) g.update(0.1, FWD);
    expect(g.progress.distance).toBeGreaterThan(20);
    expect(g.progress.visitedCount).toBeGreaterThan(2);
    expect(ev.some((e) => e.type === 'explore')).toBe(true);
    expect(g.net.inCorridor(g.player)).toBe(true);
  });

  it('turning changes heading and the player never leaves the corridors', () => {
    const g = make();
    const rng = mulberry32(3);
    for (let i = 0; i < 2000; i++) {
      g.update(0.05, { forward: rng() < 0.8 ? 1 : -1, turn: rng() * 2 - 1, run: rng() < 0.3 });
      expect(g.net.inCorridor(g.player)).toBe(true);
    }
  });

  it('picks up an item when close, with combo multiplier', () => {
    const g = make();
    const ev = collectEvents(g);
    g.items.length = 0;
    const simit = ITEM_BY_ID.simit;
    const mk = (dx: number) => ({ uid: 1000 + dx, def: simit, x: g.player.x + dx * 0.1, y: g.player.y, phase: 0 });
    g.items.push(mk(1), mk(2), mk(3));
    g.update(0.016, null);
    const col = ev.filter((e) => e.type === 'collect');
    expect(col.length).toBe(3);
    expect(g.progress.counts.simit).toBe(3);
    expect(g.combo.mult).toBe(2);
  });

  it('mama is capped and needed to feed cats; feeding makes the cat follow', () => {
    const g = make();
    const ev = collectEvents(g);
    const cat = g.cats[0];
    g.player.x = cat.x;
    g.player.y = cat.y;
    g.update(0.016, null);
    expect(ev.some((e) => e.type === 'toast' && e.kind === 'warn')).toBe(true);
    g.progress.mama = MAX_MAMA;
    g.items.length = 0;
    g.items.push({ uid: 1, def: ITEM_BY_ID.mama, x: g.player.x, y: g.player.y, phase: 0 });
    cat.lastNag = -99;
    cat.hungryAt = 1e9; // not hungry yet
    g.update(0.016, null);
    expect(g.items.length).toBeGreaterThanOrEqual(1); // full bag: mama stays on the ground
    expect(g.progress.mama).toBe(MAX_MAMA);
    cat.hungryAt = 0;
    cat.x = g.player.x;
    cat.y = g.player.y;
    g.update(0.016, null);
    const fed = ev.find((e) => e.type === 'feed');
    expect(fed).toBeTruthy();
    expect(g.progress.fed[cat.def.id]).toBe(1);
    expect(cat.follow).toBeGreaterThan(0);
    expect(g.progress.mama).toBe(MAX_MAMA - 1);
  });

  it('records are remembered and not respawned', () => {
    const store = new MemoryStore();
    const g = make(store);
    const rec = g.items.find((i) => i.def.id === 'plak')!;
    g.player.x = rec.x;
    g.player.y = rec.y;
    g.update(0.016, null);
    expect(g.progress.records).toEqual([rec.record]);
    g.save();
    const g2 = make(store);
    expect(g2.items.filter((i) => i.def.id === 'plak').length).toBe(RECORD_TITLES.length - 1);
    expect(g2.progress.records).toEqual([rec.record]);
  });

  it('power-ups apply and expire', () => {
    const g = make();
    g.items.length = 0;
    g.items.push({ uid: 1, def: ITEM_BY_ID.scooter, x: g.player.x, y: g.player.y, phase: 0 });
    g.update(0.016, null);
    expect(g.speedMultiplier()).toBeGreaterThan(1);
    for (let i = 0; i < 220; i++) g.update(0.1, null);
    expect(g.speedMultiplier()).toBe(1);
  });

  it('magnet pulls nearby items in', () => {
    const g = make();
    g.items.length = 0;
    g.powerups.miknatis = 10;
    g.items.push({ uid: 1, def: ITEM_BY_ID.simit, x: g.player.x + 15, y: g.player.y, phase: 0 });
    for (let i = 0; i < 20; i++) g.update(0.05, null);
    expect(g.progress.counts.simit).toBe(1);
  });

  it('discovering a POI awards points and completes visit quests', () => {
    const g = make();
    const ev = collectEvents(g);
    const poi = g.pois.find((p) => p.type === 'bakery')!;
    g.progress.quests[0] = { id: 999, type: 'visit', target: poi.index, goal: 1, progress: 0, reward: 50, title: 'x' };
    g.player.x = poi.x;
    g.player.y = poi.y - 8;
    g.update(0.6, null);
    expect(ev.some((e) => e.type === 'poi')).toBe(true);
    expect(ev.some((e) => e.type === 'quest-done' && e.quest.id === 999)).toBe(true);
    expect(g.progress.quests.length).toBe(3);
  });

  it('reaching the metro gives the underground badge', () => {
    const g = make();
    const ev = collectEvents(g);
    const m = g.pois.find((p) => p.type === 'metro')!;
    g.player.x = m.x + 10;
    g.player.y = 0;
    g.update(0.6, null);
    expect(g.progress.metro).toBe(true);
    expect(ev.some((e) => e.type === 'badge' && e.badge.id === 'metro')).toBe(true);
  });

  it('walking a whole street completes it', () => {
    const g = make();
    const ev = collectEvents(g);
    g.player.x = 0;
    g.player.y = 2;
    g.player.heading = 0;
    for (let i = 0; i < 400 && !ev.some((e) => e.type === 'street-done'); i++) g.update(0.05, FWD);
    const done = ev.find((e) => e.type === 'street-done');
    expect(done && done.type === 'street-done' && done.name).toBe('Kuzey Sokağı');
  });

  it('saves and restores player pose and score', () => {
    const store = new MemoryStore();
    const g = make(store);
    for (let i = 0; i < 30; i++) g.update(0.1, FWD);
    g.save();
    const g2 = make(store);
    expect(g2.progress.score).toBe(g.progress.score);
    expect(g2.player.x).toBeCloseTo(g.player.x, 3);
    expect(g2.explorePct).toBeCloseTo(g.explorePct, 5);
  });
});

describe('Game on Yenisahra', () => {
  const g = new Game(loadYenisahra(), { rng: mulberry32(11), config: CONFIG_3D });

  it('populates the neighbourhood', () => {
    expect(g.items.length).toBeGreaterThan(300);
    expect(g.pois.some((p) => p.type === 'metro')).toBe(true);
    expect(g.currentStreet === null || typeof g.currentStreet === 'string').toBe(true);
  });

  it('starter trail puts items right ahead of the player', () => {
    const near = g.items.filter((i) => Math.hypot(i.x - g.player.x, i.y - g.player.y) < 70);
    expect(near.length).toBeGreaterThanOrEqual(3);
  });

  it('a minute of scripted wandering stays on streets and scores', () => {
    const rng = mulberry32(5);
    let turn = 0;
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 45 === 0) turn = rng() < 0.5 ? 0 : rng() * 2 - 1;
      g.update(1 / 30, { forward: 1, turn, run: true });
      if (i % 30 === 0) expect(g.net.inCorridor(g.player)).toBe(true);
    }
    expect(g.progress.distance).toBeGreaterThan(200);
    expect(g.progress.score).toBeGreaterThan(20);
  });

  it('update is fast enough for 60 fps', () => {
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) g.update(1 / 60, { forward: 1, turn: 0.2, run: false });
    const per = (performance.now() - t0) / 600;
    expect(per).toBeLessThan(4);
  });
});
