import { describe, expect, it } from 'vitest';
import { Projection } from '../src/core/geo';
import { mulberry32 } from '../src/core/rng';
import { StreetNetwork } from '../src/core/streets';
import { loadYenisahra, plusArea } from './fixtures';

describe('StreetNetwork (synthetic plus)', () => {
  const area = plusArea();
  const net = new StreetNetwork(area, new Projection(area.center));

  it('merges shared vertices into intersection nodes', () => {
    const center = net.nodes.find((n) => Math.hypot(n.x, n.y) < 0.5)!;
    expect(center.segs.length).toBe(4);
  });

  it('keeps only the largest component walkable', () => {
    const island = net.segs.find((s) => s.name === 'Ada Sokağı')!;
    expect(island.main).toBe(false);
    expect(net.totalLength).toBeCloseTo(400, 0);
    expect(net.streets.has('Ada Sokağı')).toBe(false);
  });

  it('builds blocks per street between junctions', () => {
    const names = net.blocks.filter((b) => b.main).map((b) => b.name).sort();
    expect(names).toEqual(['Doğu Batı Caddesi', 'Doğu Batı Caddesi', 'Güney Sokağı', 'Kuzey Sokağı']);
    expect(net.streets.get('Doğu Batı Caddesi')!.length).toBeCloseTo(200, 0);
  });

  it('places samples roughly every 10 m', () => {
    expect(net.walkableSampleCount).toBe(40);
  });

  it('finds dead ends', () => {
    expect(net.deadEnds.length).toBe(4);
  });

  it('corridor test respects half width', () => {
    expect(net.inCorridor({ x: 50, y: 4.9 })).toBe(true);
    expect(net.inCorridor({ x: 50, y: 5.1 })).toBe(false);
    expect(net.inCorridor({ x: 300, y: 300 })).toBe(false);
  });

  it('constrain slides along walls instead of leaving the corridor', () => {
    const p = net.constrain({ x: 50, y: 0 }, { x: 52, y: 20 });
    expect(net.inCorridor(p)).toBe(true);
    expect(p.x).toBeGreaterThan(50.5);
    expect(p.y).toBeLessThanOrEqual(5);
  });

  it('constrain lets you turn into a side street at a junction', () => {
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 50; i++) p = net.constrain(p, { x: p.x, y: p.y + 1 });
    expect(p.y).toBeGreaterThan(45);
  });

  it('random points lie in corridors', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) expect(net.inCorridor(net.randomPoint(rng, 0.5))).toBe(true);
  });
});

describe('StreetNetwork (Yenisahra bundled data)', () => {
  const area = loadYenisahra();
  const net = new StreetNetwork(area, new Projection(area.center));

  it('has a large connected walkable network', () => {
    const all = net.segs.reduce((s, x) => s + x.len, 0);
    expect(net.totalLength).toBeGreaterThan(15000);
    expect(net.totalLength / all).toBeGreaterThan(0.85);
    expect(net.streets.size).toBeGreaterThan(60);
  });

  it('centre of the neighbourhood is near a street', () => {
    expect(net.nearest({ x: 0, y: 0 }, 150)).not.toBeNull();
  });
});

describe('routing', () => {
  const area = plusArea();
  const net = new StreetNetwork(area, new Projection(area.center));
  it('routes around the corner through the junction', () => {
    const r = net.route({ x: 80, y: 0 }, { x: 0, y: 80 })!;
    expect(r).not.toBeNull();
    expect(r.some((p) => Math.hypot(p.x, p.y) < 0.5)).toBe(true);
    let len = 0;
    for (let i = 1; i < r.length; i++) len += Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y);
    expect(len).toBeCloseTo(160, 0);
  });
  it('same segment is a straight line', () => {
    expect(net.route({ x: 10, y: 0 }, { x: 60, y: 0 })!.length).toBe(4);
  });
  it('returns null far away from streets', () => {
    expect(net.route({ x: 10, y: 0 }, { x: 5000, y: 5000 })).toBeNull();
  });
  it('routes across Yenisahra quickly', () => {
    const a = loadYenisahra();
    const n = new StreetNetwork(a, new Projection(a.center));
    const rng = mulberry32(4);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const r = n.route(n.randomPoint(rng), n.randomPoint(rng));
      expect(r).not.toBeNull();
    }
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  });
});
