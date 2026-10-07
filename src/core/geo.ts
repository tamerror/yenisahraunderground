import type { LonLat, Vec2 } from './types';

const R = 6378137;
const D2R = Math.PI / 180;

/**
 * Local equirectangular projection around an origin. x = metres east, y = metres north.
 * Accurate to well under a metre over a few kilometres, which is all a neighbourhood needs.
 */
export class Projection {
  readonly lon0: number;
  readonly lat0: number;
  private readonly kx: number;
  private readonly ky: number;

  constructor(origin: LonLat) {
    this.lon0 = origin[0];
    this.lat0 = origin[1];
    this.ky = R * D2R;
    this.kx = R * D2R * Math.cos(this.lat0 * D2R);
  }

  toLocal(p: LonLat): Vec2 {
    return { x: (p[0] - this.lon0) * this.kx, y: (p[1] - this.lat0) * this.ky };
  }

  toLonLat(v: Vec2): LonLat {
    return [this.lon0 + v.x / this.kx, this.lat0 + v.y / this.ky];
  }
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { x: number; y: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

/** Compass heading (radians, 0 = north, clockwise) to a unit vector in local x/y. */
export function headingToVec(h: number): Vec2 {
  return { x: Math.sin(h), y: Math.cos(h) };
}

/** Compass heading (radians) of the vector from a to b. */
export function headingBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(b.x - a.x, b.y - a.y);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the closest edge of a closed polygon ring. */
export function distToRing(p: Vec2, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = closestOnSegment(p, ring[j], ring[i]);
    best = Math.min(best, Math.hypot(p.x - c.x, p.y - c.y));
  }
  return best;
}

export function polygonArea(ring: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return s / 2;
}

export function centroid(ring: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Great-circle distance in metres. */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * D2R;
  const dLon = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
